//! PostgreSQL process management
//!
//! Handles the lifecycle of the bundled PostgreSQL server:
//! - Initialization (initdb)
//! - Starting/stopping the server
//! - Running schema and data bootstrap scripts
//! - Health checks

use rand::RngCore;
use std::fs::OpenOptions;
use std::io::Write;
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
const POSTGRES_PASSWORD_FILE: &str = "postgres-password.txt";
const CONFIGURED_POSTGRES_MAJOR_VERSION: &str = "19";
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

    #[error("Failed to run database setup: {0}")]
    MigrationFailed(String),

    #[error("PostgreSQL binary not found at: {0}")]
    BinaryNotFound(String),

    #[error(
        "PostgreSQL data directory at this app's data location was created by PostgreSQL {found}, but this build of the app ships PostgreSQL {expected}. Refusing to start so your data is not lost. Recover by either (1) installing a desktop build matching PostgreSQL {found} to read the existing data, (2) running pg_upgrade manually to migrate the data directory from {found} to {expected}, or (3) renaming the data directory aside and letting the app initialize a fresh empty one."
    )]
    IncompatibleDataDirectory { found: String, expected: String },

    #[error("Failed to detect bundled PostgreSQL version: {0}")]
    VersionDetectionFailed(String),

    #[error("Backup destination is outside the allowed data directory: {0}")]
    InvalidBackupDestination(String),

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
    let clean_path = if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
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

fn generate_postgres_password() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn postgres_password_file_path() -> PathBuf {
    get_data_directory().join(POSTGRES_PASSWORD_FILE)
}

fn tighten_secret_file_permissions(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    #[cfg(not(unix))]
    let _ = path;

    Ok(())
}

fn read_postgres_password_file() -> Result<Option<String>, PostgresError> {
    let path = postgres_password_file_path();
    if !path.exists() {
        return Ok(None);
    }

    tighten_secret_file_permissions(&path)?;
    let password = std::fs::read_to_string(path)?.trim().to_string();
    if password.is_empty() {
        return Ok(None);
    }

    Ok(Some(password))
}

fn write_postgres_password_file(password: &str) -> Result<(), PostgresError> {
    let path = postgres_password_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = match options.open(&path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            tighten_secret_file_permissions(&path)?;
            return Ok(());
        }
        Err(err) => return Err(err.into()),
    };

    file.write_all(password.as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()?;
    tighten_secret_file_permissions(&path)?;
    Ok(())
}

fn read_or_create_postgres_password() -> Result<String, PostgresError> {
    if let Some(password) = read_postgres_password_file()? {
        return Ok(password);
    }

    let password = generate_postgres_password();
    write_postgres_password_file(&password)?;
    log::info!(
        "Generated local PostgreSQL credential at {:?}",
        postgres_password_file_path()
    );
    read_postgres_password_file()?.ok_or_else(|| {
        PostgresError::MigrationFailed("Failed to persist PostgreSQL credential".to_string())
    })
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
    let _postgres_password = read_or_create_postgres_password()?;
    let password_file = postgres_password_file_path();

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
        "--pwfile",
        &password_file.to_string_lossy(),
        "--auth-host=scram-sha-256",
        "--auth-local=scram-sha-256",
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

/// Configure PostgreSQL for desktop use (localhost-only, password-authenticated).
fn configure_postgres_for_desktop(pgdata: &Path) -> Result<(), std::io::Error> {
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
password_encryption = 'scram-sha-256'
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
"#,
        POSTGRES_PORT
    ));

    std::fs::write(&conf_path, conf_content)?;
    write_pg_hba_for_desktop(pgdata)?;

    Ok(())
}

fn write_pg_hba_for_desktop(pgdata: &Path) -> Result<(), std::io::Error> {
    let hba_path = pgdata.join("pg_hba.conf");
    let hba_content = r#"
# Hotel Desktop App - Local connections only
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
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

async fn reload_postgres_config(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_ctl_path = pgsql_bin.join(format!("pg_ctl{}", EXE_SUFFIX));

    if !pg_ctl_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            pg_ctl_path.to_string_lossy().to_string(),
        ));
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );
    let pgdata = get_pgdata_dir();

    let mut cmd = tokio::process::Command::new(&pg_ctl_path);
    cmd.args(["reload", "-D", &pgdata.to_string_lossy()])
        .env("PATH", &new_path)
        .current_dir(&pgsql_bin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    if !output.status.success() {
        let details = command_output_details("pg_ctl reload", &output);
        log::error!("Failed to reload PostgreSQL config: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Failed to reload PostgreSQL config: {}",
            details
        )));
    }

    Ok(())
}

