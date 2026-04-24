use crate::utils::add_log;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LOG_DIR_NAME: &str = "task_logs";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MB safety cap per task

/// Validate log id to prevent path traversal. Allow alphanumerics, dash, underscore.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve app_log_dir: {}", e))?;
    let dir = base.join(LOG_DIR_NAME);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log dir {:?}: {}", dir, e))?;
    }
    Ok(dir)
}

fn log_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("Invalid log id: {}", id));
    }
    Ok(log_dir(app)?.join(format!("{}.log", id)))
}

#[tauri::command]
pub async fn task_log_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = log_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn task_log_path(app: AppHandle, id: String) -> Result<String, String> {
    let path = log_path(&app, &id)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn task_log_append(app: AppHandle, id: String, line: String) -> Result<(), String> {
    let path = log_path(&app, &id)?;

    // Truncate runaway logs to keep disk usage in check.
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = fs::remove_file(&path);
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open log file {:?}: {}", path, e))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write log line: {}", e))?;
    if !line.ends_with('\n') {
        let _ = file.write_all(b"\n");
    }
    Ok(())
}

#[tauri::command]
pub async fn task_log_read(app: AppHandle, id: String) -> Result<String, String> {
    let path = log_path(&app, &id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read log: {}", e))
}

#[tauri::command]
pub async fn task_log_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = log_path(&app, &id)?;
    if path.exists() {
        if let Err(e) = fs::remove_file(&path) {
            add_log(format!("⚠️ Failed to delete task log {:?}: {}", path, e));
            return Err(format!("Failed to delete log: {}", e));
        }
    }
    Ok(())
}

/// Open the log file in the OS default text editor.
#[tauri::command]
pub async fn task_log_open(app: AppHandle, id: String) -> Result<(), String> {
    let path = log_path(&app, &id)?;
    if !path.exists() {
        // Create empty file so user always has something to open.
        fs::File::create(&path)
            .map_err(|e| format!("Failed to create empty log file: {}", e))?;
    }
    let path_str = path.to_string_lossy().to_string();
    tauri_plugin_opener::open_path(&path_str, None::<&str>)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    Ok(())
}
