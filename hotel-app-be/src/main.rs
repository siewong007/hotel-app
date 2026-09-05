//! Hotel Management Backend API
//!
//! A comprehensive hotel management system built with Axum.

mod constants;
mod core;
mod handlers;
mod models;
mod modules;
mod repositories;
mod routes;
mod services;
mod utils;

use core::{AppConfig, AuthService, config, create_pool};
use routes::create_router;
use std::io::Write;
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::path::PathBuf;

/// Check if we're running in desktop mode
/// Resolve the directory log files should be written to.
///
/// Order: `HOTEL_LOG_DIR` env override → desktop data dir (`HotelApp/logs/`) →
/// fallback `./logs/`. The desktop UI's `get_logs` Tauri command reads from
/// `<data_local>/HotelApp/logs/`, so writing there makes logs visible in-app.
fn resolve_log_dir(config: &AppConfig) -> PathBuf {
    if let Some(dir) = &config.hotel_log_dir {
        return dir.clone();
    }
    if config.desktop_mode
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
fn init_logging(config: &AppConfig) {
    use simplelog::{
        ColorChoice, CombinedLogger, ConfigBuilder, LevelFilter, TermLogger, TerminalMode,
        WriteLogger,
    };

    let level = config.rust_log.as_level_filter();

    let logger_config = ConfigBuilder::new()
        .set_time_format_rfc3339()
        .set_target_level(LevelFilter::Error)
        .build();

    let term_logger: Box<dyn simplelog::SharedLogger> = TermLogger::new(
        level,
        logger_config.clone(),
        TerminalMode::Stderr,
        ColorChoice::Auto,
    );

    let log_dir = resolve_log_dir(config);
    let mut loggers: Vec<Box<dyn simplelog::SharedLogger>> = vec![term_logger];

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "warning: could not create log dir {}: {} — logging stderr only",
            log_dir.display(),
            e
        );
    } else {
        // Fixed filename: the old code stamped the BOOT date into the name,
        // so a long-lived container appended to one ever-growing file whose
        // name lied about its age. Rotation belongs to the host logrotate
        // unit (/etc/logrotate.d/saliminn uses copytruncate on
        // /opt/saliminn/logs/*.log), which matches this name and keeps size
        // bounded regardless of container lifetime. On machines without that
        // unit (dev laptops), delete old files manually.
        let file_path = log_dir.join("backend.log");
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
        {
            Ok(file) => loggers.push(WriteLogger::new(level, logger_config, file)),
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

    let config = match config::init_from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("FATAL: Invalid configuration: {}", e);
            std::process::exit(1);
        }
    };

    let desktop_mode = config.desktop_mode;

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
    init_logging(config);

    log::info!("Starting Hotel Management API server...");
    if desktop_mode {
        log::info!("Desktop mode enabled");
    }

    if let Err(e) = AuthService::init_jwt_secret(&config.jwt_secret) {
        log::error!("✗ Invalid JWT configuration: {}", e);
        eprintln!("FATAL: Invalid JWT configuration: {}", e);
        std::process::exit(1);
    }

    // Initialize database pool
    let pool = match create_pool(&config.database).await {
        Ok(pool) => {
            log::info!("✓ Database connection established");
            pool
        }
        Err(e) => {
            log::error!("✗ Failed to create database pool: {}", e);
            log::error!("DATABASE_URL configured: true");
            eprintln!("FATAL: Database connection failed: {}", e);
            std::process::exit(1);
        }
    };

    // The current baseline stores customer-ledger timestamps as timestamptz.
    // Older schemas can degrade these reads silently, so refuse to start and
    // require a fresh rebuild. A missing column is left to the install flow.
    match sqlx::query_scalar::<_, String>(
        "SELECT data_type FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'customer_ledgers' \
           AND column_name = 'payment_date'",
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(t)) if t != "timestamp with time zone" => {
            log::error!(
                "✗ customer_ledgers.payment_date is '{}': this database uses a legacy schema; export required data and rebuild from the current baseline and seed",
                t
            );
            eprintln!("FATAL: legacy database schema; a fresh rebuild is required");
            std::process::exit(1);
        }
        Ok(_) => {}
        Err(e) => log::warn!("Ledger schema-generation probe failed: {}", e),
    }

    // Permission resolution now UNIONs team-conferred roles, so `team_roles`
    // and `team_members` are read on EVERY authorization check. Against a
    // database that has `users` but not those tables, the join fails and every
    // permission check in the application returns an error — an app-wide
    // authorization outage, not a degraded feature. Refuse to start and
    // require a fresh rebuild. `users` absent means the schema is not installed
    // at all, which the normal install flow handles.
    match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_name IN ('users', 'team_roles', 'team_members')",
    )
    .fetch_one(&pool)
    .await
    {
        Ok(count) if (1..3).contains(&count) => {
            log::error!(
                "✗ this database has the users table but not team_roles/team_members: export required data and rebuild from the current baseline and seed"
            );
            eprintln!("FATAL: legacy database schema; a fresh rebuild is required");
            std::process::exit(1);
        }
        Ok(_) => {}
        Err(e) => log::warn!("Teams schema-generation probe failed: {}", e),
    }

    // One-shot backfill: ensure every booking has an invoice row.
    match services::invoice_numbers::backfill_missing_booking_invoices(&pool).await {
        Ok(0) => {}
        Ok(n) => log::info!("✓ Backfilled invoice numbers for {} booking(s)", n),
        Err(e) => log::warn!("Invoice backfill failed: {}", e),
    }

    // One-shot backfill: ensure every customer ledger has a due_date.
    match services::invoice_numbers::backfill_missing_ledger_due_dates(&pool).await {
        Ok(0) => {}
        Ok(n) => log::info!("✓ Backfilled due_date for {} ledger(s)", n),
        Err(e) => log::warn!("Ledger due_date backfill failed: {}", e),
    }

    // Start the background night-audit scheduler. Inert unless the
    // `night_audit_auto_enabled` setting is turned on; runs for the process
    // lifetime and never blocks startup.
    services::night_audit_scheduler::spawn(pool.clone());

    // Automatically expire receipt requests that remain unanswered for 24 hours.
    services::payment_receipt_scheduler::spawn(pool.clone());

    // Releases stale unpaid ONLINE holds after `unpaid_hold_release_hours`
    // (ships at 24; 0 switches it off). Front-desk holds are never touched.
    services::unpaid_hold_scheduler::spawn(pool.clone());

    // Start the durable email delivery worker. Inert when SMTP_* env vars are
    // absent; otherwise leases due outbox rows and sends with retry/backoff.
    modules::communications::worker::spawn(pool.clone());

    // Start the communications scheduler: due-campaign fan-out into the
    // outbox and the daily birthday-voucher job (opt-in via settings).
    modules::communications::scheduler::spawn(pool.clone());

    // Create router with all routes and middleware
    let app = create_router(pool);

    // Determine bind address and port
    let preferred_port: u16 = config.backend_port;

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
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
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
