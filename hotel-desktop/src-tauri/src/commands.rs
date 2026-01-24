//! Tauri IPC Commands
//!
//! These commands can be invoked from the frontend via `invoke()`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::get_data_directory;

/// Global state for the backend process
static BACKEND_RUNNING: AtomicBool = AtomicBool::new(false);

lazy_static::lazy_static! {
    static ref BACKEND_PROCESS: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
}

/// Status response for the application
#[derive(serde::Serialize)]
pub struct AppStatus {
    pub backend_running: bool,
    pub backend_url: String,
    pub data_directory: String,
    pub version: String,
}

/// Get the current application status
#[tauri::command]
pub async fn get_status(_app_handle: AppHandle) -> Result<AppStatus, String> {
    Ok(AppStatus {
        backend_running: BACKEND_RUNNING.load(Ordering::SeqCst),
        backend_url: "http://localhost:3030".to_string(),
        data_directory: get_data_directory().to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Start the backend sidecar process
pub async fn start_backend_sidecar(app_handle: &AppHandle) -> Result<(), String> {
    if BACKEND_RUNNING.load(Ordering::SeqCst) {
        log::info!("Backend is already running");
        return Ok(());
    }

    log::info!("Starting backend sidecar...");

    // Use the database URL from the postgres module (port 5433) or environment variable
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| crate::postgres::get_database_url());

    let shell = app_handle.shell();
    let sidecar_command = shell
        .sidecar("hotel-app-be")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .env("DATABASE_URL", &database_url)
        .env("JWT_SECRET", "super-secret-jwt-key-for-hotel-desktop-app")
        .env("HOTEL_DESKTOP_MODE", "1")
        .env("ALLOWED_ORIGINS", "*")
        .env("SKIP_EMAIL_VERIFICATION", "true")
        .env("RUST_LOG", "info");

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child process
    {
        let mut process = BACKEND_PROCESS.lock().await;
        *process = Some(child);
    }

    BACKEND_RUNNING.store(true, Ordering::SeqCst);

    // Spawn a task to monitor the sidecar output
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::info!("[Backend] {}", line_str);
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::warn!("[Backend] {}", line_str);
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("Backend process terminated with code: {:?}", payload.code);
                    BACKEND_RUNNING.store(false, Ordering::SeqCst);

                    // Emit event to frontend
                    if let Some(window) = app_handle_clone.get_webview_window("main") {
                        let _ = window.emit("backend-terminated", payload.code);
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    log::error!("Backend process error: {}", err);
                }
                _ => {}
            }
        }
    });

    // Wait for backend to be ready
    wait_for_backend_ready().await?;

    log::info!("Backend sidecar started successfully");
    Ok(())
}

/// Wait for the backend to be ready (health check)
async fn wait_for_backend_ready() -> Result<(), String> {
    let client = reqwest::Client::new();
    let health_url = "http://localhost:3030/health";

    for i in 0..30 {
        match client.get(health_url).send().await {
            Ok(response) if response.status().is_success() => {
                log::info!("Backend is ready after {} seconds", i);
                return Ok(());
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }

    Err("Backend failed to become ready within 30 seconds".into())
}

/// Stop the backend sidecar process
pub async fn stop_backend_sidecar() -> Result<(), String> {
    log::info!("Stopping backend sidecar...");

    let mut process = BACKEND_PROCESS.lock().await;
    if let Some(child) = process.take() {
        child.kill().map_err(|e| format!("Failed to kill backend process: {}", e))?;
        BACKEND_RUNNING.store(false, Ordering::SeqCst);
        log::info!("Backend sidecar stopped");
    }

    Ok(())
}

/// Restart the backend process
#[tauri::command]
pub async fn restart_backend(app_handle: AppHandle) -> Result<(), String> {
    log::info!("Restarting backend...");

    // Stop the current backend
    stop_backend_sidecar().await?;

    // Wait a moment for cleanup
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // Start the backend again
    start_backend_sidecar(&app_handle).await?;

    Ok(())
}

/// Backup the database (placeholder for now)
#[tauri::command]
pub async fn backup_database(_app_handle: AppHandle, _destination: Option<String>) -> Result<String, String> {
    log::info!("Database backup requested - not implemented for external PostgreSQL");
    Err("Database backup is only available when using bundled PostgreSQL".into())
}

/// Get recent log entries
#[tauri::command]
pub async fn get_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    let log_dir = get_data_directory().join("logs");
    let lines = lines.unwrap_or(100);

    // Find the most recent log file
    let log_files: Vec<_> = std::fs::read_dir(&log_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    if let Some(latest_log) = log_files.first() {
        let content = std::fs::read_to_string(latest_log.path()).map_err(|e| e.to_string())?;

        let log_lines: Vec<String> = content
            .lines()
            .rev()
            .take(lines)
            .map(|s| s.to_string())
            .collect();

        Ok(log_lines.into_iter().rev().collect())
    } else {
        Ok(vec!["No log files found".to_string()])
    }
}

/// Open the data folder in the file explorer
#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
    let data_dir = get_data_directory();

    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Shutdown the application gracefully
#[tauri::command]
pub async fn shutdown_app(app_handle: AppHandle) -> Result<(), String> {
    log::info!("Shutting down application...");

    // Stop backend
    stop_backend_sidecar().await?;

    // Stop PostgreSQL
    if let Err(e) = crate::postgres::stop_postgres(&app_handle).await {
        log::warn!("Failed to stop PostgreSQL: {}", e);
    }

    // Exit the application
    app_handle.exit(0);

    Ok(())
}
