//! Hotel Management Backend API
//!
//! A comprehensive hotel management system built with Axum.

mod core;
mod handlers;
mod models;
mod repositories;
mod routes;
mod services;
mod utils;

use core::create_pool;
use routes::create_router;
use std::io::Write;
use std::net::TcpListener as StdTcpListener;

/// Check if we're running in desktop mode
fn is_desktop_mode() -> bool {
    std::env::var("HOTEL_DESKTOP_MODE").is_ok()
}

/// Find an available port, starting from the preferred port
fn find_available_port(preferred: u16) -> u16 {
    // Try the preferred port first
    if StdTcpListener::bind(format!("127.0.0.1:{}", preferred)).is_ok() {
        return preferred;
    }

    // Try ports in range
    for port in (preferred + 1)..=(preferred + 100) {
        if StdTcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return port;
        }
    }

    // Fallback: let the OS choose
    StdTcpListener::bind("127.0.0.1:0")
        .map(|l| l.local_addr().map(|a| a.port()).unwrap_or(preferred))
        .unwrap_or(preferred)
}

#[tokio::main]
async fn main() {
    // Load environment variables from .env file
    dotenvy::dotenv().ok();

    let desktop_mode = is_desktop_mode();

    // Print immediately to stdout and stderr
    println!("=== Hotel Management Backend Starting ===");
    if desktop_mode {
        println!("Running in DESKTOP MODE");
    }
    eprintln!("=== Hotel Management Backend Starting ===");
    std::io::stdout().flush().ok();
    std::io::stderr().flush().ok();

    // Initialize logging
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    println!("Logging initialized");
    log::info!("Starting Hotel Management API server...");
    if desktop_mode {
        log::info!("Desktop mode enabled");
    }

    // Initialize database pool
    let pool = match create_pool().await {
        Ok(pool) => {
            log::info!("✓ Database connection established");
            pool
        }
        Err(e) => {
            log::error!("✗ Failed to create database pool: {}", e);
            let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "not set".to_string());
            log::error!("DATABASE_URL: {}", db_url);
            eprintln!("FATAL: Database connection failed: {}", e);
            std::process::exit(1);
        }
    };

    // Create router with all routes and middleware
    let app = create_router(pool);

    // Determine bind address and port
    let preferred_port: u16 = std::env::var("BACKEND_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3030);

    let (bind_address, port) = if desktop_mode {
        // In desktop mode, bind to localhost only and find available port
        let port = find_available_port(preferred_port);
        ("127.0.0.1", port)
    } else {
        // In server mode, bind to all interfaces
        ("0.0.0.0", preferred_port)
    };

    let bind_addr = format!("{}:{}", bind_address, port);
    log::info!("Hotel Management API server starting on http://{}", bind_addr);
    println!("Hotel Management API server starting on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("Failed to bind to {}: {}", bind_addr, e);
            std::process::exit(1);
        });

    // Serve with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    log::info!("Server shutdown complete");
    println!("Server shutdown complete");
}

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            log::info!("Received Ctrl+C signal, shutting down gracefully...");
            println!("Received Ctrl+C signal, shutting down gracefully...");
        },
        _ = terminate => {
            log::info!("Received terminate signal, shutting down gracefully...");
            println!("Received terminate signal, shutting down gracefully...");
        },
    }
}
