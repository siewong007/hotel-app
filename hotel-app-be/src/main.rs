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

#[tokio::main]
async fn main() {
    // Load environment variables from .env file
    dotenvy::dotenv().ok();

    // Print immediately to stdout and stderr
    println!("=== Hotel Management Backend Starting ===");
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

    log::info!("Hotel Management API server starting on http://0.0.0.0:3030");
    println!("Hotel Management API server starting on http://0.0.0.0:3030");

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3030")
        .await
        .expect("Failed to bind to port 3030. Is another instance already running? Try: lsof -ti:3030 | xargs kill -9");

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
