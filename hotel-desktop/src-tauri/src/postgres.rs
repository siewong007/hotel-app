//! PostgreSQL process management
//!
//! Handles the lifecycle of the bundled PostgreSQL server:
//! - Initialization (initdb)
//! - Starting/stopping the server
//! - Running migrations
//! - Health checks

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::get_data_directory;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const POSTGRES_PORT: u16 = 5433; // Use non-standard port to avoid conflicts
const POSTGRES_USER: &str = "hotel_admin";
const POSTGRES_DB: &str = "hotel_management";
const MAX_STARTUP_WAIT_SECS: u64 = 30;

/// Error types for PostgreSQL operations
#[derive(Debug, thiserror::Error)]
pub enum PostgresError {
    #[error("Failed to initialize PostgreSQL data directory: {0}")]
    InitDbFailed(String),

    #[error("Failed to start PostgreSQL server: {0}")]
    StartFailed(String),

    #[error("PostgreSQL server failed to become ready within {0} seconds")]
    StartupTimeout(u64),

    #[error("Failed to run migrations: {0}")]
    MigrationFailed(String),

    #[error("PostgreSQL binary not found at: {0}")]
    BinaryNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Get the path to PostgreSQL binaries
fn get_pgsql_bin_dir(app_handle: &AppHandle) -> PathBuf {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // Strip the \\?\ extended-length path prefix on Windows as PostgreSQL can't handle it
    let path_str = resource_dir.to_string_lossy();
    let clean_path = if path_str.starts_with(r"\\?\") {
        PathBuf::from(&path_str[4..])
    } else {
        resource_dir
    };

    clean_path.join("pgsql").join("bin")
}

/// Get the PostgreSQL data directory
fn get_pgdata_dir() -> PathBuf {
    get_data_directory().join("pgdata")
}

/// Check if PostgreSQL data directory is initialized
fn is_pgdata_initialized() -> bool {
    get_pgdata_dir().join("PG_VERSION").exists()
}

/// Initialize PostgreSQL data directory using initdb
pub async fn init_postgres_data_dir(app_handle: &AppHandle) -> Result<(), PostgresError> {
    if is_pgdata_initialized() {
        log::info!("PostgreSQL data directory already initialized");
        return Ok(());
    }

    log::info!("Initializing PostgreSQL data directory...");

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let initdb_path = pgsql_bin.join("initdb.exe");

    if !initdb_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            initdb_path.to_string_lossy().to_string(),
        ));
    }

    let pgdata = get_pgdata_dir();

    // Get current PATH and prepend pgsql/bin so initdb can find postgres.exe
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    let mut cmd = tokio::process::Command::new(&initdb_path);
    cmd.args([
            "-D",
            &pgdata.to_string_lossy(),
            "-U",
            POSTGRES_USER,
            "-E",
            "UTF8",
            "--locale=C",
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PostgresError::InitDbFailed(stderr.to_string()));
    }

    // Configure PostgreSQL for local-only access
    configure_postgres_for_desktop(&pgdata)?;

    log::info!("PostgreSQL data directory initialized successfully");
    Ok(())
}

/// Configure PostgreSQL for desktop use (localhost only, no password for local connections)
fn configure_postgres_for_desktop(pgdata: &PathBuf) -> Result<(), std::io::Error> {
    // Modify postgresql.conf
    let conf_path = pgdata.join("postgresql.conf");
    let mut conf_content = std::fs::read_to_string(&conf_path)?;

    // Add custom configuration
    conf_content.push_str(&format!(
        r#"
# Hotel Desktop App Configuration
port = {}
listen_addresses = 'localhost'
max_connections = 20
shared_buffers = 128MB
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
"#,
        POSTGRES_PORT
    ));

    std::fs::write(&conf_path, conf_content)?;

    // Modify pg_hba.conf for local trust authentication
    let hba_path = pgdata.join("pg_hba.conf");
    let hba_content = r#"
# Hotel Desktop App - Local connections only
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
"#;
    std::fs::write(&hba_path, hba_content)?;

    Ok(())
}