async fn ensure_postgres_password_auth(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let password = read_or_create_postgres_password()?;
    let sql = format!(
        "SET password_encryption = 'scram-sha-256'; ALTER ROLE {} WITH PASSWORD {};",
        POSTGRES_USER,
        sql_string_literal(&password)
    );

    run_psql_scalar_sql_in_database(
        app_handle,
        "postgres",
        "psql set desktop role password",
        &sql,
    )
    .await?;
    write_pg_hba_for_desktop(&get_pgdata_dir())?;
    reload_postgres_config(app_handle).await?;

    log::info!("PostgreSQL desktop role requires SCRAM authentication");
    Ok(())
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
        ensure_postgres_password_auth(app_handle).await?;
        return Ok(());
    }

    // Initialize if needed
    init_postgres_data_dir(app_handle, &bundled_postgres_major_version).await?;

    // Start the server (this now includes waiting for ready)
    start_postgres(app_handle, &bundled_postgres_major_version).await?;
    ensure_postgres_password_auth(app_handle).await
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
        .env("PGPASSWORD", read_or_create_postgres_password()?)
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
        .env("PGPASSWORD", read_or_create_postgres_password()?)
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

/// Run database schema and data bootstrap scripts if needed
pub async fn run_database_setup(app_handle: &AppHandle) -> Result<(), PostgresError> {
    // First ensure database exists
    create_database_if_needed(app_handle).await?;

    let already_initialized = is_database_initialized(app_handle).await?;

    // Always run schema and data scripts. They are idempotent and keep fresh
    // desktop installs and existing databases on the same consolidated path.
    let resource_dir = clean_resource_dir(app_handle);

    log::info!("Running database schema...");
    run_sql_file(app_handle, &resource_dir.join("database/schema.sql")).await?;

    log::info!("Running database data bootstrap...");
    run_sql_file(app_handle, &resource_dir.join("database/data.sql")).await?;

    if !already_initialized {
        randomize_seed_passwords(app_handle).await?;
    }

    repair_bootstrap_password_hashes_if_needed(app_handle).await?;

    log::info!("Database setup completed successfully");
    Ok(())
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
    run_psql_scalar_sql_in_database(app_handle, POSTGRES_DB, label, sql).await
}

async fn run_psql_scalar_sql_in_database(
    app_handle: &AppHandle,
    database: &str,
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
        database,
        "-tAc",
        sql,
    ])
    .env("PGPASSWORD", read_or_create_postgres_password()?)
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

/// Ensure a requested backup destination stays inside the app's data directory.
///
/// The backup command is exposed over Tauri IPC and reachable from any script
/// running in the webview, so `candidate` is untrusted. This resolves symlinks
/// in the existing portion of the path and rejects `..` traversal or any
/// absolute path that escapes the data directory, so a full pg_dump (guest PII
/// and payment data) can never be written outside the app's own storage.
fn ensure_within_data_dir(candidate: &Path) -> Result<PathBuf, PostgresError> {
    use std::path::Component;

    let reject = || PostgresError::InvalidBackupDestination(candidate.to_string_lossy().to_string());

    // Any `..` component is a traversal attempt; refuse outright.
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(reject());
    }

    let data_dir = get_data_directory();
    // Creating the app's own data directory is always safe and lets us
    // canonicalize the allow-list root even on a first run.
    std::fs::create_dir_all(&data_dir)?;
    let root = std::fs::canonicalize(&data_dir)?;

    // Canonicalize the longest existing prefix of `candidate` (resolving any
    // symlinks in it), then re-append the not-yet-created trailing components.
    let mut existing: &Path = candidate;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let base = loop {
        match std::fs::canonicalize(existing) {
            Ok(base) => break base,
            Err(_) => match existing.parent() {
                Some(parent) => {
                    if let Some(name) = existing.file_name() {
                        tail.push(name.to_os_string());
                    }
                    existing = parent;
                }
                // Walked to the top without finding an existing ancestor (e.g. a
                // relative path against an unknown CWD): treat as outside root.
                None => return Err(reject()),
            },
        }
    };

    let mut resolved = base;
    for name in tail.iter().rev() {
        resolved.push(name);
    }

    if !resolved.starts_with(&root) {
        return Err(reject());
    }

    Ok(resolved)
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
    let requested_path = if destination_path.exists() && destination_path.is_dir() {
        destination_path.join(&backup_file_name)
    } else {
        destination_path
    };

    // `destination` is untrusted (the command is reachable from any webview
    // script); keep the dump inside the app's data directory.
    let backup_path = ensure_within_data_dir(&requested_path)?;

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
    .env("PGPASSWORD", read_or_create_postgres_password()?)
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

