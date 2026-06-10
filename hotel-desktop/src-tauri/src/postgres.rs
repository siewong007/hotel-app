//! PostgreSQL process management
//!
//! Handles the lifecycle of the bundled PostgreSQL server:
//! - Initialization (initdb)
//! - Starting/stopping the server
//! - Running migrations
//! - Health checks

use rand::RngCore;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

use crate::get_data_directory;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
const EXE_SUFFIX: &str = ".exe";
#[cfg(not(windows))]
const EXE_SUFFIX: &str = "";

#[cfg(windows)]
const PATH_SEP: &str = ";";
#[cfg(not(windows))]
const PATH_SEP: &str = ":";

const POSTGRES_PORT: u16 = 5433; // Use non-standard port to avoid conflicts
const POSTGRES_USER: &str = "hotel_admin";
const POSTGRES_DB: &str = "hotel_management";
const CONFIGURED_POSTGRES_MAJOR_VERSION: &str = "18";
const MAX_STARTUP_WAIT_SECS: u64 = 30;
const SEED_PLACEHOLDER_PASSWORD_HASH: &str =
    "$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK";

static BUNDLED_POSTGRES_MAJOR_VERSION: OnceLock<String> = OnceLock::new();

/// Error types for PostgreSQL operations
#[derive(Debug, thiserror::Error)]
pub enum PostgresError {
    #[error("Failed to initialize PostgreSQL data directory: {0}")]
    InitDbFailed(String),

    #[error("Failed to start PostgreSQL server: {0}")]
    StartFailed(String),

    #[error("PostgreSQL server failed to become ready within {seconds} seconds: {details}")]
    StartupTimeout { seconds: u64, details: String },

    #[error("Failed to run migrations: {0}")]
    MigrationFailed(String),

    #[error("PostgreSQL binary not found at: {0}")]
    BinaryNotFound(String),

    #[error(
        "PostgreSQL data directory at this app's data location was created by PostgreSQL {found}, but this build of the app ships PostgreSQL {expected}. Refusing to start so your data is not lost. Recover by either (1) installing a desktop build matching PostgreSQL {found} to read the existing data, (2) running pg_upgrade manually to migrate the data directory from {found} to {expected}, or (3) renaming the data directory aside and letting the app initialize a fresh empty one."
    )]
    IncompatibleDataDirectory { found: String, expected: String },

    #[error("Failed to detect bundled PostgreSQL version: {0}")]
    VersionDetectionFailed(String),

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

fn read_pgdata_version() -> Result<Option<String>, std::io::Error> {
    let version_path = get_pgdata_dir().join("PG_VERSION");
    if !version_path.exists() {
        return Ok(None);
    }

    Ok(Some(
        std::fs::read_to_string(version_path)?.trim().to_string(),
    ))
}

fn extract_postgres_major_version(version_text: &str) -> Option<String> {
    version_text.split_whitespace().find_map(|part| {
        let major: String = part.chars().take_while(|ch| ch.is_ascii_digit()).collect();

        if major.is_empty() {
            None
        } else {
            Some(major)
        }
    })
}

async fn bundled_binary_version(
    app_handle: &AppHandle,
    binary_name: &str,
) -> Result<(String, String, PathBuf), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let binary_path = pgsql_bin.join(format!("{}{}", binary_name, EXE_SUFFIX));

    if !binary_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            binary_path.to_string_lossy().to_string(),
        ));
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

    let mut cmd = tokio::process::Command::new(&binary_path);
    cmd.arg("--version")
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;

    if !output.status.success() {
        let details = command_output_details(&format!("{} --version", binary_name), &output);
        log::error!(
            "Failed to detect bundled PostgreSQL version from {:?}: {}",
            binary_path,
            details
        );
        return Err(PostgresError::VersionDetectionFailed(details));
    }

    let stdout = trimmed_lossy(&output.stdout);
    let stderr = trimmed_lossy(&output.stderr);
    let version_text = if stdout == "<empty>" { stderr } else { stdout };
    let Some(major_version) = extract_postgres_major_version(&version_text) else {
        let details = format!(
            "could not parse major version from {:?} output: {}",
            binary_path, version_text
        );
        log::error!("{}", details);
        return Err(PostgresError::VersionDetectionFailed(details));
    };

    Ok((major_version, version_text, binary_path))
}

