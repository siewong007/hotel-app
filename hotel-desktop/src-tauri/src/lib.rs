//! Hotel Desktop Application Library
//!
//! This module provides the core functionality for the Hotel Management System
//! desktop application built with Tauri.

pub mod commands;
pub mod postgres;

/// Initialize and run the Tauri application
pub fn run() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting Hotel Management Desktop Application");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize data directories
            if let Err(e) = init_data_directories() {
                log::error!("Failed to initialize data directories: {}", e);
                // Continue anyway - directories might already exist
            }

            // Start backend in background
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_services(app_handle).await {
                    log::error!("Failed to start services: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::restart_backend,
            commands::backup_database,
            commands::get_logs,
            commands::open_data_folder,
            commands::shutdown_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

    // Run migrations if needed
    log::info!("Checking database migrations...");
    postgres::run_migrations_if_needed(&app_handle)
        .await
        .map_err(|e| format!("Failed to run migrations: {}", e))?;

    // Start the backend sidecar
    commands::start_backend_sidecar(&app_handle).await.map_err(|e| e.to_string())?;

    log::info!("All services started successfully");
    Ok(())
}