/// Prefix + suffix identifying a backup dump produced by this app.
/// Filenames look like `hotel-backup-YYYYMMDD-HHMMSS.dump`.
const BACKUP_FILE_PREFIX: &str = "hotel-backup-";
const BACKUP_FILE_SUFFIX: &str = ".dump";

/// Number of most-recent backups to retain when pruning.
const BACKUP_RETENTION_COUNT: usize = 14;

fn backups_directory() -> PathBuf {
    get_data_directory().join("backups")
}

fn is_managed_backup_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(BACKUP_FILE_SUFFIX),
        None => false,
    }
}

/// List managed backup dumps in the backups directory, newest first (by mtime).
fn list_managed_backups() -> Vec<PathBuf> {
    let dir = backups_directory();
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = match std::fs::read_dir(&dir) {
        Ok(read_dir) => read_dir
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| is_managed_backup_file(path))
            .map(|path| {
                let mtime = path
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(std::time::UNIX_EPOCH);
                (path, mtime)
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    // Newest first.
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    entries.into_iter().map(|(path, _)| path).collect()
}

/// Metadata about the most recent managed backup, surfaced to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LatestBackup {
    pub path: String,
    pub filename: String,
    /// Backup timestamp as RFC3339 (from file mtime), local-agnostic; the FE
    /// renders it in local time.
    pub timestamp: String,
}

fn latest_managed_backup() -> Option<LatestBackup> {
    let path = list_managed_backups().into_iter().next()?;
    let filename = path.file_name()?.to_string_lossy().to_string();
    let mtime = path.metadata().ok()?.modified().ok()?;
    let timestamp: chrono::DateTime<chrono::Utc> = mtime.into();
    Some(LatestBackup {
        path: path.to_string_lossy().to_string(),
        filename,
        timestamp: timestamp.to_rfc3339(),
    })
}

/// Delete all but the newest `BACKUP_RETENTION_COUNT` managed backup dumps.
/// Only files matching the managed backup pattern are ever removed.
fn prune_old_backups() {
    let backups = list_managed_backups();
    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }

    for stale in backups.into_iter().skip(BACKUP_RETENTION_COUNT) {
        // Extra safety: never remove anything that is not a managed dump.
        if !is_managed_backup_file(&stale) {
            continue;
        }
        match std::fs::remove_file(&stale) {
            Ok(()) => log::info!("Pruned old database backup {:?}", stale),
            Err(err) => log::warn!("Failed to prune old database backup {:?}: {}", stale, err),
        }
    }
}

/// Run a backup into the default backups directory and prune old dumps.
/// Used by the scheduled backup task; failures are returned to the caller,
/// which logs and continues without crashing the app.
pub async fn run_scheduled_backup(app_handle: &AppHandle) -> Result<PathBuf, PostgresError> {
    let path = backup_database(app_handle, None).await?;
    prune_old_backups();
    Ok(path)
}

/// Summary returned to the frontend after a successful guided upgrade.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpgradeSummary {
    pub restored_backup: String,
    pub retired_data_dir: String,
    pub from_version: String,
    pub to_version: String,
}

/// Restore a custom-format (`pg_dump -F c`) backup into the freshly-created
/// database using the bundled `pg_restore`.
async fn restore_backup_dump(
    app_handle: &AppHandle,
    backup_path: &Path,
) -> Result<(), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let pg_restore_path = pgsql_bin.join(format!("pg_restore{}", EXE_SUFFIX));

    if !pg_restore_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            pg_restore_path.to_string_lossy().to_string(),
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

    let mut cmd = tokio::process::Command::new(&pg_restore_path);
    cmd.args([
        "-h",
        "localhost",
        "-p",
        &port,
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        &backup_path.to_string_lossy(),
    ])
    .env("PGPASSWORD", read_or_create_postgres_password()?)
    .env("PATH", &new_path)
    .current_dir(&pgsql_bin)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    if !output.status.success() {
        let details = command_output_details("pg_restore database restore", &output);
        log::error!("Database restore failed: {}", details);
        return Err(PostgresError::MigrationFailed(format!(
            "Database restore failed: {}",
            details
        )));
    }

    Ok(())
}

