//! Hotel Desktop Application Library
//!
//! This crate provides the Tauri desktop application wrapper for the hotel management system.

mod commands;
pub mod database;
pub mod server;

use database::EmbeddedDatabase;
use server::EmbeddedServer;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::{error, info};

/// Application state shared across the Tauri app
pub struct AppState {
    pub database: Arc<Mutex<Option<EmbeddedDatabase>>>,
    pub server: Arc<Mutex<Option<EmbeddedServer>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            database: Arc::new(Mutex::new(None)),
            server: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize and start all backend services
pub async fn start_backend_services(state: &AppState) -> Result<(), String> {
    // Start PostgreSQL
    info!("Initializing embedded PostgreSQL...");
    let database = EmbeddedDatabase::new()
        .await
        .map_err(|e| format!("Failed to initialize database: {}", e))?;

    let connection_url = database.connection_url();

    // Check if fresh install and run migrations/seeds
    let is_fresh = database.is_fresh_install()
        .await
        .map_err(|e| format!("Failed to check database state: {}", e))?;

    // Run migrations
    database.run_migrations()
        .await
        .map_err(|e| format!("Failed to run migrations: {}", e))?;

    // Run seed data on fresh install
    if is_fresh {
        info!("Fresh install detected, running seed data...");
        database.run_seed_data()
            .await
            .map_err(|e| format!("Failed to run seed data: {}", e))?;
    }

    // Store database reference
    {
        let mut db_lock = state.database.lock().await;
        *db_lock = Some(database);
    }

    // Start Axum server
    info!("Starting embedded Axum server...");
    let server = EmbeddedServer::start(&connection_url, 3030)
        .await
        .map_err(|e| format!("Failed to start server: {}", e))?;

    info!("Backend services started successfully on {}", server.base_url());

    // Store server reference
    {
        let mut srv_lock = state.server.lock().await;
        *srv_lock = Some(server);
    }

    Ok(())
}

/// Stop all backend services gracefully
pub async fn stop_backend_services(state: &AppState) {
    info!("Stopping backend services...");

    // Stop server first
    {
        let mut server = state.server.lock().await;
        if let Some(mut srv) = server.take() {
            srv.stop();
        }
    }

    // Give server time to shut down
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Stop database
    {
        let mut database = state.database.lock().await;
        if let Some(mut db) = database.take() {
            if let Err(e) = db.stop().await {
                error!("Error stopping database: {}", e);
            }
        }
    }

    info!("Backend services stopped");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("hotel_desktop=info".parse().unwrap())
                .add_directive("hotel_app_be=info".parse().unwrap())
                .add_directive("sqlx=warn".parse().unwrap())
        )
        .init();

    info!("Starting Hotel Management Desktop Application...");

    let state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_api_url,
            commands::check_server_health,
            commands::get_database_status,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let state_clone = AppState {
                database: state.database.clone(),
                server: state.server.clone(),
            };

            // Start backend services in a background task
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_backend_services(&state_clone).await {
                    error!("Failed to start backend services: {}", e);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AppState>();
                let state_clone = AppState {
                    database: state.database.clone(),
                    server: state.server.clone(),
                };

                // Stop backend services synchronously
                tauri::async_runtime::block_on(async {
                    stop_backend_services(&state_clone).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
