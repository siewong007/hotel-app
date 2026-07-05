//! Hotel Desktop Application Library
//!
//! This module provides the core functionality for the Hotel Management System
//! desktop application built with Tauri.

pub mod commands;
pub mod logging;
pub mod postgres;

use tauri::{Emitter, Manager};

/// Initialize and run the Tauri application
pub fn run() {
    logging::init_logging();
    log::info!("Starting Hotel Management Desktop Application");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Secure auto-update support. The updater verifies a minisign signature
        // against `plugins.updater.pubkey` in tauri.conf.json before applying any
        // downloaded artifact, so releases must be signed with the matching
        // private key (see UPDATER.md). `process` provides relaunch-after-update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize data directories
            if let Err(e) = init_data_directories() {
                log::error!("Failed to initialize data directories: {}", e);
                // Continue anyway - directories might already exist
            }

            // Start backend in background
            tauri::async_runtime::spawn(async move {
                match start_services(app_handle.clone()).await {
                    Ok(()) => {
                        // Services are up; run automatic backups on a schedule.
                        // Failures here must never crash or block the app.
                        spawn_scheduled_backups(app_handle.clone());
                    }
                    Err(e) => {
                        log::error!("Failed to start services: {}", e);
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("desktop-services-error", e);
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::restart_backend,
            commands::backup_database,
            commands::upgrade_database_from_backup,
            commands::get_logs,
            commands::open_data_folder,
            commands::shutdown_app,
            commands::check_for_updates,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Closing the window must not orphan the sidecar/postgres:
                // a lingering hotel-app-be.exe locks the install dir and
                // blocks the NSIS installer from replacing it.
                log::info!("Application exiting; stopping backend services...");
                let handle = app_handle.clone();
                tauri::async_runtime::block_on(async move {
                    if let Err(e) = commands::stop_backend_sidecar().await {
                        log::warn!("Failed to stop backend sidecar on exit: {}", e);
                    }
                    if let Err(e) = postgres::stop_postgres(&handle).await {
                        log::warn!("Failed to stop PostgreSQL on exit: {}", e);
                    }
                });
            }
        });
}

/// Initialize required data directories
fn init_data_directories() -> Result<(), std::io::Error> {
    let data_dir = get_data_directory();

    // Create main data directory
    std::fs::create_dir_all(&data_dir)?;

    // Create subdirectories
    std::fs::create_dir_all(data_dir.join("logs"))?;
    std::fs::create_dir_all(data_dir.join("backups"))?;

    log::info!("Data directories initialized at: {:?}", data_dir);
    Ok(())
}

/// Get the application data directory
pub fn get_data_directory() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("HotelApp")
}

/// Start backend services
async fn start_services(app_handle: tauri::AppHandle) -> Result<(), String> {
    log::info!("Starting services...");

    // First, ensure PostgreSQL is running
    log::info!("Starting PostgreSQL...");
    postgres::ensure_postgres_running(&app_handle)
        .await
        .map_err(|e| format!("Failed to start PostgreSQL: {}", e))?;

    // Run the consolidated schema and data scripts.
    log::info!("Running database setup...");
    postgres::run_database_setup(&app_handle)
        .await
        .map_err(|e| format!("Failed to run database setup: {}", e))?;

    // Start the backend sidecar
    commands::start_backend_sidecar(&app_handle)
        .await
        .map_err(|e| e.to_string())?;

    log::info!("All services started successfully");
    Ok(())
}

/// Delay before the first automatic backup after a successful startup.
const FIRST_BACKUP_DELAY_SECS: u64 = 120;
/// Interval between automatic backups thereafter.
const BACKUP_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// Spawn a background task that runs a database backup shortly after startup and
/// then every 24 hours. Backup failures are logged and never propagated, so this
/// task can neither crash nor block the application.
fn spawn_scheduled_backups(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(FIRST_BACKUP_DELAY_SECS)).await;

        loop {
            log::info!("Running scheduled database backup...");
            match postgres::run_scheduled_backup(&app_handle).await {
                Ok(path) => log::info!("Scheduled backup written to {:?}", path),
                Err(e) => log::error!("Scheduled backup failed (continuing): {}", e),
            }

            tokio::time::sleep(std::time::Duration::from_secs(BACKUP_INTERVAL_SECS)).await;
        }
    });
}
