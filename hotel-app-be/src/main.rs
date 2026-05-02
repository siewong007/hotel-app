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
use std::path::PathBuf;

/// Check if we're running in desktop mode
fn is_desktop_mode() -> bool {
    std::env::var("HOTEL_DESKTOP_MODE").is_ok()
}

/// Resolve the directory log files should be written to.
///
/// Order: `HOTEL_LOG_DIR` env override → desktop data dir (`HotelApp/logs/`) →
/// fallback `./logs/`. The desktop UI's `get_logs` Tauri command reads from
/// `<data_local>/HotelApp/logs/`, so writing there makes logs visible in-app.
fn resolve_log_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HOTEL_LOG_DIR") {
        return PathBuf::from(dir);
    }
    if is_desktop_mode()
        && let Some(base) = dirs::data_local_dir()
    {
        return base.join("HotelApp").join("logs");
    }
    PathBuf::from("logs")
}

/// Initialize logging: stderr + a per-day rolling file under the log dir.
///
/// Falls back to stderr-only if the log dir / file can't be created so a
/// permission issue never prevents the process from starting.
fn init_logging() {
    use simplelog::{
        ColorChoice, CombinedLogger, ConfigBuilder, LevelFilter, TermLogger, TerminalMode,
        WriteLogger,
    };

    let level = match std::env::var("RUST_LOG").ok().as_deref() {
        Some("trace") => LevelFilter::Trace,
        Some("debug") => LevelFilter::Debug,
        Some("warn") => LevelFilter::Warn,
        Some("error") => LevelFilter::Error,
        _ => LevelFilter::Info,
    };

    let config = ConfigBuilder::new()
        .set_time_format_rfc3339()
        .set_target_level(LevelFilter::Error)
        .build();

    let term_logger: Box<dyn simplelog::SharedLogger> = TermLogger::new(
        level,
        config.clone(),
        TerminalMode::Stderr,
        ColorChoice::Auto,
    );

    let log_dir = resolve_log_dir();
    let mut loggers: Vec<Box<dyn simplelog::SharedLogger>> = vec![term_logger];

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "warning: could not create log dir {}: {} — logging stderr only",
            log_dir.display(),
            e
        );
    } else {
        let date = chrono::Local::now().format("%Y-%m-%d");
        let file_path = log_dir.join(format!("backend-{}.log", date));
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
        {
            Ok(file) => loggers.push(WriteLogger::new(level, config, file)),
            Err(e) => eprintln!(
                "warning: could not open log file {}: {} — logging stderr only",
                file_path.display(),
                e
            ),
        }
    }

    if CombinedLogger::init(loggers).is_err() {
        // Logger already set (e.g. test harness). Not fatal.
        eprintln!("warning: logger already initialized");
    }

    log::info!("Logging initialized — file sink: {}", log_dir.display());
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

    // Initialize logging — writes to stderr (captured by Tauri sidecar runner)
    // AND to a per-day file under the resolved log dir, so warn/error events
    // from swallowed Result paths (e.g. ensure_invoice_for_booking) survive
    // a process exit.
    init_logging();

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

    // One-shot backfill: ensure every booking has an invoice row.
    match hotel_app_be::services::invoice_numbers::backfill_missing_booking_invoices(&pool).await {
        Ok(0) => {}
        Ok(n) => log::info!("✓ Backfilled invoice numbers for {} booking(s)", n),
        Err(e) => log::warn!("Invoice backfill failed: {}", e),
    }

    // One-shot backfill: ensure every customer ledger has a due_date.
    match hotel_app_be::services::invoice_numbers::backfill_missing_ledger_due_dates(&pool).await {
        Ok(0) => {}
        Ok(n) => log::info!("✓ Backfilled due_date for {} ledger(s)", n),
        Err(e) => log::warn!("Ledger due_date backfill failed: {}", e),
    }

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
    log::info!(
        "Hotel Management API server starting on http://{}",
        bind_addr
    );
    println!(
        "Hotel Management API server starting on http://{}",
        bind_addr
    );

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
