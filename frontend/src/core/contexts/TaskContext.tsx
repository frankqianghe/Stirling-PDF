import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import {
  type ConvertTask,
  loadTasks,
  saveTasks,
  queryTaskStatus,
  submitDocxToPdf,
} from '@app/services/taskService';

const POLL_INTERVAL = 5000;
const POLL_INTERVAL_BACKGROUND = 30000;
const MAX_POLL_ATTEMPTS_PER_TASK = 360; // ~30 min at 5s interval
const STALE_TASK_AGE_MS = 30 * 60 * 1000; // 30 minutes

export type TaskBadgeState =
  | { type: 'count'; count: number }
  | { type: 'success' }
  | { type: 'failed' }
  | null;

interface TaskContextValue {
  tasks: ConvertTask[];
  taskBadge: TaskBadgeState;
  addTask: (task: ConvertTask) => void;
  removeTask: (id: string) => void;
  updateTask: (id: string, updates: Partial<ConvertTask>) => void;
  pollAllTasks: () => Promise<void>;
  startPollingIfNeeded: () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<ConvertTask[]>(loadTasks);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitioningRef = useRef(new Set<string>());
  const pollAttemptsRef = useRef(new Map<string, number>());
  const isVisibleRef = useRef(!document.hidden);

  const taskBadge = useMemo<TaskBadgeState>(() => {
    if (tasks.length === 0) return null;

    const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
    if (inProgressCount > 0) {
      return { type: 'count', count: inProgressCount };
    }

    const allCompleted = tasks.every(t => t.status === 'completed');
    if (allCompleted) return { type: 'success' };

    return { type: 'failed' };
  }, [tasks]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollAllTasks = useCallback(async () => {
    const current = loadTasks();
    const pending = current.filter(t => t.status === 'in_progress');

    if (pending.length === 0) {
      stopPolling();
      pollAttemptsRef.current.clear();
      setTasks(current);
      return;
    }

    let changed = false;
    for (const task of pending) {
      try {
        if (transitioningRef.current.has(task.id)) continue;

        // Auto-fail stale tasks that have been polling too long
        const attempts = pollAttemptsRef.current.get(task.id) ?? 0;
        const taskAge = Date.now() - new Date(task.createdAt).getTime();
        if (attempts >= MAX_POLL_ATTEMPTS_PER_TASK || taskAge > STALE_TASK_AGE_MS) {
          console.warn(`[TaskContext] Task ${task.id} exceeded poll limit (${attempts} attempts, ${Math.round(taskAge / 1000)}s old), marking as failed`);
          const idx = current.findIndex(t => t.id === task.id);
          if (idx !== -1) {
            current[idx] = { ...current[idx], status: 'failed' };
            changed = true;
          }
          pollAttemptsRef.current.delete(task.id);
          continue;
        }
        pollAttemptsRef.current.set(task.id, attempts + 1);

        const pollId = task.activeTaskId || task.id;
        const result = await queryTaskStatus(pollId);
        const idx = current.findIndex(t => t.id === task.id);
        if (idx === -1) continue;

        if (
          result.status === 'completed' &&
          task.taskType === 'ocr' &&
          task.ocrPhase === 'pdf_to_docx'
        ) {
          transitioningRef.current.add(task.id);
          try {
            const docxResp = await fetch(result.outputUrl!);
            if (!docxResp.ok) throw new Error(`Download failed: ${docxResp.status}`);
            const docxBlob = await docxResp.blob();
            const docxFileName = task.fileName.replace(/\.pdf$/i, '.docx');
            const phase2Data = await submitDocxToPdf(docxBlob, docxFileName);
            current[idx] = {
              ...current[idx],
              ocrPhase: 'docx_to_pdf',
              activeTaskId: phase2Data.id,
              status: 'in_progress',
              outputUrl: undefined,
            };
            changed = true;
            pollAttemptsRef.current.set(task.id, 0);
          } catch (err) {
            console.error('[TaskContext] OCR phase transition failed:', err);
            current[idx] = { ...current[idx], status: 'failed' };
            changed = true;
            pollAttemptsRef.current.delete(task.id);
          } finally {
            transitioningRef.current.delete(task.id);
          }
        } else if (result.status === 'completed' || result.status === 'failed') {
          current[idx] = {
            ...current[idx],
            status: result.status,
            outputUrl: result.outputUrl,
          };
          changed = true;
          pollAttemptsRef.current.delete(task.id);
        }
      } catch {
        // Count failed network requests toward the limit too
        const attempts = pollAttemptsRef.current.get(task.id) ?? 0;
        pollAttemptsRef.current.set(task.id, attempts + 1);
      }
    }
    if (changed) {
      saveTasks(current);
      const stillActive = current.some(t => t.status === 'in_progress');
      if (!stillActive) {
        stopPolling();
        pollAttemptsRef.current.clear();
      }
    }
    setTasks(current);
  }, [stopPolling]);

  const restartPollingWithInterval = useCallback((interval: number) => {
    stopPolling();
    const current = loadTasks();
    if (current.some(t => t.status === 'in_progress')) {
      timerRef.current = setInterval(pollAllTasks, interval);
    }
  }, [stopPolling, pollAllTasks]);

  const startPollingIfNeeded = useCallback(() => {
    if (timerRef.current) return;
    pollAllTasks();
    const interval = isVisibleRef.current ? POLL_INTERVAL : POLL_INTERVAL_BACKGROUND;
    timerRef.current = setInterval(pollAllTasks, interval);
  }, [pollAllTasks]);

  const addTask = useCallback((task: ConvertTask) => {
    setTasks(prev => {
      const next = [task, ...prev];
      saveTasks(next);
      return next;
    });
    if (task.status === 'in_progress') {
      pollAttemptsRef.current.set(task.id, 0);
      if (timerRef.current) {
        pollAllTasks();
      } else {
        startPollingIfNeeded();
      }
    }
  }, [startPollingIfNeeded, pollAllTasks]);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== id);
      saveTasks(next);
      const stillActive = next.some(t => t.status === 'in_progress');
      if (!stillActive) {
        stopPolling();
        pollAttemptsRef.current.clear();
      }
      return next;
    });
    pollAttemptsRef.current.delete(id);
  }, [stopPolling]);

  const updateTask = useCallback((id: string, updates: Partial<ConvertTask>) => {
    setTasks(prev => {
      const next = prev.map(t => (t.id === id ? { ...t, ...updates } : t));
      saveTasks(next);
      return next;
    });
  }, []);

  // Pause/slow polling when app is hidden, resume when visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
      if (document.hidden) {
        restartPollingWithInterval(POLL_INTERVAL_BACKGROUND);
      } else {
        // Immediately poll then switch to normal interval
        pollAllTasks();
        restartPollingWithInterval(POLL_INTERVAL);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pollAllTasks, restartPollingWithInterval]);

  useEffect(() => {
    const initial = loadTasks();
    if (initial.length > 0) {
      pollAllTasks().then(() => {
        const current = loadTasks();
        if (current.some(t => t.status === 'in_progress') && !timerRef.current) {
          const interval = isVisibleRef.current ? POLL_INTERVAL : POLL_INTERVAL_BACKGROUND;
          timerRef.current = setInterval(pollAllTasks, interval);
        }
      });
    }
    return stopPolling;
  }, [pollAllTasks, stopPolling]);

  return (
    <TaskContext.Provider value={{ tasks, taskBadge, addTask, removeTask, updateTask, pollAllTasks, startPollingIfNeeded }}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTaskContext(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}