/// Guided major-version upgrade: retire the incompatible data directory, create
/// a fresh cluster with the bundled version, and restore the latest backup.
///
/// Safety guarantees:
/// - The old data directory is NEVER deleted — it is renamed aside and left on disk.
/// - If ANY step fails, PostgreSQL is stopped, the half-built new cluster is
///   removed, the retired directory is renamed back to its original name, and a
///   descriptive error is returned so the system ends in the pre-upgrade state.
/// - If no backup exists, no destructive action is taken.
pub async fn upgrade_database_from_backup(
    app_handle: &AppHandle,
) -> Result<UpgradeSummary, PostgresError> {
    let bundled_major = detect_bundled_postgres_major_version(app_handle).await?;

    // (a) Verify the mismatch state still holds.
    let Some(found_major) = read_pgdata_version()? else {
        return Err(PostgresError::MigrationFailed(
            "No PostgreSQL data directory present; nothing to upgrade.".to_string(),
        ));
    };
    if found_major == bundled_major {
        return Err(PostgresError::MigrationFailed(format!(
            "Data directory is already PostgreSQL {}; no upgrade needed.",
            bundled_major
        )));
    }

    // Require a backup before doing anything destructive.
    let Some(latest) = latest_managed_backup() else {
        return Err(PostgresError::MigrationFailed(format!(
            "No backup available to restore. The existing PostgreSQL {} data directory has been left untouched. To recover, install a desktop build matching PostgreSQL {} to read the existing data, or migrate the data directory manually with pg_upgrade.",
            found_major, found_major
        )));
    };
    let backup_path = PathBuf::from(&latest.path);

    let pgdata = get_pgdata_dir();
    let retired_dir = pgdata.with_file_name(format!(
        "pgdata-pg{}-retired-{}",
        found_major,
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    ));

    // Make sure nothing is holding the old cluster; ignore errors (it should not
    // be running because we refuse to start on mismatch).
    let _ = stop_postgres(app_handle).await;

    // (b) Rename the old data dir aside — NEVER delete it.
    log::info!(
        "Retiring incompatible PostgreSQL {} data directory {:?} -> {:?}",
        found_major,
        pgdata,
        retired_dir
    );
    std::fs::rename(&pgdata, &retired_dir).map_err(|err| {
        PostgresError::MigrationFailed(format!(
            "Failed to retire old data directory {:?}: {}. No changes were made.",
            pgdata, err
        ))
    })?;

    // From here on, any failure must roll back: remove the new cluster and
    // rename the retired directory back to the original name.
    let rollback = |context: String| -> PostgresError {
        log::error!(
            "Upgrade failed ({}); rolling back to pre-upgrade state",
            context
        );
        // Best-effort: remove a half-built new cluster if one exists.
        if pgdata.exists() {
            if let Err(err) = std::fs::remove_dir_all(&pgdata) {
                log::error!(
                    "Rollback: failed to remove half-built data directory {:?}: {}",
                    pgdata,
                    err
                );
            }
        }
        // Restore the original data directory name.
        if let Err(err) = std::fs::rename(&retired_dir, &pgdata) {
            log::error!(
                "Rollback: failed to restore data directory {:?} -> {:?}: {}. The pre-upgrade data is preserved at {:?}.",
                retired_dir, pgdata, err, retired_dir
            );
            return PostgresError::MigrationFailed(format!(
                "{}. Additionally, automatic rollback could not restore the data directory; your original data is preserved at {:?} and must be renamed back to {:?} manually.",
                context, retired_dir, pgdata
            ));
        }
        PostgresError::MigrationFailed(format!(
            "{}. The system was rolled back to its pre-upgrade state; your original data is intact.",
            context
        ))
    };

    // (c) Create a fresh cluster with the bundled version.
    if let Err(err) = init_postgres_data_dir(app_handle, &bundled_major).await {
        return Err(rollback(format!("initdb of fresh cluster failed: {}", err)));
    }

    // (d) Start postgres.
    if let Err(err) = start_postgres(app_handle, &bundled_major).await {
        return Err(rollback(format!("starting fresh cluster failed: {}", err)));
    }
    if let Err(err) = ensure_postgres_password_auth(app_handle).await {
        let _ = stop_postgres(app_handle).await;
        return Err(rollback(format!("configuring role auth failed: {}", err)));
    }

    // Create the target database before restoring into it.
    if let Err(err) = create_database_if_needed(app_handle).await {
        let _ = stop_postgres(app_handle).await;
        return Err(rollback(format!("creating database failed: {}", err)));
    }

    // (e) Restore the latest backup dump.
    if let Err(err) = restore_backup_dump(app_handle, &backup_path).await {
        let _ = stop_postgres(app_handle).await;
        return Err(rollback(format!(
            "restore of backup {:?} failed: {}",
            backup_path, err
        )));
    }

    // (f) Run the migrations / schema bootstrap step (idempotent).
    if let Err(err) = run_database_setup(app_handle).await {
        let _ = stop_postgres(app_handle).await;
        return Err(rollback(format!(
            "post-restore database setup failed: {}",
            err
        )));
    }

    // (g) Success.
    log::info!(
        "Guided upgrade complete: PostgreSQL {} -> {}, restored {:?}, retired old data at {:?}",
        found_major,
        bundled_major,
        backup_path,
        retired_dir
    );
    Ok(UpgradeSummary {
        restored_backup: latest.filename,
        retired_data_dir: retired_dir.to_string_lossy().to_string(),
        from_version: found_major,
        to_version: bundled_major,
    })
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
    .env("PGPASSWORD", read_or_create_postgres_password()?)
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

fn clean_resource_dir(app_handle: &AppHandle) -> PathBuf {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // Strip the \\?\ extended-length path prefix on Windows
    let path_str = resource_dir.to_string_lossy();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        resource_dir
    }
}