async fn detect_bundled_postgres_major_version(
    app_handle: &AppHandle,
) -> Result<String, PostgresError> {
    let (postgres_major, postgres_version, postgres_path) =
        bundled_binary_version(app_handle, "postgres").await?;
    let (initdb_major, initdb_version, initdb_path) =
        bundled_binary_version(app_handle, "initdb").await?;

    log::info!(
        "Bundled PostgreSQL binary {:?} reports: {}",
        postgres_path,
        postgres_version
    );
    log::info!(
        "Bundled initdb binary {:?} reports: {}",
        initdb_path,
        initdb_version
    );

    if postgres_major != initdb_major {
        let details = format!(
            "bundled PostgreSQL binaries are inconsistent: {:?} reports major {}, but {:?} reports major {}",
            postgres_path, postgres_major, initdb_path, initdb_major
        );
        log::error!("{}", details);
        return Err(PostgresError::VersionDetectionFailed(details));
    }

    if postgres_major != CONFIGURED_POSTGRES_MAJOR_VERSION {
        log::warn!(
            "Bundled PostgreSQL binary major version {} does not match configured resource major version {}. Using the actual bundled binary version for data-directory compatibility.",
            postgres_major,
            CONFIGURED_POSTGRES_MAJOR_VERSION
        );
    }

    let _ = BUNDLED_POSTGRES_MAJOR_VERSION.set(postgres_major.clone());
    Ok(postgres_major)
}

fn cached_bundled_postgres_major_version() -> String {
    BUNDLED_POSTGRES_MAJOR_VERSION
        .get()
        .cloned()
        .unwrap_or_else(|| CONFIGURED_POSTGRES_MAJOR_VERSION.to_string())
}

fn ensure_pgdata_version_compatible(expected_version: &str) -> Result<(), PostgresError> {
    if let Some(found) = read_pgdata_version()? {
        if found != expected_version {
            log::error!(
                "PostgreSQL data directory version {} is incompatible with bundled PostgreSQL {} at {:?}",
                found,
                expected_version,
                get_pgdata_dir()
            );
            return Err(PostgresError::IncompatibleDataDirectory {
                found,
                expected: expected_version.to_string(),
            });
        }
    }

    Ok(())
}

async fn refuse_if_pgdata_version_mismatch(expected_version: &str) -> Result<(), PostgresError> {
    let Some(found_version) = read_pgdata_version()? else {
        return Ok(());
    };

    if found_version == expected_version {
        return Ok(());
    }

    log::error!(
        "PostgreSQL data directory at {:?} was created by PostgreSQL {} but bundled PostgreSQL is {}. Refusing to auto-initialize or archive the data directory; the existing data is left untouched on disk.",
        get_pgdata_dir(),
        found_version,
        expected_version
    );
    Err(PostgresError::IncompatibleDataDirectory {
        found: found_version,
        expected: expected_version.to_string(),
    })
}

fn trimmed_lossy(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.is_empty() {
        "<empty>".to_string()
    } else {
        text
    }
}

fn command_output_details(command_name: &str, output: &Output) -> String {
    format!(
        "{} exited with code {:?}\nstdout:\n{}\nstderr:\n{}",
        command_name,
        output.status.code(),
        trimmed_lossy(&output.stdout),
        trimmed_lossy(&output.stderr)
    )
}

fn tail_text(path: &Path, max_lines: usize) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut lines: Vec<&str> = content.lines().rev().take(max_lines).collect();
    lines.reverse();

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn postgres_startup_log_details(log_file: &Path) -> String {
    match tail_text(log_file, 120) {
        Some(tail) => format!("startup log {}:\n{}", log_file.display(), tail),
        None => format!("startup log {} is missing or empty", log_file.display()),
    }
}

