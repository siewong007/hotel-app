//! Tauri IPC Commands
//!
//! These commands can be invoked from the frontend via `invoke()`

use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::get_data_directory;

/// Global state for the backend process
static BACKEND_RUNNING: AtomicBool = AtomicBool::new(false);
static BACKEND_STARTING: AtomicBool = AtomicBool::new(false);
static BACKEND_PORT: AtomicU16 = AtomicU16::new(3030);

lazy_static::lazy_static! {
    static ref BACKEND_PROCESS: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
}

/// Status response for the application
#[derive(serde::Serialize)]
pub struct AppStatus {
    pub backend_running: bool,
    pub backend_starting: bool,
    pub backend_url: String,
    pub data_directory: String,
    pub version: String,
    pub postgres: serde_json::Value,
}

/// Get the current application status
#[tauri::command]
pub async fn get_status(app_handle: AppHandle) -> Result<AppStatus, String> {
    Ok(AppStatus {
        backend_running: BACKEND_RUNNING.load(Ordering::SeqCst),
        backend_starting: BACKEND_STARTING.load(Ordering::SeqCst),
        backend_url: get_backend_url(),
        data_directory: get_data_directory().to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        postgres: crate::postgres::get_postgres_status(&app_handle).await,
    })
}

fn find_available_backend_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }

    for offset in 1..=100 {
        let Some(port) = preferred.checked_add(offset) else {
            break;
        };

        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }

    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .unwrap_or(preferred)
}

fn get_backend_url() -> String {
    format!("http://127.0.0.1:{}", BACKEND_PORT.load(Ordering::SeqCst))
}

/// Start the backend sidecar process
pub async fn start_backend_sidecar(app_handle: &AppHandle) -> Result<(), String> {
    if BACKEND_RUNNING.load(Ordering::SeqCst) || BACKEND_STARTING.load(Ordering::SeqCst) {
        log::info!("Backend is already running");
        return Ok(());
    }

    log::info!("Starting backend sidecar...");
    BACKEND_STARTING.store(true, Ordering::SeqCst);

    // Use the database URL from the postgres module (port 5433) or environment variable
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| crate::postgres::get_database_url());
    let preferred_port = std::env::var("BACKEND_PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(3030);
    let backend_port = find_available_backend_port(preferred_port);
    BACKEND_PORT.store(backend_port, Ordering::SeqCst);

    let shell = app_handle.shell();
    let sidecar_command = shell
        .sidecar("hotel-app-be")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .env("DATABASE_URL", &database_url)
        .env("BACKEND_PORT", backend_port.to_string())
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
                    BACKEND_STARTING.store(false, Ordering::SeqCst);

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
    if let Err(e) = wait_for_backend_ready(backend_port).await {
        BACKEND_STARTING.store(false, Ordering::SeqCst);
        BACKEND_RUNNING.store(false, Ordering::SeqCst);
        return Err(e);
    }

    BACKEND_STARTING.store(false, Ordering::SeqCst);
    BACKEND_RUNNING.store(true, Ordering::SeqCst);

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("backend-ready", get_backend_url());
    }

    log::info!(
        "Backend sidecar started successfully on {}",
        get_backend_url()
    );
    Ok(())
}

/// Wait for the backend to be ready (health check)
async fn wait_for_backend_ready(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/health", port);

    for i in 0..30 {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => {
                log::info!("Backend is ready after {} seconds", i);
                return Ok(());
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }

    Err(format!(
        "Backend failed to become ready within 30 seconds at {}",
        health_url
    ))
}

/// Stop the backend sidecar process
pub async fn stop_backend_sidecar() -> Result<(), String> {
    log::info!("Stopping backend sidecar...");

    let mut process = BACKEND_PROCESS.lock().await;
    if let Some(child) = process.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill backend process: {}", e))?;
        BACKEND_RUNNING.store(false, Ordering::SeqCst);
        BACKEND_STARTING.store(false, Ordering::SeqCst);
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
pub async fn backup_database(
    _app_handle: AppHandle,
    _destination: Option<String>,
) -> Result<String, String> {
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

    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
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
