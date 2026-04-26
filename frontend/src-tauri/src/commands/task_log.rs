use crate::utils::add_log;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LOG_DIR_NAME: &str = "task_logs";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MB safety cap per task

const DAILY_LOG_DIR_NAME: &str = "daily_logs";
const MAX_DAILY_LOG_BYTES: u64 = 50 * 1024 * 1024; // 50 MB safety cap per day

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
    open_text_file(&path_str)
}

/// Reveal the application log directory (the parent of `task_logs`) in the
/// OS file manager. Used by the "View Logs" entry in the About settings
/// pane to give support / users one-click access to all logs (Tauri's own
/// plugin-log output, plus the `task_logs/` subfolder).
#[tauri::command]
pub async fn open_app_log_dir(app: AppHandle) -> Result<(), String> {
    let base = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve app_log_dir: {}", e))?;
    if !base.exists() {
        fs::create_dir_all(&base)
            .map_err(|e| format!("Failed to create log dir {:?}: {}", base, e))?;
    }
    let path_str = base.to_string_lossy().to_string();
    tauri_plugin_opener::open_path(&path_str, None::<&str>)
        .map_err(|e| format!("Failed to open log dir: {}", e))?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// Daily logs
//
// Used by the global fetch interceptor to record every non convert/OCR
// HTTP request (those have their own per-task log files). Files live at
//   <app_log_dir>/daily_logs/YYYY-MM-DD.log
// The date is supplied by the frontend so the on-disk filename matches the
// user's local calendar day, regardless of how the app process counts days.
// ──────────────────────────────────────────────────────────────────────────

/// Validate a date string. Allow only `YYYY-MM-DD` style identifiers so a
/// crafted value can't escape the daily-log directory.
fn is_safe_date(date: &str) -> bool {
    !date.is_empty()
        && date.len() <= 32
        && date
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn daily_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve app_log_dir: {}", e))?;
    let dir = base.join(DAILY_LOG_DIR_NAME);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create daily log dir {:?}: {}", dir, e))?;
    }
    Ok(dir)
}

fn daily_log_path(app: &AppHandle, date: &str) -> Result<PathBuf, String> {
    if !is_safe_date(date) {
        return Err(format!("Invalid daily log date: {}", date));
    }
    Ok(daily_log_dir(app)?.join(format!("{}.log", date)))
}

#[tauri::command]
pub async fn daily_log_path_cmd(app: AppHandle, date: String) -> Result<String, String> {
    let path = daily_log_path(&app, &date)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn daily_log_append(app: AppHandle, date: String, line: String) -> Result<(), String> {
    let path = daily_log_path(&app, &date)?;

    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_DAILY_LOG_BYTES {
            // Rotate by moving the oversized file aside; we keep the
            // previous content under .1 so support can still grab it if
            // they need to.
            let rotated = path.with_extension("log.1");
            let _ = fs::remove_file(&rotated);
            let _ = fs::rename(&path, &rotated);
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open daily log file {:?}: {}", path, e))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write daily log line: {}", e))?;
    if !line.ends_with('\n') {
        let _ = file.write_all(b"\n");
    }
    Ok(())
}

/// Open the daily log file in the OS default text editor.
#[tauri::command]
pub async fn daily_log_open(app: AppHandle, date: String) -> Result<(), String> {
    let path = daily_log_path(&app, &date)?;
    if !path.exists() {
        fs::File::create(&path).map_err(|e| {
            add_log(format!("⚠️ Failed to create empty daily log {:?}: {}", path, e));
            format!("Failed to create empty daily log: {}", e)
        })?;
    }
    let path_str = path.to_string_lossy().to_string();
    open_text_file(&path_str)
}

/// Open a `.log` (or otherwise-plain-text) file in a sensible editor.
///
/// On Windows, `.log` files frequently have NO registered file association
/// in fresh user profiles — `tauri_plugin_opener::open_path(.., None)` then
/// falls through to `ShellExecuteEx` which can either hang waiting on the
/// "Open with" picker or silently fail.  Either way the JS `await invoke`
/// promise never resolves and the "View Logs" button spins forever.
///
/// The fix is to invoke `notepad.exe` explicitly on Windows — it is always
/// available, opens immediately, and doesn't depend on user file-type
/// configuration.  On macOS / Linux the default-app path is fine and we
/// keep the previous behaviour.  We also fall back to opening the parent
/// directory if the explicit launch fails, so the user always gets *some*
/// way to access the log.
fn open_text_file(path_str: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Err(e) =
            tauri_plugin_opener::open_path(path_str, Some("notepad.exe"))
        {
            add_log(format!(
                "⚠️ open_text_file: notepad launch failed for {}: {}",
                path_str, e
            ));
            // Fallback: reveal parent directory so the user can at least
            // get to the file via Explorer.
            if let Some(parent) = std::path::Path::new(path_str).parent() {
                let parent_str = parent.to_string_lossy().to_string();
                tauri_plugin_opener::open_path(&parent_str, None::<&str>).map_err(
                    |e2| format!("Failed to open log file or its directory: {}", e2),
                )?;
                return Ok(());
            }
            return Err(format!("Failed to open log file with notepad: {}", e));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        tauri_plugin_opener::open_path(path_str, None::<&str>)
            .map_err(|e| format!("Failed to open log file: {}", e))
    }
}
