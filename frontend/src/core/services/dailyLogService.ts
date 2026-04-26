/**
 * Daily log service.
 *
 * Stores one log file per local calendar day:
 *   <app_log_dir>/daily_logs/YYYY-MM-DD.log
 *
 * Used by the global fetch interceptor (`fetchLogger.ts`) to record every
 * non convert/OCR HTTP request — convert/OCR has its own per-task log
 * files written by `taskLogService.ts`.
 *
 * Falls back to localStorage in non-Tauri environments so dev-mode browser
 * builds don't crash; the browser fallback is best-effort and not intended
 * for real diagnostics.
 */

const LOCAL_STORAGE_PREFIX = 'plexpdf_daily_log_';

export type DailyLogLevel = 'INFO' | 'WARN' | 'ERROR';

let isTauriCached: boolean | null = null;
function isTauriEnv(): boolean {
  if (isTauriCached !== null) return isTauriCached;
  try {
    isTauriCached =
      typeof window !== 'undefined' &&
      // @ts-expect-error - Tauri injects this at runtime
      typeof window.__TAURI_INTERNALS__ !== 'undefined';
  } catch {
    isTauriCached = false;
  }
  return isTauriCached;
}

/** Local-time YYYY-MM-DD (so a 23:59 → 00:01 file boundary follows the user, not UTC). */
export function getTodayDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Append one or more lines to today's log. Multi-line messages are kept as a
 * single block (callers like the fetch interceptor rely on this to keep a
 * full request/response transcript contiguous in the file).
 */
export async function appendDailyLog(
  level: DailyLogLevel,
  message: string,
): Promise<void> {
  const date = getTodayDate();
  const line = `[${timestamp()}] [${level}] ${message}`;

  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('daily_log_append', { date, line });
      return;
    } catch (err) {
      console.warn('[dailyLogService] Tauri append failed, falling back:', err);
    }
  }

  try {
    const key = LOCAL_STORAGE_PREFIX + date;
    const existing = localStorage.getItem(key) || '';
    const next = existing + line + '\n';
    localStorage.setItem(key, next.slice(-200_000));
  } catch {
    /* swallow */
  }
}

/**
 * Synchronous fire-and-forget convenience wrapper. Useful for hot paths
 * (HTTP interceptor) where we don't want to block on the IPC round-trip.
 */
export function logDaily(level: DailyLogLevel, message: string): void {
  appendDailyLog(level, message).catch(() => {
    /* swallow — logging must never throw */
  });
}

/** Opens today's log file in the OS default text editor. */
export async function openTodayLog(): Promise<void> {
  const date = getTodayDate();

  if (isTauriEnv()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('daily_log_open', { date });
    return;
  }

  // Browser fallback: dump the localStorage text into a new tab.
  const key = LOCAL_STORAGE_PREFIX + date;
  const text = localStorage.getItem(key) || '(no log entries today)';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Returns the absolute filesystem path of today's log file, if available. */
export async function getTodayLogPath(): Promise<string | null> {
  if (!isTauriEnv()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('daily_log_path_cmd', { date: getTodayDate() });
  } catch {
    return null;
  }
}
