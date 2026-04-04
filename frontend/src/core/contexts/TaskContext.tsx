import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import {
  type ConvertTask,
  loadTasks,
  saveTasks,
  queryTaskStatus,
} from '@app/services/taskService';

interface TaskContextValue {
  tasks: ConvertTask[];
  addTask: (task: ConvertTask) => void;
  removeTask: (id: string) => void;
  updateTask: (id: string, updates: Partial<ConvertTask>) => void;
  pollAllTasks: () => Promise<void>;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<ConvertTask[]>(loadTasks);

  const addTask = useCallback((task: ConvertTask) => {
    setTasks(prev => {
      const next = [task, ...prev];
      saveTasks(next);
      return next;
    });
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => {
      const next = prev.filter(t => t.id !== id);
      saveTasks(next);
      return next;
    });
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<ConvertTask>) => {
    setTasks(prev => {
      const next = prev.map(t => (t.id === id ? { ...t, ...updates } : t));
      saveTasks(next);
      return next;
    });
  }, []);

  const pollAllTasks = useCallback(async () => {
    const current = loadTasks();
    const pending = current.filter(
      t => t.status === 'in_progress'
    );
    if (pending.length === 0) return;

    let changed = false;
    for (const task of pending) {
      try {
        const result = await queryTaskStatus(task.id);
        const idx = current.findIndex(t => t.id === task.id);
        if (idx !== -1 && current[idx].status !== result.status) {
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
      setTasks(current);
    }
  }, []);

  return (
    <TaskContext.Provider value={{ tasks, addTask, removeTask, updateTask, pollAllTasks }}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTaskContext(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}
