import { type TaskLogger } from '@app/services/taskLogService';
import {
  describeHeaders,
  describeRequestBody,
  describeResponseBody,
  describeResponseHeaders,
  maybeParseJson,
} from '@app/services/httpLogFormat';
import { SKIP_FETCH_LOG_KEY } from '@app/services/fetchLogger';
import { getApiBaseUrl } from '@app/services/apiBaseUrl';

const STORAGE_KEY = 'stirling-pdf-convert-tasks';

// Keys mirror those owned by the desktop auth services (kept as literals to
// avoid `core -> desktop` import dependency).
const DEVICE_TOKEN_KEY = 'plexpdf_device_token';
const DEVICE_ID_FALLBACK_KEY = 'stirling_device_id_fallback';

// Resolved once per session; Tauri IPC isn't free so we cache the result.
let cachedDeviceId: string | null = null;

async function resolveDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const id = await invoke<string>('get_device_id');
    if (id && id.length > 0) {
      cachedDeviceId = id;
      return id;
    }
  } catch {
    // Not running inside Tauri (e.g. dev browser) – fall through to fallback.
  }
  try {
    const fallback = localStorage.getItem(DEVICE_ID_FALLBACK_KEY);
    if (fallback) {
      cachedDeviceId = fallback;
      return fallback;
    }
  } catch {
    // ignore – localStorage may be unavailable
  }
  return '';
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const token = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // ignore
  }
  const deviceId = await resolveDeviceId();
  if (deviceId) {
    headers['X-Device-Id'] = deviceId;
  }
  return headers;
}

/**
 * Window event broadcast by the desktop `useDeviceRegister` hook the
 * moment the first `/client/device/register` round-trip resolves
 * (success OR final failure after retries). The exact name is mirrored
 * here as a literal to keep `core/` free of `desktop/` imports.
 */
const DEVICE_REGISTERED_EVENT = 'plexpdf-device-registered';

/**
 * Awaits desktop device registration before resolving.
 *
 * Behaviour:
 *  - If a device token is already cached in localStorage (the steady
 *    state on every launch after the first), this returns *immediately*
 *    — zero overhead, no event listener installed.
 *  - Otherwise it parks until the `plexpdf-device-registered` window
 *    event fires (broadcast from `useDeviceRegister`).
 *  - As a safety net, it also resolves after `timeoutMs` so a
 *    permanently broken registration eventually lets the submit attempt
 *    proceed and surface a real 401 instead of hanging the UI's
 *    "submit" spinner forever.
 *
 * The optional `logger` lets callers transcribe the wait into the
 * per-task log file so support can tell, after the fact, whether the
 * task was delayed waiting for registration.
 */
async function waitForDeviceRegistration(
  logger?: TaskLogger,
  timeoutMs = 60_000,
): Promise<void> {
  if (typeof window === 'undefined') return;

  let cachedToken = '';
  try {
    cachedToken = localStorage.getItem(DEVICE_TOKEN_KEY) ?? '';
  } catch {
    // ignore — may be unavailable in private browsing modes
  }
  if (cachedToken) return;

  logger?.info(
    'Device registration not finished yet — submission is waiting for ' +
      `${DEVICE_REGISTERED_EVENT}…`,
  );
  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(
        DEVICE_REGISTERED_EVENT,
        onDone as EventListener,
      );
      window.clearTimeout(timer);
      const waited = Math.round(performance.now() - startedAt);
      logger?.info(`Resumed after waiting ${waited}ms (${reason}).`);
      resolve();
    };
    const onDone: EventListener = () =>
      finish('device registration broadcast received');
    window.addEventListener(
      DEVICE_REGISTERED_EVENT,
      onDone as EventListener,
      { once: true },
    );
    const timer = window.setTimeout(
      () =>
        finish(
          `safety timeout after ${timeoutMs}ms — proceeding without ` +
            'a confirmed registration; subsequent calls may 401',
        ),
      timeoutMs,
    );
  });
}

export type TaskStatus = 'in_progress' | 'completed' | 'failed';

export interface ConvertTask {
  id: string;
  fileName: string;
  toFormat: string;
  status: TaskStatus;
  outputUrl?: string;
  localPath?: string;
  createdAt: string;
  taskType?: 'convert' | 'ocr';
  ocrPhase?: 'pdf_to_docx' | 'docx_to_pdf';
  activeTaskId?: string;
  /** Stable per-submission identifier used to locate the on-disk log file. */
  logId?: string;
  /** Short human-readable failure reason, populated when status === 'failed'. */
  failureReason?: string;
}

