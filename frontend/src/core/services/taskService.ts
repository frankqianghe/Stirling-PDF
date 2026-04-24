import { type TaskLogger } from '@app/services/taskLogService';

const STORAGE_KEY = 'stirling-pdf-convert-tasks';
const API_BASE = 'https://plexpdf-test.wenxstudio.ai';

// Keys mirror those owned by the desktop auth services (kept as literals to
// avoid `core -> desktop` import dependency).
const DEVICE_TOKEN_KEY = 'plexpdf_device_token';
const DEVICE_ID_FALLBACK_KEY = 'stirling_device_id_fallback';

// Hard cap on logged body sizes – prevents multi-MB blobs from flooding logs
// while still being big enough that virtually every JSON / error response is
// captured in full.
const MAX_BODY_LOG_BYTES = 16 * 1024;

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

function describeFormData(form: FormData): string[] {
  const lines: string[] = [];
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      lines.push(
        `    ${key} = <File name="${value.name}" size=${value.size}B type="${value.type || 'application/octet-stream'}" lastModified=${value.lastModified}>`,
      );
    } else if (value instanceof Blob) {
      lines.push(`    ${key} = <Blob size=${value.size}B type="${value.type || 'application/octet-stream'}">`);
    } else {
      lines.push(`    ${key} = ${JSON.stringify(value)}`);
    }
  }
  return lines;
}

function describeRequestBody(body: LoggedFetchInit['body']): string[] {
  if (body == null) return ['  Body: <none>'];
  if (body instanceof FormData) {
    const lines = ['  Body (multipart/form-data):'];
    const fields = describeFormData(body);
    if (fields.length === 0) lines.push('    <empty>');
    else lines.push(...fields);
    return lines;
  }
  if (body instanceof Blob) {
    return [`  Body: <Blob size=${body.size}B type="${body.type || 'application/octet-stream'}">`];
  }
  if (typeof body === 'string') {
    const truncated = body.length > MAX_BODY_LOG_BYTES;
    const text = truncated ? body.slice(0, MAX_BODY_LOG_BYTES) : body;
    return [
      `  Body (string, ${body.length}B${truncated ? ', TRUNCATED' : ''}):`,
      indent(text, '    '),
    ];
  }
  return [`  Body: <unknown type ${Object.prototype.toString.call(body)}>`];
}

function describeHeaders(headers: Record<string, string>, prefix = '  '): string[] {
  const keys = Object.keys(headers);
  if (keys.length === 0) return [`${prefix}Headers: <none>`];
  const lines = [`${prefix}Headers:`];
  for (const k of keys) {
    lines.push(`${prefix}  ${k}: ${headers[k]}`);
  }
  return lines;
}

function describeResponseHeaders(resp: Response): string[] {
  const entries: [string, string][] = [];
  resp.headers.forEach((value, key) => entries.push([key, value]));
  if (entries.length === 0) return ['  Response headers: <none>'];
  const lines = ['  Response headers:'];
  for (const [k, v] of entries) {
    lines.push(`    ${k}: ${v}`);
  }
  return lines;
}

function describeResponseBody(bodyText: string, json: unknown): string[] {
  if (!bodyText) return ['  Response body: <empty>'];
  const truncated = bodyText.length > MAX_BODY_LOG_BYTES;
  const display = truncated ? bodyText.slice(0, MAX_BODY_LOG_BYTES) : bodyText;
  const lines: string[] = [];
  if (json !== undefined) {
    let pretty: string;
    try {
      pretty = JSON.stringify(json, null, 2);
    } catch {
      pretty = display;
    }
    const prettyTruncated = pretty.length > MAX_BODY_LOG_BYTES;
    const prettyDisplay = prettyTruncated ? pretty.slice(0, MAX_BODY_LOG_BYTES) : pretty;
    lines.push(`  Response body (json, ${bodyText.length}B${prettyTruncated ? ', TRUNCATED' : ''}):`);
    lines.push(indent(prettyDisplay, '    '));
  } else {
    lines.push(`  Response body (${bodyText.length}B${truncated ? ', TRUNCATED' : ''}):`);
    lines.push(indent(display, '    '));
  }
  return lines;
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map(line => prefix + line)
    .join('\n');
}

/**
 * fetch() wrapper that captures the full request/response transcript into
 * the supplied logger. Returns the response together with the already-read
 * body text (and parsed JSON when applicable) so callers don't accidentally
 * try to read the stream twice.
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
    });
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
  let json: unknown;
  if (bodyText && contentType.toLowerCase().includes('application/json')) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      // not JSON despite header; keep raw text
    }
  } else if (bodyText) {
    // Some endpoints return JSON without correct Content-Type — try anyway.
    const trimmed = bodyText.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        json = JSON.parse(bodyText);
      } catch {
        // genuinely not JSON
      }
    }
  }

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
  const url = `${API_BASE}/convert/pdf/to/${toFormat}`;
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

export async function queryTaskStatus(
  taskId: string,
  logger?: TaskLogger,
): Promise<TaskQueryResult> {
  const url = `${API_BASE}/convert/tasks/${taskId}`;
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
  const url = `${API_BASE}/convert/pdf/to/docx`;
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
  const url = `${API_BASE}/convert/docx/to/pdf`;
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