async fn run_sql_file(app_handle: &AppHandle, file_path: &Path) -> Result<(), PostgresError> {
    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!(
        "{}{}{}",
        pgsql_bin.to_string_lossy(),
        PATH_SEP,
        current_path
    );
    let port = POSTGRES_PORT.to_string();

    log::info!("Running SQL file: {:?}", file_path.file_name());

    let mut cmd = tokio::process::Command::new(&psql_path);
    cmd.arg("-h")
        .arg("localhost")
        .arg("-p")
        .arg(&port)
        .arg("-U")
        .arg(POSTGRES_USER)
        .arg("-d")
        .arg(POSTGRES_DB)
        .arg("-v")
        .arg("ON_ERROR_STOP=1")
        .arg("--single-transaction")
        .arg("-f")
        .arg(file_path)
        .env("PGPASSWORD", read_or_create_postgres_password()?)
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

    Ok(())
}

/// Get the DATABASE_URL for the backend
pub fn get_database_url() -> Result<String, PostgresError> {
    let password = read_or_create_postgres_password()?;
    Ok(format!(
        "postgres://{}:{}@localhost:{}/{}",
        POSTGRES_USER, password, POSTGRES_PORT, POSTGRES_DB
    ))
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
        .is_none_or(|version| version == bundled_version.as_str());

    // A major-version mismatch means we refuse to auto-start (see
    // refuse_if_pgdata_version_mismatch). Surface this as a machine-readable
    // state so the webview can offer a guided restore-from-backup upgrade.
    let needs_upgrade = data_version.is_some() && !version_compatible;
    let latest_backup = if needs_upgrade {
        latest_managed_backup()
    } else {
        None
    };

    serde_json::json!({
        "running": running,
        "initialized": initialized,
        "data_version": data_version,
        "bundled_version": bundled_version,
        "configured_bundled_version": CONFIGURED_POSTGRES_MAJOR_VERSION,
        "version_compatible": version_compatible,
        "needs_upgrade": needs_upgrade,
        "data_dir_major": data_version,
        "bundled_major": bundled_version,
        "latest_backup": latest_backup,
        "port": POSTGRES_PORT,
        "user": POSTGRES_USER,
        "database": POSTGRES_DB,
        "password_auth": true,
        "data_directory": pgdata.to_string_lossy(),
    })
}