/// Initialize PostgreSQL data directory using initdb
pub async fn init_postgres_data_dir(
    app_handle: &AppHandle,
    expected_version: &str,
) -> Result<(), PostgresError> {
    if is_pgdata_initialized() {
        ensure_pgdata_version_compatible(expected_version)?;
        log::info!("PostgreSQL data directory already initialized");
        return Ok(());
    }

    log::info!("Initializing PostgreSQL data directory...");

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let initdb_path = pgsql_bin.join(format!("initdb{}", EXE_SUFFIX));

    if !initdb_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            initdb_path.to_string_lossy().to_string(),
        ));
    }

    let pgdata = get_pgdata_dir();

    // Get current PATH and prepend pgsql/bin so initdb can find postgres.exe
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

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
        let details = command_output_details("initdb", &output);
        log::error!(
            "Failed to initialize PostgreSQL data directory: {}",
            details
        );
        return Err(PostgresError::InitDbFailed(details));
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
pub async fn start_postgres(
    app_handle: &AppHandle,
    expected_version: &str,
) -> Result<(), PostgresError> {
    log::info!("Starting PostgreSQL server...");

    ensure_pgdata_version_compatible(expected_version)?;

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_ctl_path = pgsql_bin.join(format!("pg_ctl{}", EXE_SUFFIX));

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
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

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
        let details = format!(
            "pg_ctl start exited with code {:?}\n{}",
            status.code(),
            postgres_startup_log_details(&log_file)
        );
        log::error!("Failed to start PostgreSQL server: {}", details);
        return Err(PostgresError::StartFailed(details));
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

    let details = postgres_startup_log_details(&log_file);
    log::error!(
        "PostgreSQL server failed to become ready within {} seconds: {}",
        MAX_STARTUP_WAIT_SECS,
        details
    );
    Err(PostgresError::StartupTimeout {
        seconds: MAX_STARTUP_WAIT_SECS,
        details,
    })
}

/// Stop the PostgreSQL server
pub async fn stop_postgres(app_handle: &AppHandle) -> Result<(), PostgresError> {
    log::info!("Stopping PostgreSQL server...");

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_ctl_path = pgsql_bin.join(format!("pg_ctl{}", EXE_SUFFIX));

    if !pg_ctl_path.exists() {
        log::warn!("pg_ctl not found, PostgreSQL may not be installed");
        return Ok(());
    }

    let pgdata = get_pgdata_dir();

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

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
        log::warn!(
            "Failed to stop PostgreSQL (may already be stopped): {}",
            command_output_details("pg_ctl stop", &output)
        );
    } else {
        log::info!("PostgreSQL server stopped successfully");
    }

    Ok(())
}

/// Check if PostgreSQL is running and accepting connections
pub async fn is_postgres_running(app_handle: &AppHandle) -> bool {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_isready_path = pgsql_bin.join(format!("pg_isready{}", EXE_SUFFIX));

    if !pg_isready_path.exists() {
        return false;
    }

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

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
    let bundled_postgres_major_version = detect_bundled_postgres_major_version(app_handle).await?;

    refuse_if_pgdata_version_mismatch(&bundled_postgres_major_version).await?;

    // Check if already running
    if is_postgres_running(app_handle).await {
        log::info!("PostgreSQL is already running");
        return Ok(());
    }

    // Initialize if needed
    init_postgres_data_dir(app_handle, &bundled_postgres_major_version).await?;

    // Start the server (this now includes waiting for ready)
    start_postgres(app_handle, &bundled_postgres_major_version).await
}

