//! Hotel Desktop Application
//!
//! Tauri application that bundles the hotel management frontend and backend.

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::PathBuf;

/// Shared state for tracking sidecar process
struct AppState {
    backend_started: AtomicBool,
}

/// Start the backend sidecar process
async fn start_backend(app: tauri::AppHandle) -> Result<(), String> {
    let shell = app.shell();

    log::info!("Starting hotel-app-be sidecar...");

    // Set up environment variables for the sidecar
    // Allow CORS from Tauri webview origin
    let allowed_origins = "http://localhost:3000,http://localhost:5173,http://tauri.localhost,https://tauri.localhost,tauri://localhost";

    // Spawn the sidecar process with environment variables
    let sidecar = shell
        .sidecar("hotel-app-be")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .args(["--port", "3030"])
        .env("ALLOWED_ORIGINS", allowed_origins);

    let (mut rx, _child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Monitor sidecar output in a separate task
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[Backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[Backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(error) => {
                    log::error!("[Backend Error] {}", error);
                }
                CommandEvent::Terminated(payload) => {
                    log::info!("[Backend] Process terminated with code: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait a moment for the backend to start
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    log::info!("Backend sidecar started successfully");
    Ok(())
}

/// Tauri command to check if backend is ready
#[tauri::command]
async fn check_backend_health() -> Result<bool, String> {
    // Simple health check - try to connect to the backend
    let client = reqwest::Client::new();
    match client.get("http://127.0.0.1:3030/health").send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Tauri command to save a file directly to Downloads folder
#[tauri::command]
async fn save_file_direct(
    filename: String,
    content: Vec<u8>,
) -> Result<String, String> {
    log::info!("save_file_direct called for: {}", filename);

    // Get the downloads directory
    let downloads_dir = dirs::download_dir()
        .ok_or_else(|| "Could not find Downloads directory".to_string())?;

    let file_path = downloads_dir.join(&filename);
    let path_str = file_path.to_string_lossy().to_string();

    log::info!("Saving to: {}", path_str);

    // Write the file
    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    log::info!("File saved successfully to: {}", path_str);
    Ok(path_str)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    log::info!("Starting Hotel Manager Desktop Application");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            backend_started: AtomicBool::new(false),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Start the backend sidecar
            tauri::async_runtime::spawn(async move {
                match start_backend(handle.clone()).await {
                    Ok(()) => {
                        if let Some(state) = handle.try_state::<AppState>() {
                            state.backend_started.store(true, Ordering::SeqCst);
                        }
                        log::info!("Backend is ready");
                    }
                    Err(e) => {
                        log::error!("Failed to start backend: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_backend_health, save_file_direct])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