/// Start the PostgreSQL server
pub async fn start_postgres(app_handle: &AppHandle) -> Result<(), PostgresError> {
    log::info!("Starting PostgreSQL server...");

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_ctl_path = pgsql_bin.join("pg_ctl.exe");

    if !pg_ctl_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            pg_ctl_path.to_string_lossy().to_string(),
        ));
    }

    let pgdata = get_pgdata_dir();
    let log_file = pgdata.join("log").join("startup.log");

    // Ensure log directory exists
    std::fs::create_dir_all(pgdata.join("log"))?;

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    // Start PostgreSQL without waiting (-w flag causes issues with CREATE_NO_WINDOW on Windows)
    // Use Stdio::null() to prevent child process from blocking on pipe
    let mut cmd = tokio::process::Command::new(&pg_ctl_path);
    cmd.args([
            "start",
            "-D",
            &pgdata.to_string_lossy(),
            "-l",
            &log_file.to_string_lossy(),
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let status = cmd.status().await?;

    if !status.success() {
        return Err(PostgresError::StartFailed(format!("pg_ctl exited with code: {:?}", status.code())));
    }

    // Wait for PostgreSQL to be ready by polling pg_isready
    log::info!("Waiting for PostgreSQL to be ready...");
    for i in 0..MAX_STARTUP_WAIT_SECS {
        if is_postgres_running(app_handle).await {
            log::info!("PostgreSQL server started successfully after {} seconds", i);
            return Ok(());
        }
        sleep(Duration::from_secs(1)).await;
    }

    Err(PostgresError::StartupTimeout(MAX_STARTUP_WAIT_SECS))
}

/// Stop the PostgreSQL server
pub async fn stop_postgres(app_handle: &AppHandle) -> Result<(), PostgresError> {
    log::info!("Stopping PostgreSQL server...");

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_ctl_path = pgsql_bin.join("pg_ctl.exe");

    if !pg_ctl_path.exists() {
        log::warn!("pg_ctl not found, PostgreSQL may not be installed");
        return Ok(());
    }

    let pgdata = get_pgdata_dir();

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    let mut cmd = tokio::process::Command::new(&pg_ctl_path);
    cmd.args([
            "stop",
            "-D",
            &pgdata.to_string_lossy(),
            "-m",
            "fast", // Fast shutdown mode
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Failed to stop PostgreSQL (may already be stopped): {}", stderr);
    } else {
        log::info!("PostgreSQL server stopped successfully");
    }

    Ok(())
}

/// Check if PostgreSQL is running and accepting connections
pub async fn is_postgres_running(app_handle: &AppHandle) -> bool {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_isready_path = pgsql_bin.join("pg_isready.exe");

    if !pg_isready_path.exists() {
        return false;
    }

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    let mut cmd = tokio::process::Command::new(&pg_isready_path);
    cmd.args(["-h", "localhost", "-p", &POSTGRES_PORT.to_string()])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.status().await;

    matches!(output, Ok(status) if status.success())
}

/// Ensure PostgreSQL is running, starting it if necessary
pub async fn ensure_postgres_running(app_handle: &AppHandle) -> Result<(), PostgresError> {
    // Check if already running
    if is_postgres_running(app_handle).await {
        log::info!("PostgreSQL is already running");
        return Ok(());
    }

    // Initialize if needed
    init_postgres_data_dir(app_handle).await?;

    // Start the server (this now includes waiting for ready)
    start_postgres(app_handle).await
}

/// Create the hotel_management database if it doesn't exist
pub async fn create_database_if_needed(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join("psql.exe");

    if !psql_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            psql_path.to_string_lossy().to_string(),
        ));
    }

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    // Check if database exists
    let mut check_cmd = tokio::process::Command::new(&psql_path);
    check_cmd.args([
            "-h",
            "localhost",
            "-p",
            &POSTGRES_PORT.to_string(),
            "-U",
            POSTGRES_USER,
            "-d",
            "postgres",
            "-tAc",
            &format!("SELECT 1 FROM pg_database WHERE datname='{}'", POSTGRES_DB),
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    check_cmd.creation_flags(CREATE_NO_WINDOW);

    let check_output = check_cmd.output().await?;

    let exists = String::from_utf8_lossy(&check_output.stdout)
        .trim()
        .contains('1');

    if exists {
        log::info!("Database '{}' already exists", POSTGRES_DB);
        return Ok(());
    }

    // Create database
    log::info!("Creating database '{}'...", POSTGRES_DB);
    let mut create_cmd = tokio::process::Command::new(&psql_path);
    create_cmd.args([
            "-h",
            "localhost",
            "-p",
            &POSTGRES_PORT.to_string(),
            "-U",
            POSTGRES_USER,
            "-d",
            "postgres",
            "-c",
            &format!("CREATE DATABASE {} ENCODING 'UTF8'", POSTGRES_DB),
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    create_cmd.creation_flags(CREATE_NO_WINDOW);

    let create_output = create_cmd.output().await?;

    if !create_output.status.success() {
        let stderr = String::from_utf8_lossy(&create_output.stderr);
        return Err(PostgresError::MigrationFailed(format!(
            "Failed to create database: {}",
            stderr
        )));
    }

    log::info!("Database '{}' created successfully", POSTGRES_DB);
    Ok(())
}

/// Run database migrations if needed
pub async fn run_migrations_if_needed(app_handle: &AppHandle) -> Result<(), PostgresError> {
    // First ensure database exists
    create_database_if_needed(app_handle).await?;

    let already_initialized = is_database_initialized(app_handle).await?;

    // Always run migrations - they use IF NOT EXISTS patterns and are idempotent
    // This ensures new migrations are applied even if the database was initialized before
    log::info!("Running database migrations...");
    run_sql_files(app_handle, "database/migrations").await?;

    // Only run seed data if database was not previously initialized
    if !already_initialized {
        log::info!("Running seed data...");
        run_sql_files(app_handle, "database/seed-data").await?;
    }

    log::info!("Database migrations completed successfully");
    Ok(())
}

/// Check if database has been initialized (check for users table)
async fn is_database_initialized(app_handle: &AppHandle) -> Result<bool, PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join("psql.exe");

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    let mut cmd = tokio::process::Command::new(&psql_path);
    cmd.args([
            "-h", "localhost",
            "-p", &POSTGRES_PORT.to_string(),
            "-U", POSTGRES_USER,
            "-d", POSTGRES_DB,
            "-tAc",
            "SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1",
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    let result = String::from_utf8_lossy(&output.stdout).trim().contains('1');
    Ok(result)
}

/// Run SQL files from a directory
async fn run_sql_files(app_handle: &AppHandle, dir_name: &str) -> Result<(), PostgresError> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // Strip the \\?\ extended-length path prefix on Windows
    let path_str = resource_dir.to_string_lossy();
    let clean_path = if path_str.starts_with(r"\\?\") {
        PathBuf::from(&path_str[4..])
    } else {
        resource_dir
    };

    let sql_dir = clean_path.join(dir_name);

    if !sql_dir.exists() {
        log::warn!("SQL directory not found: {:?}", sql_dir);
        return Ok(());
    }

    // Get all .sql files and sort them
    let mut sql_files: Vec<_> = std::fs::read_dir(&sql_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "sql"))
        .collect();

    sql_files.sort_by_key(|e| e.file_name());

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join("psql.exe");
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{};{}", pgsql_bin.to_string_lossy(), current_path);

    for entry in sql_files {
        let file_path = entry.path();
        log::info!("Running SQL file: {:?}", file_path.file_name());

        let mut cmd = tokio::process::Command::new(&psql_path);
        cmd.args([
                "-h", "localhost",
                "-p", &POSTGRES_PORT.to_string(),
                "-U", POSTGRES_USER,
                "-d", POSTGRES_DB,
                "-f", &file_path.to_string_lossy(),
            ])
            .env("PATH", &new_path)
            .current_dir(&pgsql_bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Failed to run SQL file {:?}: {}", file_path.file_name(), stderr);
            // Continue with other files even if one fails
        }
    }

    Ok(())
}

/// Get the DATABASE_URL for the backend
pub fn get_database_url() -> String {
    format!(
        "postgres://{}@localhost:{}/{}",
        POSTGRES_USER, POSTGRES_PORT, POSTGRES_DB
    )
}

/// Get PostgreSQL status information
pub async fn get_postgres_status(app_handle: &AppHandle) -> serde_json::Value {
    let running = is_postgres_running(app_handle).await;
    let pgdata = get_pgdata_dir();
    let initialized = is_pgdata_initialized();

    serde_json::json!({
        "running": running,
        "initialized": initialized,
        "port": POSTGRES_PORT,
        "user": POSTGRES_USER,
        "database": POSTGRES_DB,
        "data_directory": pgdata.to_string_lossy(),
    })
}