/// Create the hotel_management database if it doesn't exist
pub async fn create_database_if_needed(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));

    if !psql_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            psql_path.to_string_lossy().to_string(),
        ));
    }

    // Get current PATH and prepend pgsql/bin
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

    // Check if database exists
    let mut check_cmd = tokio::process::Command::new(&psql_path);
    check_cmd
        .args([
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

    if !check_output.status.success() {
        let details = command_output_details("psql database existence check", &check_output);
        log::error!("Failed to check whether database exists: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Failed to check whether database exists: {}",
            details
        )));
    }

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
    create_cmd
        .args([
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
        let details = command_output_details("psql create database", &create_output);
        log::error!("Failed to create database: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Failed to create database: {}",
            details
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
        log::info!("Running bootstrap seed data...");
        run_sql_files(app_handle, "database/seed-data").await?;
        if load_demo_data_on_first_run() {
            log::info!("HOTEL_DESKTOP_LOAD_DEMO_DATA enabled; running demo data...");
            run_sql_files(app_handle, "database/demo-data").await?;
        }
        randomize_seed_passwords(app_handle).await?;
    }

    repair_bootstrap_password_hashes_if_needed(app_handle).await?;

    log::info!("Database migrations completed successfully");
    Ok(())
}

fn load_demo_data_on_first_run() -> bool {
    std::env::var("HOTEL_DESKTOP_LOAD_DEMO_DATA")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

fn generate_bootstrap_password() -> String {
    let mut bytes = [0u8; 18];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn hash_bootstrap_password(password: &str) -> Result<String, PostgresError> {
    bcrypt::hash(password, bcrypt::DEFAULT_COST).map_err(|err| {
        PostgresError::MigrationFailed(format!("Failed to hash bootstrap password: {}", err))
    })
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

async fn run_psql_scalar_sql(
    app_handle: &AppHandle,
    label: &str,
    sql: &str,
) -> Result<Output, PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));

    if !psql_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            psql_path.to_string_lossy().to_string(),
        ));
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );
    let port = POSTGRES_PORT.to_string();

    let mut cmd = tokio::process::Command::new(&psql_path);
    cmd.args([
        "-h",
        "localhost",
        "-p",
        &port,
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-tAc",
        sql,
    ])
    .env("PATH", &new_path)
    .current_dir(&pgsql_bin)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    if !output.status.success() {
        let details = command_output_details(label, &output);
        log::error!("{} failed: {}", label, details);
        return Err(PostgresError::MigrationFailed(format!(
            "{} failed: {}",
            label, details
        )));
    }

    Ok(output)
}

pub async fn backup_database(
    app_handle: &AppHandle,
    destination: Option<String>,
) -> Result<PathBuf, PostgresError> {
    ensure_postgres_running(app_handle).await?;

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_dump_path = pgsql_bin.join(format!("pg_dump{}", EXE_SUFFIX));

    if !pg_dump_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            pg_dump_path.to_string_lossy().to_string(),
        ));
    }

    let backup_file_name = format!(
        "hotel-backup-{}.dump",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let destination_path = destination
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| get_data_directory().join("backups").join(&backup_file_name));
    let backup_path = if destination_path.exists() && destination_path.is_dir() {
        destination_path.join(&backup_file_name)
    } else {
        destination_path
    };

    if let Some(parent) = backup_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );
    let port = POSTGRES_PORT.to_string();

    let mut cmd = tokio::process::Command::new(&pg_dump_path);
    cmd.args([
        "-h",
        "localhost",
        "-p",
        &port,
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-F",
        "c",
        "-f",
        &backup_path.to_string_lossy(),
    ])
    .env("PATH", &new_path)
    .current_dir(&pgsql_bin)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    if !output.status.success() {
        let details = command_output_details("pg_dump database backup", &output);
        log::error!("Database backup failed: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Database backup failed: {}",
            details
        )));
    }

    log::info!("Database backup written to {:?}", backup_path);
    Ok(backup_path)
}

fn bootstrap_password_file_path() -> PathBuf {
    get_data_directory().join("initial-login-password.txt")
}

fn read_bootstrap_password_file() -> Result<Option<String>, PostgresError> {
    let password_file = bootstrap_password_file_path();

    if !password_file.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&password_file)?;

    for line in content.lines().map(str::trim) {
        if line.is_empty()
            || line.starts_with("Initial desktop login password")
            || line.starts_with("Seeded usernames")
            || line.starts_with("Change account passwords")
            || line.starts_with('-')
        {
            continue;
        }

        return Ok(Some(line.to_string()));
    }

    log::warn!(
        "Initial login password file exists but no password could be parsed at {:?}",
        password_file
    );
    Ok(None)
}

