/**
 * Per-task log file service.
 *
 * Each Convert/OCR submission gets its own log file identified by a stable
 * `logId`. Logs are appended line-by-line with ISO timestamps. The full log
 * lifetime is: submit -> polling -> success or failure.
 *
 * Storage:
 * - Tauri  : real file under `<appLogDir>/task_logs/<logId>.log`
 * - Browser: `localStorage` under `taskLog::<logId>` (best-effort fallback)
 */

const STORAGE_KEY_PREFIX = 'taskLog::';
const MAX_BROWSER_LOG_BYTES = 200 * 1024; // 200KB cap per task in localStorage

export type TaskLogLevel = 'INFO' | 'WARN' | 'ERROR';

function isTauriEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'
  );
}

function safeId(id: string): string {
  // Same constraints as the Rust validator (ascii alnum + - _).
  return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'task';
}

export function generateLogId(): string {
  // RFC 4122-ish v4 UUID, dashes only — matches Rust's safe-id constraint.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random
  return `task-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function formatLine(level: TaskLogLevel, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] ${level.padEnd(5)} ${message}`;
}

async function appendTauri(id: string, line: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('task_log_append', { id, line });
}

function appendBrowser(id: string, line: string): void {
  try {
    const key = STORAGE_KEY_PREFIX + safeId(id);
    const prev = localStorage.getItem(key) ?? '';
    const next = prev + line + '\n';
    const trimmed =
      next.length > MAX_BROWSER_LOG_BYTES
        ? next.slice(next.length - MAX_BROWSER_LOG_BYTES)
        : next;
    localStorage.setItem(key, trimmed);
  } catch {
    // localStorage may be full / unavailable — degrade silently.
  }
}

export async function appendTaskLog(
  id: string,
  level: TaskLogLevel,
  message: string,
): Promise<void> {
  const line = formatLine(level, message);
  if (isTauriEnv()) {
    try {
      await appendTauri(safeId(id), line);
      return;
    } catch (err) {
      // Swallow to avoid breaking the actual operation; mirror to console for diagnosis.
      console.warn('[taskLog] Failed to write log line:', err);
    }
  }
  appendBrowser(id, line);
}

/** Fire-and-forget convenience that never throws. */
export function logTask(id: string, level: TaskLogLevel, message: string): void {
  void appendTaskLog(id, level, message);
}

export interface TaskLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  /** Returns the underlying logId so consumers can persist it on the task. */
  readonly id: string;
}

export function createTaskLogger(id: string): TaskLogger {
  return {
    id,
    info: (m) => logTask(id, 'INFO', m),
    warn: (m) => logTask(id, 'WARN', m),
    error: (m) => logTask(id, 'ERROR', m),
  };
}

export async function readTaskLog(id: string): Promise<string> {
  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('task_log_read', { id: safeId(id) });
    } catch (err) {
      console.warn('[taskLog] Failed to read log:', err);
      return '';
    }
  }
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + safeId(id)) ?? '';
  } catch {
    return '';
  }
}

export async function openTaskLog(id: string): Promise<void> {
  if (!isTauriEnv()) {
    // Browser fallback: dump to console.
    const content = await readTaskLog(id);
    console.info(`===== Task log: ${id} =====\n${content}\n===== End =====`);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('task_log_open', { id: safeId(id) });
}

export async function deleteTaskLog(id: string): Promise<void> {
  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('task_log_delete', { id: safeId(id) });
      return;
    } catch (err) {
      console.warn('[taskLog] Failed to delete log:', err);
    }
  }
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + safeId(id));
  } catch {
    // ignore
  }
}

/**
 * Best-effort extraction of the most recent ERROR / WARN message from the log
 * for surfacing in tooltips. Returns an empty string if nothing relevant is
 * found.
 */
export async function getLastErrorReason(id: string): Promise<string> {
  const content = await readTaskLog(id);
  if (!content) return '';
  const lines = content.split('\n').filter(Boolean);
  // Walk from the end; prefer ERROR, fall back to WARN.
  let warn = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // Match: [iso] ERROR  message
    const m = line.match(/\]\s+(ERROR|WARN)\s+(.+)$/);
    if (!m) continue;
    if (m[1] === 'ERROR') return m[2].trim();
    if (!warn) warn = m[2].trim();
  }
  return warn;
}
