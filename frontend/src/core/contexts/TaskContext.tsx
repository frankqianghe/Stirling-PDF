import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import {
  type ConvertTask,
  loadTasks,
  saveTasks,
  queryTaskStatus,
  submitDocxToPdf,
} from '@app/services/taskService';

const POLL_INTERVAL = 5000;

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
      setTasks(current);
      return;
    }

    let changed = false;
    for (const task of pending) {
      try {
        if (transitioningRef.current.has(task.id)) continue;

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
          } catch (err) {
            console.error('[TaskContext] OCR phase transition failed:', err);
            current[idx] = { ...current[idx], status: 'failed' };
            changed = true;
          } finally {
            transitioningRef.current.delete(task.id);
          }
        } else if (current[idx].status !== result.status) {
          current[idx] = {
            ...current[idx],
            status: result.status,
            outputUrl: result.outputUrl,
          };
          changed = true;
        }
      } catch {
        // Ignore transient errors
      }
    }
    if (changed) {
      saveTasks(current);
      const stillActive = current.some(t => t.status === 'in_progress');
      if (!stillActive) {
        stopPolling();
      }
    }
    setTasks(current);
  }, [stopPolling]);

  const startPollingIfNeeded = useCallback(() => {
    if (timerRef.current) return;
    pollAllTasks();
    timerRef.current = setInterval(pollAllTasks, POLL_INTERVAL);
  }, [pollAllTasks]);

  const addTask = useCallback((task: ConvertTask) => {
    setTasks(prev => {
      const next = [task, ...prev];
      saveTasks(next);
      return next;
    });
    if (task.status === 'in_progress') {
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
      }
      return next;
    });
  }, [stopPolling]);

  const updateTask = useCallback((id: string, updates: Partial<ConvertTask>) => {
    setTasks(prev => {
      const next = prev.map(t => (t.id === id ? { ...t, ...updates } : t));
      saveTasks(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const initial = loadTasks();
    if (initial.length > 0) {
      pollAllTasks().then(() => {
        const current = loadTasks();
        if (current.some(t => t.status === 'in_progress') && !timerRef.current) {
          timerRef.current = setInterval(pollAllTasks, POLL_INTERVAL);
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