export function loadTasks(): ConvertTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: ConvertTask[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export function addTask(task: ConvertTask): ConvertTask[] {
  const tasks = loadTasks();
  tasks.unshift(task);
  saveTasks(tasks);
  return tasks;
}

export function updateTask(id: string, updates: Partial<ConvertTask>): ConvertTask[] {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    tasks[idx] = { ...tasks[idx], ...updates };
    saveTasks(tasks);
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// HTTP logging helpers
// ---------------------------------------------------------------------------

interface LoggedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: FormData | Blob | string | null;
  /** Optional label for the request, e.g. "Submit convert task". */
  label?: string;
}

interface LoggedFetchResult {
  response: Response;
  /** Already-read response body text. */
  bodyText: string;
  /** Parsed JSON if Content-Type indicated JSON and parsing succeeded. */
  json?: unknown;
  durationMs: number;
}

/**
 * fetch() wrapper that captures the full request/response transcript into
 * the supplied logger. Returns the response together with the already-read
 * body text (and parsed JSON when applicable) so callers don't accidentally
 * try to read the stream twice.
 *
 * The `[SKIP_FETCH_LOG_KEY]: true` flag tells the global fetch interceptor
 * (installed at app startup) NOT to also log this request to the daily log
 * file — these per-task logs already capture the full transcript.
 */
async function loggedFetch(
  url: string,
  init: LoggedFetchInit,
  logger?: TaskLogger,
): Promise<LoggedFetchResult> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = init.headers ?? {};

  if (logger) {
    const lines: string[] = [];
    lines.push('────────── REQUEST ──────────');
    if (init.label) lines.push(`  Label: ${init.label}`);
    lines.push(`  ${method} ${url}`);
    lines.push(...describeHeaders(headers));
    lines.push(...describeRequestBody(init.body));
    logger.info(lines.join('\n'));
  }

  const startedAt = performance.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: init.body ?? undefined,
      // Custom flag — native fetch ignores unknown init properties, but
      // our global interceptor reads it to skip duplicate daily logging.
      [SKIP_FETCH_LOG_KEY]: true,
    } as RequestInit);
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger?.error(`Network failure after ${durationMs}ms: ${msg}`);
    throw err;
  }
  const durationMs = Math.round(performance.now() - startedAt);

  // Always drain the body once so we can both log it and let callers parse it
  // without worrying about "body already consumed" errors.
  let bodyText = '';
  try {
    bodyText = await resp.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(`Failed to read response body: ${msg}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const json = maybeParseJson(bodyText, contentType);

  if (logger) {
    const lines: string[] = [];
    lines.push('────────── RESPONSE ──────────');
    lines.push(`  HTTP ${resp.status} ${resp.statusText} (${durationMs}ms)`);
    lines.push(...describeResponseHeaders(resp));
    lines.push(...describeResponseBody(bodyText, json));
    lines.push('───────────────────────────────');
    // The full transcript is always INFO; callers emit a concise ERROR line
    // afterwards so the failure tooltip can surface a readable summary.
    logger.info(lines.join('\n'));
  }

  return { response: resp, bodyText, json, durationMs };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function submitConvertTask(
  file: File,
  toFormat: string,
  logger?: TaskLogger,
): Promise<ConvertTask> {
  await waitForDeviceRegistration(logger);
  const url = `${getApiBaseUrl()}/convert/pdf/to/${toFormat}`;
  const headers = await buildAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);

  const { response, json, bodyText } = await loggedFetch(
    url,
    {
      method: 'POST',
      headers,
      body: formData,
      label: `Submit convert task (file="${file.name}" toFormat=${toFormat})`,
    },
    logger,
  );

  if (!response.ok) {
    const reason = `Server error ${response.status} ${response.statusText} — body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (json as { code?: number; data?: any; message?: string }) ?? {};
  if (data.code !== 0) {
    const reason = `API error: code=${data.code}${data.message ? ` message="${data.message}"` : ''} body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`API error: code ${data.code}${data.message ? ` (${data.message})` : ''}`);
  }

  const task: ConvertTask = {
    id: data.data.id,
    fileName: file.name,
    toFormat,
    status: (data.data.status === 'completed' ? 'completed'
      : data.data.status === 'in_progress' || data.data.status === 'pending' ? 'in_progress'
      : 'failed') as TaskStatus,
    createdAt: data.data.created_at,
    logId: logger?.id,
  };

  logger?.info(`Parsed task: id=${task.id} status=${task.status} createdAt=${task.createdAt}`);
  return task;
}

export interface TaskQueryResult {
  status: TaskStatus;
  outputUrl?: string;
  /** Server-provided message for failed tasks (best-effort). */
  message?: string;
}

/**
 * Download a completed conversion result.
 *
 * Task status responses intentionally omit `output_url`, so completed tasks
 * must use the authenticated download endpoint. Older servers may still
 * return a direct URL; keep supporting it without forwarding auth headers to
 * an arbitrary host.
 */
export async function downloadTaskOutput(
  taskId: string,
  directOutputUrl?: string,
): Promise<Response> {
  const directUrl = directOutputUrl?.trim();
  if (directUrl) {
    return fetch(directUrl, {
      [SKIP_FETCH_LOG_KEY]: true,
    } as RequestInit);
  }

  const url = `${getApiBaseUrl()}/convert/tasks/${encodeURIComponent(taskId)}/download`;
  const headers = await buildAuthHeaders();
  return fetch(url, {
    headers,
    [SKIP_FETCH_LOG_KEY]: true,
  } as RequestInit);
}

export async function queryTaskStatus(
  taskId: string,
  logger?: TaskLogger,
): Promise<TaskQueryResult> {
  const url = `${getApiBaseUrl()}/convert/tasks/${taskId}`;
  const headers = await buildAuthHeaders();

  const { response, json, bodyText } = await loggedFetch(
    url,
    {
      method: 'GET',
      headers,
      label: `Poll task status (task_id=${taskId})`,
    },
    logger,
  );

  if (!response.ok) {
    logger?.warn(`Poll HTTP ${response.status} ${response.statusText} body=${oneLine(bodyText)}`);
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (json as { code?: number; data?: any; message?: string }) ?? {};
  if (data.code !== 0) {
    logger?.warn(`Poll API code=${data.code}${data.message ? ` message="${data.message}"` : ''} body=${oneLine(bodyText)}`);
    throw new Error(`API error: code ${data.code}`);
  }

  const inner = data.data;
  let status: TaskStatus;
  if (inner.status === 'completed') {
    status = 'completed';
  } else if (inner.status === 'in_progress' || inner.status === 'pending') {
    status = 'in_progress';
  } else {
    status = 'failed';
  }

  return {
    status,
    outputUrl: inner.output_url,
    message: inner.message ?? inner.error ?? inner.error_message,
  };
}

export async function submitOCRTask(
  file: File,
  logger?: TaskLogger,
): Promise<ConvertTask> {
  await waitForDeviceRegistration(logger);
  const url = `${getApiBaseUrl()}/convert/pdf/to/docx`;
  const headers = await buildAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);

  const { response, json, bodyText } = await loggedFetch(
    url,
    {
      method: 'POST',
      headers,
      body: formData,
      label: `Submit OCR task phase 1: pdf->docx (file="${file.name}")`,
    },
    logger,
  );

  if (!response.ok) {
    const reason = `Server error ${response.status} ${response.statusText} — body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (json as { code?: number; data?: any; message?: string }) ?? {};
  if (data.code !== 0) {
    const reason = `API error: code=${data.code}${data.message ? ` message="${data.message}"` : ''} body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`API error: code ${data.code}${data.message ? ` (${data.message})` : ''}`);
  }

  const task: ConvertTask = {
    id: data.data.id,
    fileName: file.name,
    toFormat: 'pdf',
    status: (data.data.status === 'completed' ? 'completed'
      : data.data.status === 'in_progress' || data.data.status === 'pending' ? 'in_progress'
      : 'failed') as TaskStatus,
    createdAt: data.data.created_at,
    taskType: 'ocr',
    ocrPhase: 'pdf_to_docx',
    logId: logger?.id,
  };

  logger?.info(`Parsed OCR phase-1 task: id=${task.id} status=${task.status}`);
  return task;
}

export async function submitDocxToPdf(
  docxBlob: Blob,
  fileName: string,
  logger?: TaskLogger,
): Promise<{ id: string; status: string; created_at: string }> {
  // Phase 2 of OCR — registration is virtually always done by the time
  // we hit this (phase 1 already submitted), but the cached-token early
  // return makes the call effectively free, and it keeps the contract
  // identical for any caller that invokes phase 2 in isolation.
  await waitForDeviceRegistration(logger);
  const url = `${getApiBaseUrl()}/convert/docx/to/pdf`;
  const headers = await buildAuthHeaders();
  const formData = new FormData();
  formData.append('file', new File([docxBlob], fileName));

  const { response, json, bodyText } = await loggedFetch(
    url,
    {
      method: 'POST',
      headers,
      body: formData,
      label: `Submit OCR task phase 2: docx->pdf (file="${fileName}")`,
    },
    logger,
  );

  if (!response.ok) {
    const reason = `Server error ${response.status} ${response.statusText} — body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (json as { code?: number; data?: any; message?: string }) ?? {};
  if (data.code !== 0) {
    const reason = `API error: code=${data.code}${data.message ? ` message="${data.message}"` : ''} body=${oneLine(bodyText)}`;
    logger?.error(reason);
    throw new Error(`API error: code ${data.code}${data.message ? ` (${data.message})` : ''}`);
  }

  logger?.info(`Parsed OCR phase-2 task: id=${data.data.id} status=${data.data.status}`);
  return data.data;
}

function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

/** Collapse to a single line for use in ERROR summaries / tooltips. */
function oneLine(text: string, max = 240): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), max);
}
