const STORAGE_KEY = 'stirling-pdf-convert-tasks';
const API_BASE = 'https://plexpdf-test.wenxstudio.ai';

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

  const resp = await fetch(`${API_BASE}/convert/pdf/to/${toFormat}`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}`);
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

  addTask(task);
  return task;
}

export interface TaskQueryResult {
  status: TaskStatus;
  outputUrl?: string;
}

export async function queryTaskStatus(taskId: string): Promise<TaskQueryResult> {
  const resp = await fetch(`${API_BASE}/convert/tasks/${taskId}`);

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

  const resp = await fetch(`${API_BASE}/convert/pdf/to/docx`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}`);
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

  addTask(task);
  return task;
}

export async function submitDocxToPdf(docxBlob: Blob, fileName: string): Promise<{ id: string; status: string; created_at: string }> {
  const formData = new FormData();
  formData.append('file', new File([docxBlob], fileName));

  const resp = await fetch(`${API_BASE}/convert/docx/to/pdf`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Server error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API error: code ${json.code}`);
  }

  return json.data;
}
