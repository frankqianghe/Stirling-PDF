const STORAGE_KEY = 'stirling-pdf-convert-tasks';
const API_BASE = 'https://plexpdf-test.wenxstudio.ai';

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

export async function submitConvertTask(file: File, toFormat: string): Promise<ConvertTask> {
  const formData = new FormData();
  formData.append('file', file);

  const headers = await buildAuthHeaders();
  const resp = await fetch(`${API_BASE}/convert/pdf/to/${toFormat}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}${json.message ? ` (${json.message})` : ''}`);
  }

  const task: ConvertTask = {
    id: json.data.id,
    fileName: file.name,
    toFormat,
    status: (json.data.status === 'completed' ? 'completed'
      : json.data.status === 'in_progress' || json.data.status === 'pending' ? 'in_progress'
      : 'failed') as TaskStatus,
    createdAt: json.data.created_at,
  };

  return task;
}

export interface TaskQueryResult {
  status: TaskStatus;
  outputUrl?: string;
}

export async function queryTaskStatus(taskId: string): Promise<TaskQueryResult> {
  const headers = await buildAuthHeaders();
  const resp = await fetch(`${API_BASE}/convert/tasks/${taskId}`, {
    headers,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}`);
  }

  const data = json.data;
  let status: TaskStatus;
  if (data.status === 'completed') {
    status = 'completed';
  } else if (data.status === 'in_progress' || data.status === 'pending') {
    status = 'in_progress';
  } else {
    status = 'failed';
  }

  return {
    status,
    outputUrl: data.output_url,
  };
}

export async function submitOCRTask(file: File): Promise<ConvertTask> {
  const formData = new FormData();
  formData.append('file', file);

  const headers = await buildAuthHeaders();
  const resp = await fetch(`${API_BASE}/convert/pdf/to/docx`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}${json.message ? ` (${json.message})` : ''}`);
  }

  const task: ConvertTask = {
    id: json.data.id,
    fileName: file.name,
    toFormat: 'pdf',
    status: (json.data.status === 'completed' ? 'completed'
      : json.data.status === 'in_progress' || json.data.status === 'pending' ? 'in_progress'
      : 'failed') as TaskStatus,
    createdAt: json.data.created_at,
    taskType: 'ocr',
    ocrPhase: 'pdf_to_docx',
  };

  return task;
}

export async function submitDocxToPdf(docxBlob: Blob, fileName: string): Promise<{ id: string; status: string; created_at: string }> {
  const formData = new FormData();
  formData.append('file', new File([docxBlob], fileName));

  const headers = await buildAuthHeaders();
  const resp = await fetch(`${API_BASE}/convert/docx/to/pdf`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}${json.message ? ` (${json.message})` : ''}`);
  }

  return json.data;
}