async fn randomize_seed_passwords(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let password = generate_bootstrap_password();
    let password_hash = hash_bootstrap_password(&password)?;
    let sql = format!(
        "UPDATE users SET password_hash = {}, failed_login_attempts = 0, is_locked = false, locked_until = NULL;",
        sql_string_literal(&password_hash)
    );

    run_psql_scalar_sql(app_handle, "psql randomize seed passwords", &sql).await?;
    let usernames_output = run_psql_scalar_sql(
        app_handle,
        "psql list seeded usernames",
        "SELECT COALESCE(string_agg(username, E'\n' ORDER BY username), '') FROM users;",
    )
    .await?;
    let usernames = trimmed_lossy(&usernames_output.stdout);
    let username_lines = usernames
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|username| format!("- {}", username))
        .collect::<Vec<_>>()
        .join("\n");

    let password_file = bootstrap_password_file_path();
    let contents = format!(
        "Initial desktop login password for seeded accounts:\n{}\n\nSeeded usernames:\n{}\n\nChange account passwords after first login.\n",
        password,
        username_lines
    );
    std::fs::write(&password_file, contents)?;
    log::info!(
        "Seed account passwords randomized. Initial login password written to {:?}",
        password_file
    );

    Ok(())
}

async fn repair_bootstrap_password_hashes_if_needed(
    app_handle: &AppHandle,
) -> Result<(), PostgresError> {
    let Some(password) = read_bootstrap_password_file()? else {
        return Ok(());
    };

    let password_hash = hash_bootstrap_password(&password)?;
    let sql = format!(
        r#"
WITH updated AS (
    UPDATE users
    SET password_hash = {},
        failed_login_attempts = 0,
        is_locked = false,
        locked_until = NULL
    WHERE password_hash LIKE '$2a$%'
       OR password_hash = {}
    RETURNING 1
)
SELECT COUNT(*) FROM updated;
"#,
        sql_string_literal(&password_hash),
        sql_string_literal(SEED_PLACEHOLDER_PASSWORD_HASH)
    );

    let output =
        run_psql_scalar_sql(app_handle, "psql repair bootstrap password hashes", &sql).await?;
    let updated_count = trimmed_lossy(&output.stdout);

    if updated_count != "0" && updated_count != "<empty>" {
        log::warn!(
            "Repaired {} desktop bootstrap password hash(es) using {:?}. Failed login counters were reset for repaired users.",
            updated_count,
            bootstrap_password_file_path()
        );
    }

    Ok(())
}

/// Check if database has been initialized (check for users table)
async fn is_database_initialized(app_handle: &AppHandle) -> Result<bool, PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

    let mut cmd = tokio::process::Command::new(&psql_path);
    cmd.args([
        "-h",
        "localhost",
        "-p",
        &POSTGRES_PORT.to_string(),
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
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
    if !output.status.success() {
        let details = command_output_details("psql database initialization check", &output);
        log::error!("Failed to check database initialization: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Failed to check database initialization: {}",
            details
        )));
    }

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
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );

    for entry in sql_files {
        let file_path = entry.path();
        log::info!("Running SQL file: {:?}", file_path.file_name());

        let mut cmd = tokio::process::Command::new(&psql_path);
        cmd.args([
            "-h",
            "localhost",
            "-p",
            &POSTGRES_PORT.to_string(),
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-f",
            &file_path.to_string_lossy(),
        ])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().await?;

        if !output.status.success() {
            let details = command_output_details("psql run SQL file", &output);
            log::error!(
                "Failed to run SQL file {:?}: {}",
                file_path.file_name(),
                details
            );
            return Err(PostgresError::MigrationFailed(format!(
                "Failed to run SQL file {:?}: {}",
                file_path.file_name(),
                details
            )));
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
    let bundled_version = cached_bundled_postgres_major_version();
    let data_version = read_pgdata_version()
        .map_err(|err| {
            log::warn!("Failed to read PostgreSQL data directory version: {}", err);
            err
        })
        .ok()
        .flatten();
    let version_compatible = data_version
        .as_deref()
        .map_or(true, |version| version == bundled_version.as_str());

    serde_json::json!({
        "running": running,
        "initialized": initialized,
        "data_version": data_version,
        "bundled_version": bundled_version,
        "configured_bundled_version": CONFIGURED_POSTGRES_MAJOR_VERSION,
        "version_compatible": version_compatible,
        "port": POSTGRES_PORT,
        "user": POSTGRES_USER,
        "database": POSTGRES_DB,
        "data_directory": pgdata.to_string_lossy(),
    })
}
