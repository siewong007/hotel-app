//! PostgreSQL process management
//!
//! Handles the lifecycle of the bundled PostgreSQL server:
//! - Initialization (initdb)
//! - Starting/stopping the server
//! - Running schema and data bootstrap scripts
//! - Health checks

use rand::RngExt;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

use crate::get_data_directory;

mod patches;

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
const CONFIGURED_POSTGRES_BUILD_IDENTITY: &str = "19beta2";
const POSTGRES_V1_CHECKSUM: &str =
    "sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d";
const POSTGRES_BUILD_IDENTITY_FILE: &str = ".hotel-postgres-build-identity";
// Desktop builds released before the marker was introduced bundled 19beta1.
// This one-time inference preserves those clusters while ensuring a later
// 19 beta, RC, or GA build cannot reuse them based on PG_VERSION alone.
const LEGACY_UNMARKED_POSTGRES_BUILD_IDENTITY: &str = "19beta1";
const MAX_STARTUP_WAIT_SECS: u64 = 30;
const SEED_PLACEHOLDER_PASSWORD_HASH: &str =
    "$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK";

#[derive(Clone, Debug, PartialEq, Eq)]
struct PostgresBuildVersion {
    major: String,
    build_identity: String,
}

#[derive(Debug, PartialEq, Eq)]
enum DataDirectoryCompatibility {
    Compatible,
    CompatibleLegacyMarkerMissing,
    Incompatible { found: String },
}

static BUNDLED_POSTGRES_VERSION: OnceLock<PostgresBuildVersion> = OnceLock::new();

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
        "PostgreSQL data directory at this app's data location was created by PostgreSQL {found}, but this build of the app ships PostgreSQL {expected}. Refusing to start so your data is not lost. Recover by either (1) installing a desktop build matching PostgreSQL {found} to read the existing data, (2) using a logical backup and restore to migrate from {found} to {expected}, or (3) renaming the data directory aside and letting the app initialize a fresh empty one."
    )]
    IncompatibleDataDirectory { found: String, expected: String },

    #[error("Failed to detect bundled PostgreSQL version: {0}")]
    VersionDetectionFailed(String),

    #[error("Backup destination is outside the allowed data directory: {0}")]
    InvalidBackupDestination(String),

    #[error(
        "Port {port} is already used by a PostgreSQL server this app did not start (the app's data directory has no matching postmaster.pid). This build manages its own embedded database on port {port}; free the port by stopping that other PostgreSQL instance (or moving it to another port), then start the app again."
    )]
    ForeignServerOnPort { port: u16 },

    #[error(
        "Another backup or restore is already in progress; wait for it to finish, then try again."
    )]
    OperationInProgress,

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

fn pgdata_build_identity_path() -> PathBuf {
    get_pgdata_dir().join(POSTGRES_BUILD_IDENTITY_FILE)
}

fn read_pgdata_build_identity() -> Result<Option<String>, std::io::Error> {
    let marker_path = pgdata_build_identity_path();
    if !marker_path.exists() {
        return Ok(None);
    }

    Ok(Some(
        std::fs::read_to_string(marker_path)?
            .trim()
            .to_ascii_lowercase(),
    ))
}

fn write_pgdata_build_identity(build_identity: &str) -> Result<(), std::io::Error> {
    std::fs::write(
        pgdata_build_identity_path(),
        format!("{}\n", build_identity.to_ascii_lowercase()),
    )
}

fn extract_postgres_build_version(version_text: &str) -> Option<PostgresBuildVersion> {
    version_text.split_whitespace().find_map(|part| {
        let version_token = part
            .trim_matches(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '.'))
            .to_ascii_lowercase();
        let major: String = version_token
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();

        if major.is_empty() {
            return None;
        }

        // PostgreSQL 10+ GA minor releases are data-directory compatible, so
        // 19.1 normalizes to 19. Pre-release builds are not guaranteed to be
        // compatible and therefore retain their exact beta/RC/devel identity.
        let build_identity = if version_token.contains("beta")
            || version_token.contains("rc")
            || version_token.contains("devel")
        {
            version_token
        } else {
            major.clone()
        };

        Some(PostgresBuildVersion {
            major,
            build_identity,
        })
    })
}

fn classify_pgdata_compatibility(
    data_major: Option<&str>,
    data_build_identity: Option<&str>,
    expected: &PostgresBuildVersion,
) -> DataDirectoryCompatibility {
    let Some(data_major) = data_major else {
        return DataDirectoryCompatibility::Compatible;
    };

    if data_major != expected.major {
        return DataDirectoryCompatibility::Incompatible {
            found: data_major.to_string(),
        };
    }

    if let Some(data_build_identity) = data_build_identity {
        if data_build_identity.eq_ignore_ascii_case(&expected.build_identity) {
            return DataDirectoryCompatibility::Compatible;
        }

        let found = if data_build_identity.is_empty() {
            format!("{} (empty desktop build marker)", data_major)
        } else {
            data_build_identity.to_string()
        };
        return DataDirectoryCompatibility::Incompatible { found };
    }

    if data_major == CONFIGURED_POSTGRES_MAJOR_VERSION {
        if expected.build_identity == LEGACY_UNMARKED_POSTGRES_BUILD_IDENTITY {
            return DataDirectoryCompatibility::CompatibleLegacyMarkerMissing;
        }

        return DataDirectoryCompatibility::Incompatible {
            found: format!(
                "{} (legacy unmarked desktop cluster, inferred {})",
                data_major, LEGACY_UNMARKED_POSTGRES_BUILD_IDENTITY
            ),
        };
    }

    DataDirectoryCompatibility::Incompatible {
        found: format!("{} (desktop build identity unknown)", data_major),
    }
}

async fn bundled_binary_version(
    app_handle: &AppHandle,
    binary_name: &str,
) -> Result<(PostgresBuildVersion, String, PathBuf), PostgresError> {
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
    let Some(version) = extract_postgres_build_version(&version_text) else {
        let details = format!(
            "could not parse build version from {:?} output: {}",
            binary_path, version_text
        );
        log::error!("{}", details);
        return Err(PostgresError::VersionDetectionFailed(details));
    };

    Ok((version, version_text, binary_path))
}

async fn detect_bundled_postgres_version(
    app_handle: &AppHandle,
) -> Result<PostgresBuildVersion, PostgresError> {
    let (postgres_build, postgres_version, postgres_path) =
        bundled_binary_version(app_handle, "postgres").await?;
    let (initdb_build, initdb_version, initdb_path) =
        bundled_binary_version(app_handle, "initdb").await?;
    let (pg_ctl_build, pg_ctl_version, pg_ctl_path) =
        bundled_binary_version(app_handle, "pg_ctl").await?;

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
    log::info!(
        "Bundled pg_ctl binary {:?} reports: {}",
        pg_ctl_path,
        pg_ctl_version
    );

    if postgres_build != initdb_build || postgres_build != pg_ctl_build {
        let details = format!(
            "bundled PostgreSQL binaries are inconsistent: {:?} reports {}, {:?} reports {}, and {:?} reports {}",
            postgres_path,
            postgres_build.build_identity,
            initdb_path,
            initdb_build.build_identity,
            pg_ctl_path,
            pg_ctl_build.build_identity
        );
        log::error!("{}", details);
        return Err(PostgresError::VersionDetectionFailed(details));
    }

    if postgres_build.major != CONFIGURED_POSTGRES_MAJOR_VERSION
        || postgres_build.build_identity != CONFIGURED_POSTGRES_BUILD_IDENTITY
    {
        let details = format!(
            "bundled PostgreSQL build {} (major {}) does not match configured resource build {} (major {})",
            postgres_build.build_identity,
            postgres_build.major,
            CONFIGURED_POSTGRES_BUILD_IDENTITY,
            CONFIGURED_POSTGRES_MAJOR_VERSION
        );
        log::error!("{}", details);
        return Err(PostgresError::VersionDetectionFailed(details));
    }

    let _ = BUNDLED_POSTGRES_VERSION.set(postgres_build.clone());
    Ok(postgres_build)
}

fn cached_bundled_postgres_version() -> PostgresBuildVersion {
    BUNDLED_POSTGRES_VERSION
        .get()
        .cloned()
        .unwrap_or_else(|| PostgresBuildVersion {
            major: CONFIGURED_POSTGRES_MAJOR_VERSION.to_string(),
            build_identity: CONFIGURED_POSTGRES_BUILD_IDENTITY.to_string(),
        })
}

fn ensure_pgdata_version_compatible(expected: &PostgresBuildVersion) -> Result<(), PostgresError> {
    let data_major = read_pgdata_version()?;
    let data_build_identity = read_pgdata_build_identity()?;

    match classify_pgdata_compatibility(
        data_major.as_deref(),
        data_build_identity.as_deref(),
        expected,
    ) {
        DataDirectoryCompatibility::Compatible => Ok(()),
        DataDirectoryCompatibility::CompatibleLegacyMarkerMissing => {
            write_pgdata_build_identity(&expected.build_identity)?;
            log::info!(
                "Recorded PostgreSQL desktop build identity {} for legacy unmarked data directory {:?}",
                expected.build_identity,
                get_pgdata_dir()
            );
            Ok(())
        }
        DataDirectoryCompatibility::Incompatible { found } => {
            log::error!(
                "PostgreSQL data directory build {} is incompatible with bundled PostgreSQL {} at {:?}",
                found,
                expected.build_identity,
                get_pgdata_dir()
            );
            Err(PostgresError::IncompatibleDataDirectory {
                found,
                expected: expected.build_identity.clone(),
            })
        }
    }
}

async fn refuse_if_pgdata_version_mismatch(
    expected: &PostgresBuildVersion,
) -> Result<(), PostgresError> {
    ensure_pgdata_version_compatible(expected)
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
    let bytes: [u8; 32] = rand::rng().random();
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
async fn init_postgres_data_dir(
    app_handle: &AppHandle,
    expected_version: &PostgresBuildVersion,
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
    write_pgdata_build_identity(&expected_version.build_identity)?;

    log::info!(
        "PostgreSQL data directory initialized successfully for build {}",
        expected_version.build_identity
    );
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
async fn start_postgres(
    app_handle: &AppHandle,
    expected_version: &PostgresBuildVersion,
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

/// True when the app's own data directory owns the server listening on
/// [`POSTGRES_PORT`].
///
/// A running PostgreSQL writes `postmaster.pid` into its data directory with
/// a fixed layout: line 1 is the PID, lines 2–3 the data directory and start
/// time, and line 4 the listening port. A live pidfile in OUR pgdata naming
/// our port proves the listener on 5433 is ours. A pidfile naming another
/// port, or one whose process is dead (stale file after an unclean
/// shutdown), means the port — if anything answers there at all — belongs to
/// someone else.
fn data_dir_owns_running_server() -> bool {
    let Some((pid, port)) = read_postmaster_pid(get_pgdata_dir().join("postmaster.pid")) else {
        return false;
    };
    if port != POSTGRES_PORT || !process_is_alive(pid) {
        return false;
    }
    true
}

/// Parse `(pid, port)` from a postmaster.pid file; `None` when missing or
/// malformed.
fn read_postmaster_pid(path: std::path::PathBuf) -> Option<(u32, u16)> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut lines = content.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    // Lines: 1 pid, 2 datadir, 3 start time, 4 port.
    let port = lines.nth(2)?.trim().parse::<u16>().ok()?;
    Some((pid, port))
}

/// Signal-0 liveness probe for the pidfile owner. `kill -0` succeeds for any
/// process the caller may signal, and fails (ESRCH) once it has exited —
/// which is exactly the stale-pidfile case. Windows keeps the previous
/// accept behaviour: its pidfiles are written identically but probing needs
/// OS-specific APIs, and unclean-shutdown-then-foreign-server is far less
/// likely there than the plain foreign-server case this check targets.
fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}
/// Ensure PostgreSQL is running, starting it if necessary
pub async fn ensure_postgres_running(app_handle: &AppHandle) -> Result<(), PostgresError> {
    let bundled_postgres_version = detect_bundled_postgres_version(app_handle).await?;

    refuse_if_pgdata_version_mismatch(&bundled_postgres_version).await?;

    // Check if already running
    if is_postgres_running(app_handle).await {
        // `pg_isready` on POSTGRES_PORT cannot tell our sidecar from any
        // other PostgreSQL that happens to listen there. Adopting a foreign
        // server made every later step fail with an opaque "password
        // authentication failed"; a live postmaster.pid in OUR pgdata is the
        // ownership proof.
        if data_dir_owns_running_server() {
            log::info!("PostgreSQL is already running");
            ensure_postgres_password_auth(app_handle).await?;
            return Ok(());
        }
        return Err(PostgresError::ForeignServerOnPort {
            port: POSTGRES_PORT,
        });
    }

    // Initialize if needed
    init_postgres_data_dir(app_handle, &bundled_postgres_version).await?;

    // Start the server (this now includes waiting for ready)
    start_postgres(app_handle, &bundled_postgres_version).await?;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseSetupState {
    Fresh,
    Unversioned,
    V1,
}

/// Initialize an empty desktop database at V1.
///
/// `seed.sql` is part of first initialization only. Existing unversioned
/// schemas are not upgraded in place. Fresh and V1 databases receive every
/// verified, idempotent patch in the shared V1 catalog.
pub async fn run_database_setup(app_handle: &AppHandle) -> Result<(), PostgresError> {
    create_database_if_needed(app_handle).await?;
    let resource_dir = clean_resource_dir(app_handle);
    let setup_state = database_setup_state(app_handle).await?;

    match setup_state {
        DatabaseSetupState::Fresh => {
            log::info!("Initializing an empty desktop database with the V1 baseline...");
            run_sql_file(
                app_handle,
                &resource_dir.join("database/postgres/migrations/0001_v1_baseline.sql"),
            )
            .await?;

            log::info!("Installing V1 required/reference and bootstrap data...");
            run_sql_file(app_handle, &resource_dir.join("database/postgres/seed.sql")).await?;
        }
        DatabaseSetupState::Unversioned => {
            return Err(PostgresError::MigrationFailed(
                "This non-empty database does not match the current schema. Export any data that must be retained, then rebuild it from the bundled PostgreSQL baseline and seed."
                    .to_string(),
            ));
        }
        DatabaseSetupState::V1 => {}
    }

    let pgsql_bin = get_pgsql_bin_dir(app_handle);
    let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));
    let connection = patches::PsqlConnection::new(
        "localhost",
        POSTGRES_PORT,
        POSTGRES_USER,
        POSTGRES_DB,
        read_or_create_postgres_password()?,
    );
    patches::apply_catalog(
        &psql_path,
        &connection,
        &resource_dir.join("database/postgres/patches"),
    )
    .await?;

    if setup_state == DatabaseSetupState::Fresh {
        randomize_seed_passwords(app_handle).await?;
    }

    repair_bootstrap_password_hashes_if_needed(app_handle).await?;

    log::info!("Database setup completed successfully");
    Ok(())
}

fn generate_bootstrap_password() -> String {
    let bytes: [u8; 18] = rand::rng().random();
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

    let reject =
        || PostgresError::InvalidBackupDestination(candidate.to_string_lossy().to_string());

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

/// Mutual exclusion for operations that dump or overwrite the live
/// database. A scheduled backup firing mid-restore would write a
/// valid-looking dump of a half-restored database — and its retention
/// pruning could even delete the dump being restored from. Manual backups,
/// restores, and guided upgrades therefore share this flag; whoever holds
/// it owns the database until the guard drops.
static BACKUP_OR_RESTORE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Proof that the holder owns [`BACKUP_OR_RESTORE_ACTIVE`]. Release is
/// automatic on drop, including panic paths.
pub struct BackupRestoreGuard {
    _private: (),
}

impl Drop for BackupRestoreGuard {
    fn drop(&mut self) {
        BACKUP_OR_RESTORE_ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// Try to begin a backup/restore critical section. Returns `None` while a
/// backup, restore, or upgrade is already in flight.
pub(crate) fn try_begin_backup_or_restore() -> Option<BackupRestoreGuard> {
    BACKUP_OR_RESTORE_ACTIVE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| BackupRestoreGuard { _private: () })
}

/// Backup the bundled PostgreSQL database, refusing to run while a restore
/// or another backup holds [`BACKUP_OR_RESTORE_ACTIVE`].
pub async fn backup_database(
    app_handle: &AppHandle,
    destination: Option<String>,
) -> Result<PathBuf, PostgresError> {
    let _guard = try_begin_backup_or_restore().ok_or(PostgresError::OperationInProgress)?;
    backup_database_inner(app_handle, destination).await
}

/// The backup body, for callers that already hold the backup/restore guard
/// (the scheduled task, the restore safety dump).
async fn backup_database_inner(
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

    // A dump that pg_restore can't even enumerate is worthless — verify now,
    // at creation time, rather than discovering it during a recovery.
    verify_backup_dump(app_handle, &backup_path, true).await?;

    // Uploads are user data the dump cannot cover (eKYC images, receipts,
    // room photos) — archive them alongside, sharing the timestamp stem.
    let stem = backup_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    backup_uploads(&stem)?;

    log::info!("Database backup written to {:?}", backup_path);
    Ok(backup_path)
}

/// `pg_restore --list` exits non-zero on a corrupt/unreadable dump.
///
/// `delete_on_failure` controls what happens to a dump that fails the check:
/// `true` on the creation path, where a corrupt artifact must not stay on
/// disk pretending to be a backup; `false` on the restore path, where the
/// file is the user's chosen recovery copy — possibly their only one — and
/// is left untouched.
async fn verify_backup_dump(
    app_handle: &AppHandle,
    dump_path: &Path,
    delete_on_failure: bool,
) -> Result<(), PostgresError> {
    let pg_restore_path = get_pgsql_bin_dir(app_handle).join(format!("pg_restore{}", EXE_SUFFIX));
    if !pg_restore_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            pg_restore_path.to_string_lossy().to_string(),
        ));
    }

    let mut cmd = tokio::process::Command::new(&pg_restore_path);
    cmd.args(["--list", &dump_path.to_string_lossy()])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().await?;
    if !output.status.success() {
        let details = command_output_details("pg_restore --list backup verification", &output);
        let outcome_note = if delete_on_failure {
            if std::fs::remove_file(dump_path).is_ok() {
                "the unreadable dump was removed".to_string()
            } else {
                "the unreadable dump could not be removed; delete it manually".to_string()
            }
        } else {
            format!(
                "the dump was left in place at {}",
                dump_path.to_string_lossy()
            )
        };
        return Err(PostgresError::MigrationFailed(format!(
            "Backup verification failed: {}; {}",
            details, outcome_note
        )));
    }

    Ok(())
}

/// Archive `uploads/` + `private_uploads/` into `<stem>-uploads.tar.gz` inside
/// the backups dir. Returns `None` when there is nothing worth archiving —
/// restore treats a missing tarball as "no files to restore", not an error.
fn backup_uploads(stem: &str) -> Result<Option<PathBuf>, PostgresError> {
    let data_dir = get_data_directory();
    let roots = ["uploads", "private_uploads"]
        .iter()
        .map(|name| data_dir.join(name))
        .filter(|dir| {
            dir.is_dir()
                && dir
                    .read_dir()
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if roots.is_empty() {
        return Ok(None);
    }

    let out_path = backups_directory().join(format!("{}{}", stem, UPLOADS_FILE_SUFFIX));
    let written = (|| -> std::io::Result<()> {
        let file = std::fs::File::create(&out_path)?;
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for dir in &roots {
            // Top-level entry name is the dir itself ("uploads", "private_uploads")
            // so extraction restores the layout verbatim.
            builder.append_dir_all(dir.file_name().unwrap_or_default(), dir)?;
        }
        builder.into_inner()?.finish()?;
        Ok(())
    })();
    if let Err(err) = written {
        // A truncated tarball must not stay behind pretending to be a backup.
        let _ = std::fs::remove_file(&out_path);
        return Err(err.into());
    }
    Ok(Some(out_path))
}

/// Prefix + suffixes identifying backup artifacts produced by this app.
/// A managed backup is a pair sharing the stem `hotel-backup-YYYYMMDD-HHMMSS`:
/// `<stem>.dump` plus `<stem>-uploads.tar.gz` when uploads existed at backup
/// time.
const BACKUP_FILE_PREFIX: &str = "hotel-backup-";
const BACKUP_FILE_SUFFIX: &str = ".dump";
const UPLOADS_FILE_SUFFIX: &str = "-uploads.tar.gz";

/// Number of most-recent backups to retain when pruning.
const BACKUP_RETENTION_COUNT: usize = 14;

pub(crate) fn backups_directory() -> PathBuf {
    get_data_directory().join("backups")
}

fn is_managed_backup_name(name: &str) -> bool {
    name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(BACKUP_FILE_SUFFIX)
}

fn is_managed_uploads_name(name: &str) -> bool {
    name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(UPLOADS_FILE_SUFFIX)
}

fn is_managed_backup_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => is_managed_backup_name(name),
        None => false,
    }
}

fn is_managed_uploads_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => is_managed_uploads_name(name),
        None => false,
    }
}

/// One managed backup: a verified pg_dump plus its uploads tarball (when any
/// uploaded files existed at backup time). The pair shares the timestamp stem
/// `hotel-backup-YYYYMMDD-HHMMSS`.
pub struct ManagedBackup {
    pub dump_path: PathBuf,
    pub uploads_path: Option<PathBuf>,
    /// RFC3339, from dump mtime.
    pub timestamp: String,
    /// Dump + uploads bytes.
    pub size_bytes: u64,
}

/// List managed backups (dump+uploads pairs) newest first by dump mtime.
/// A stray `-uploads.tar.gz` with no matching `.dump` is ignored — it cannot
/// be restored without its database half.
fn list_managed_backups() -> Vec<ManagedBackup> {
    let dir = backups_directory();
    let mut dumps: Vec<(PathBuf, std::time::SystemTime)> = match std::fs::read_dir(&dir) {
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
    dumps.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    dumps
        .into_iter()
        .map(|(dump_path, mtime)| {
            let stem = dump_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .trim_end_matches(BACKUP_FILE_SUFFIX)
                .to_string();
            let uploads_path = {
                let candidate = dir.join(format!("{}{}", stem, UPLOADS_FILE_SUFFIX));
                is_managed_uploads_file(&candidate).then_some(candidate)
            };
            let size_bytes = [&dump_path]
                .into_iter()
                .chain(uploads_path.iter())
                .filter_map(|p| p.metadata().ok().map(|m| m.len()))
                .sum();
            let timestamp: chrono::DateTime<chrono::Utc> = mtime.into();
            ManagedBackup {
                dump_path,
                uploads_path,
                timestamp: timestamp.to_rfc3339(),
                size_bytes,
            }
        })
        .collect()
}

/// The newest managed backup pair, for the status and upgrade/restore paths.
fn latest_backup_pair() -> Option<ManagedBackup> {
    list_managed_backups().into_iter().next()
}

/// Metadata about the most recent managed backup, surfaced to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LatestBackup {
    pub path: String,
    pub filename: String,
    /// Backup timestamp as RFC3339 (from file mtime), local-agnostic; the FE
    /// renders it in local time.
    pub timestamp: String,
    /// Filename of the paired uploads tarball, when uploads existed at backup
    /// time.
    pub uploads_filename: Option<String>,
    /// Combined size of the dump plus its uploads tarball, in bytes.
    pub size_bytes: u64,
}

impl From<&ManagedBackup> for LatestBackup {
    fn from(backup: &ManagedBackup) -> Self {
        LatestBackup {
            path: backup.dump_path.to_string_lossy().to_string(),
            filename: backup
                .dump_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            timestamp: backup.timestamp.clone(),
            uploads_filename: backup
                .uploads_path
                .as_ref()
                .and_then(|path| path.file_name().map(|n| n.to_string_lossy().to_string())),
            size_bytes: backup.size_bytes,
        }
    }
}

/// Metadata about one managed backup, surfaced to the frontend by the
/// `list_backups` command. Filenames only — full paths stay internal.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupInfo {
    pub filename: String,
    /// Backup timestamp as RFC3339 (from file mtime), local-agnostic; the FE
    /// renders it in local time.
    pub timestamp: String,
    /// Combined size of the dump plus its uploads tarball, in bytes.
    pub size_bytes: u64,
    /// Filename of the paired uploads tarball, when uploads existed at backup
    /// time.
    pub uploads_filename: Option<String>,
}

/// All managed backups (dump+uploads pairs) newest first, for the
/// backup/restore UI. Thin mapping over `list_managed_backups`.
pub fn managed_backup_infos() -> Vec<BackupInfo> {
    list_managed_backups()
        .into_iter()
        .map(|backup| BackupInfo {
            filename: backup
                .dump_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            timestamp: backup.timestamp,
            size_bytes: backup.size_bytes,
            uploads_filename: backup
                .uploads_path
                .and_then(|path| path.file_name().map(|n| n.to_string_lossy().to_string())),
        })
        .collect()
}

/// Delete all but the newest `BACKUP_RETENTION_COUNT` managed backups — both
/// the dump and its uploads partner. Only files matching the managed backup
/// patterns are ever removed.
fn prune_old_backups() {
    let backups = list_managed_backups();
    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }

    for stale in backups.into_iter().skip(BACKUP_RETENTION_COUNT) {
        for path in [stale.dump_path].into_iter().chain(stale.uploads_path) {
            // Extra safety: never remove anything that is not a managed
            // artifact.
            if !(is_managed_backup_file(&path) || is_managed_uploads_file(&path)) {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => log::info!("Pruned old backup artifact {:?}", path),
                Err(err) => log::warn!("Failed to prune backup {:?}: {}", path, err),
            }
        }
    }
}

/// Run a backup into the default backups directory and prune old dumps.
/// Used by the scheduled backup task; failures are returned to the caller,
/// which logs and continues without crashing the app. Returns `Ok(None)`
/// when another backup or restore holds [`BACKUP_OR_RESTORE_ACTIVE`] — the
/// scheduler skips that cycle rather than competing with it.
pub async fn run_scheduled_backup(
    app_handle: &AppHandle,
) -> Result<Option<PathBuf>, PostgresError> {
    let Some(_guard) = try_begin_backup_or_restore() else {
        return Ok(None);
    };
    let path = backup_database_inner(app_handle, None).await?;
    prune_old_backups();
    Ok(Some(path))
}

/// Summary returned to the frontend after a successful guided upgrade.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpgradeSummary {
    pub restored_backup: String,
    /// Uploads tarball filename restored alongside the dump, when the pair
    /// had one.
    pub restored_uploads: Option<String>,
    pub retired_data_dir: String,
    pub from_version: String,
    pub to_version: String,
}

/// Summary returned to the frontend after a same-version restore.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RestoreSummary {
    /// Managed dump filename that was restored.
    pub restored_backup: String,
    /// Uploads tarball filename restored alongside it, when the pair had one.
    pub restored_uploads: Option<String>,
    /// Filename of the safety dump taken immediately before the restore — the
    /// pre-restore state the user can roll back to from the backups list.
    pub safety_backup: String,
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

/// Pure half of `resolve_managed_dump`: untrusted input must be a bare
/// `hotel-backup-*.dump` filename — no separators, no parent components.
/// `file_name()` returning the input unchanged proves the path is a single
/// component; anything with separators fails that check, and `..`/`/`
/// produce no file name at all.
fn is_valid_restore_filename(filename: &str) -> bool {
    Path::new(filename)
        .file_name()
        .filter(|name| *name == std::ffi::OsStr::new(filename))
        .and_then(|name| name.to_str())
        .map(is_managed_backup_name)
        .unwrap_or(false)
}

/// Resolve a user-supplied backup filename to a managed dump inside the
/// backups dir. Bare filename only — no separators, must match the managed
/// pattern, must exist in the managed list (a file dropped there by hand
/// with a matching name is fine; anything else is refused).
fn resolve_managed_dump(filename: &str) -> Result<PathBuf, PostgresError> {
    let reject = || PostgresError::InvalidBackupDestination(filename.to_string());
    if !is_valid_restore_filename(filename) {
        return Err(reject());
    }
    let candidate = backups_directory().join(filename);
    if !is_managed_backup_file(&candidate) {
        return Err(reject());
    }
    Ok(candidate)
}

/// Whether one uploads-archive entry is safe to restore. Only plain files
/// and directories rooted at `uploads/` or `private_uploads/` qualify:
/// `unpack` recreates symlink and hardlink entries with their archived
/// targets unchecked, so a crafted `uploads/x` -> absolute host path would
/// become a file-exfiltration primitive through the backend's ServeDir; and
/// without the top-level allowlist an archive could overwrite managed files
/// like `postgres-password.txt` or `pgdata/postgresql.conf`. Pure half of
/// `restore_uploads_tarball`'s pre-validation pass.
fn uploads_entry_is_restorable(
    path: &Path,
    entry_type: tar::EntryType,
) -> Result<(), PostgresError> {
    if !matches!(
        entry_type,
        tar::EntryType::Regular | tar::EntryType::Directory
    ) {
        return Err(PostgresError::MigrationFailed(format!(
            "entry {:?} has unsupported type {:?}; only regular files and directories are restored",
            path, entry_type
        )));
    }
    if path.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err(PostgresError::MigrationFailed(format!(
            "entry {:?} has an unsafe path",
            path
        )));
    }
    if !matches!(
        path.components().next(),
        Some(std::path::Component::Normal(name))
            if name == "uploads" || name == "private_uploads"
    ) {
        return Err(PostgresError::MigrationFailed(format!(
            "entry {:?} is not under uploads/ or private_uploads/",
            path
        )));
    }
    Ok(())
}

/// Extract a `-uploads.tar.gz` into the data dir. Current uploads/ and
/// private_uploads/ are renamed aside FIRST and only deleted after a clean
/// extract — a corrupt tarball can never leave the app without its files.
/// Every entry is validated by [`uploads_entry_is_restorable`] before the
/// filesystem is touched: plain files and directories under the two upload
/// roots only — no links, no traversal, no absolute paths.
async fn restore_uploads_tarball(tarball_path: &Path) -> Result<(), PostgresError> {
    let data_dir = get_data_directory();
    let file = std::fs::File::open(tarball_path)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);

    // Pre-validate every entry before touching the filesystem.
    for entry in archive.entries()? {
        let entry = entry?;
        let path = entry.path()?;
        uploads_entry_is_restorable(&path, entry.header().entry_type()).map_err(|err| {
            PostgresError::MigrationFailed(format!("Refusing uploads archive: {}", err))
        })?;
    }

    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut retired: Vec<(PathBuf, PathBuf)> = Vec::new();
    for name in ["uploads", "private_uploads"] {
        let dir = data_dir.join(name);
        if dir.exists() {
            let aside = data_dir.join(format!("{}.prerestore-{}", name, stamp));
            std::fs::rename(&dir, &aside)?;
            retired.push((aside, dir));
        }
    }

    // Re-open (entries() consumed the archive) and extract.
    let file = std::fs::File::open(tarball_path)?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    match archive.unpack(&data_dir) {
        Ok(()) => {
            for (aside, _) in retired {
                let _ = std::fs::remove_dir_all(&aside);
            }
            Ok(())
        }
        Err(err) => {
            // Roll the renamed dirs back; name any that could not be moved
            // back so their pre-restore contents stay findable at the aside
            // path for manual recovery.
            let mut stranded: Vec<PathBuf> = Vec::new();
            for (aside, original) in retired {
                let _ = std::fs::remove_dir_all(&original);
                if std::fs::rename(&aside, &original).is_err() && aside.exists() {
                    stranded.push(aside);
                }
            }
            let rollback_note = if stranded.is_empty() {
                "the previous uploads directories were restored in place".to_string()
            } else {
                format!(
                    "the previous uploads directories could not be moved back; they are preserved at {}",
                    stranded
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };
            Err(PostgresError::MigrationFailed(format!(
                "uploads restore failed: {}. {}",
                err, rollback_note
            )))
        }
    }
}

/// A managed-restore request that has passed validation: the named dump is a
/// managed file that `pg_restore --list` can read, and its uploads partner
/// (when the pair has one) is located. Splitting this out lets the command
/// validate BEFORE stopping the backend sidecar — a bad filename or
/// unreadable dump must not bounce the app for nothing.
pub struct PreparedRestore {
    filename: String,
    dump_path: PathBuf,
    uploads_path: Option<PathBuf>,
}

/// Validate a managed-restore request without changing any state: resolve
/// the bare managed filename, verify the dump reads, locate the paired
/// uploads tarball. The selected dump is verified with
/// `delete_on_failure: false` — it may be the user's only recovery copy, so
/// a failed check never deletes it.
pub async fn prepare_restore(
    app_handle: &AppHandle,
    filename: &str,
) -> Result<PreparedRestore, PostgresError> {
    let dump_path = resolve_managed_dump(filename)?;
    verify_backup_dump(app_handle, &dump_path, false).await?;
    let uploads_path = {
        let stem = filename.trim_end_matches(BACKUP_FILE_SUFFIX);
        let candidate = backups_directory().join(format!("{}{}", stem, UPLOADS_FILE_SUFFIX));
        is_managed_uploads_file(&candidate).then_some(candidate)
    };
    Ok(PreparedRestore {
        filename: filename.to_string(),
        dump_path,
        uploads_path,
    })
}

/// The destructive half of a same-version restore: replace the live database
/// (and uploads) with the validated backup. The caller must hold the
/// [`BackupRestoreGuard`] (it is consumed here) and have stopped the backend
/// sidecar — that keeps a scheduled or manual backup from dumping a
/// half-restored database or pruning the restore source mid-flight.
///
/// A fresh safety dump is taken first — if the restore fails, the safety
/// dump is restored back automatically (best effort) and named in the error
/// either way. `pg_restore --clean` is not transactional, so a mid-restore
/// failure can leave a half-restored database; the safety dump is the
/// mitigation, which is why rollback is attempted immediately rather than
/// left to the user.
pub async fn restore_prepared(
    app_handle: &AppHandle,
    prepared: PreparedRestore,
    _guard: BackupRestoreGuard,
) -> Result<RestoreSummary, PostgresError> {
    // Safety net: a pre-restore dump the user can roll back to. Uses the same
    // managed naming so it lands in the list and prunes naturally.
    let safety_path = backup_database_inner(app_handle, None).await?;
    let safety_name = safety_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    if let Err(err) = restore_backup_dump(app_handle, &prepared.dump_path).await {
        // Best-effort auto-rollback to the pre-restore state.
        let rollback_note = match restore_backup_dump(app_handle, &safety_path).await {
            Ok(()) => format!(
                "The pre-restore state was rolled back automatically (safety backup: {}).",
                safety_name
            ),
            Err(rb) => format!(
                "Automatic rollback also failed ({}); restore {} manually to recover the pre-restore state.",
                rb, safety_name
            ),
        };
        return Err(PostgresError::MigrationFailed(format!(
            "Restore of {} failed: {}. {}",
            prepared.filename, err, rollback_note
        )));
    }

    if let Some(tarball) = &prepared.uploads_path {
        restore_uploads_tarball(tarball).await.map_err(|err| {
            PostgresError::MigrationFailed(format!(
                "Database restored but uploads restore failed: {}. Database state is from {}; uploaded files may be inconsistent.",
                err, prepared.filename
            ))
        })?;
    }

    Ok(RestoreSummary {
        restored_backup: prepared.filename,
        restored_uploads: prepared
            .uploads_path
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
        safety_backup: safety_name,
    })
}

/// Guided PostgreSQL build upgrade: retire the incompatible data directory, create
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
    // Same exclusion as manual restores/backups: the upgrade rewrites the
    // database and the upload trees, and a second concurrent invocation
    // would double-rename the retired data directory.
    let _guard = try_begin_backup_or_restore().ok_or(PostgresError::OperationInProgress)?;

    let bundled_version = detect_bundled_postgres_version(app_handle).await?;

    // (a) Verify the mismatch state still holds.
    let Some(found_major) = read_pgdata_version()? else {
        return Err(PostgresError::MigrationFailed(
            "No PostgreSQL data directory present; nothing to upgrade.".to_string(),
        ));
    };
    let found_build_marker = read_pgdata_build_identity()?;
    let found_version = match classify_pgdata_compatibility(
        Some(&found_major),
        found_build_marker.as_deref(),
        &bundled_version,
    ) {
        DataDirectoryCompatibility::Incompatible { found } => found,
        DataDirectoryCompatibility::Compatible
        | DataDirectoryCompatibility::CompatibleLegacyMarkerMissing => {
            return Err(PostgresError::MigrationFailed(format!(
                "Data directory is already compatible with PostgreSQL {}; no upgrade needed.",
                bundled_version.build_identity
            )));
        }
    };

    // Require a backup before doing anything destructive.
    let Some(latest) = latest_backup_pair() else {
        return Err(PostgresError::MigrationFailed(format!(
            "No backup available to restore. The existing PostgreSQL {} data directory has been left untouched. To recover, install a desktop build matching PostgreSQL {} to read the existing data and create a logical backup before upgrading.",
            found_version, found_version
        )));
    };
    let backup_path = latest.dump_path;

    let pgdata = get_pgdata_dir();
    let retired_version_label: String = found_version
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let retired_dir = pgdata.with_file_name(format!(
        "pgdata-pg{}-retired-{}",
        retired_version_label,
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    ));

    // Make sure nothing is holding the old cluster; ignore errors (it should not
    // be running because we refuse to start on mismatch).
    let _ = stop_postgres(app_handle).await;

    // (b) Rename the old data dir aside — NEVER delete it.
    log::info!(
        "Retiring incompatible PostgreSQL {} data directory {:?} -> {:?}",
        found_version,
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
        if pgdata.exists()
            && let Err(err) = std::fs::remove_dir_all(&pgdata)
        {
            log::error!(
                "Rollback: failed to remove half-built data directory {:?}: {}",
                pgdata,
                err
            );
        }
        // Restore the original data directory name.
        if let Err(err) = std::fs::rename(&retired_dir, &pgdata) {
            log::error!(
                "Rollback: failed to restore data directory {:?} -> {:?}: {}. The pre-upgrade data is preserved at {:?}.",
                retired_dir,
                pgdata,
                err,
                retired_dir
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
    if let Err(err) = init_postgres_data_dir(app_handle, &bundled_version).await {
        return Err(rollback(format!("initdb of fresh cluster failed: {}", err)));
    }

    // (d) Start postgres.
    if let Err(err) = start_postgres(app_handle, &bundled_version).await {
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

    // (f) Run the migrations / schema bootstrap step (idempotent). This
    // must complete BEFORE the uploads restore: restore_uploads_tarball
    // deletes its retired-aside copies of the live upload trees on success,
    // so if setup failed after a successful uploads restore the rollback
    // would return the pre-upgrade database while uploads had already been
    // reset to backup state — losing files uploaded since that backup.
    if let Err(err) = run_database_setup(app_handle).await {
        let _ = stop_postgres(app_handle).await;
        return Err(rollback(format!(
            "post-restore database setup failed: {}",
            err
        )));
    }

    // (g) Restore uploaded files when the backup pair carries them. Runs
    // last so the live trees stay untouched until the database half has
    // committed; a failure here re-enters rollback() with the uploads dirs
    // already put back (or named as stranded asides) by
    // restore_uploads_tarball itself.
    if let Some(tarball) = &latest.uploads_path {
        if let Err(err) = restore_uploads_tarball(tarball).await {
            let _ = stop_postgres(app_handle).await;
            return Err(rollback(format!(
                "uploads restore from {:?} failed: {}",
                tarball, err
            )));
        }
    }

    // (h) Success.
    log::info!(
        "Guided upgrade complete: PostgreSQL {} -> {}, restored {:?}, retired old data at {:?}",
        found_version,
        bundled_version.build_identity,
        backup_path,
        retired_dir
    );
    Ok(UpgradeSummary {
        restored_backup: backup_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        restored_uploads: latest.uploads_path.and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        }),
        retired_data_dir: retired_dir.to_string_lossy().to_string(),
        from_version: found_version,
        to_version: bundled_version.build_identity,
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
        password, username_lines
    );
    // 0600 like the postgres password file: this contains the cleartext
    // initial admin password, and shared front-desk machines have multiple
    // local OS accounts. Default umask would land it world-readable.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&password_file) {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(contents.as_bytes())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            // Retry flow: tighten the existing file instead of recreating it.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = std::fs::metadata(&password_file)?.permissions();
                permissions.set_mode(0o600);
                std::fs::set_permissions(&password_file, permissions)?;
            }
            std::fs::write(&password_file, contents)?;
        }
        Err(error) => return Err(error.into()),
    }
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

async fn database_setup_state(app_handle: &AppHandle) -> Result<DatabaseSetupState, PostgresError> {
    if has_v1_schema_revision(app_handle).await? {
        return Ok(DatabaseSetupState::V1);
    }

    let output = run_psql_scalar_sql(
        app_handle,
        "psql detect existing application objects",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f'));",
    )
    .await?;

    if trimmed_lossy(&output.stdout) == "t" {
        Ok(DatabaseSetupState::Unversioned)
    } else {
        Ok(DatabaseSetupState::Fresh)
    }
}

async fn has_v1_schema_revision(app_handle: &AppHandle) -> Result<bool, PostgresError> {
    let table_exists = run_psql_scalar_sql(
        app_handle,
        "psql check schema revision table",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'hotel_schema_revisions');",
    )
    .await?;
    if trimmed_lossy(&table_exists.stdout) != "t" {
        return Ok(false);
    }

    let revision_checksum = run_psql_scalar_sql(
        app_handle,
        "psql check V1 schema revision",
        "SELECT checksum FROM public.hotel_schema_revisions WHERE generation = 1 AND version = 1;",
    )
    .await?;
    let revision_checksum = trimmed_lossy(&revision_checksum.stdout);
    if revision_checksum == "<empty>" {
        return Ok(false);
    }
    if revision_checksum != POSTGRES_V1_CHECKSUM {
        return Err(PostgresError::MigrationFailed(format!(
            "PostgreSQL V1 checksum mismatch: database records {}, desktop expects {}",
            revision_checksum, POSTGRES_V1_CHECKSUM
        )));
    }

    Ok(true)
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
    let bundled_version = cached_bundled_postgres_version();
    let data_version = read_pgdata_version()
        .map_err(|err| {
            log::warn!("Failed to read PostgreSQL data directory version: {}", err);
            err
        })
        .ok()
        .flatten();
    let (data_build_marker, marker_read_failed) = match read_pgdata_build_identity() {
        Ok(marker) => (marker, false),
        Err(err) => {
            log::warn!(
                "Failed to read PostgreSQL desktop build identity marker: {}",
                err
            );
            (None, true)
        }
    };
    let compatibility = if marker_read_failed && initialized {
        DataDirectoryCompatibility::Incompatible {
            found: format!(
                "{} (unreadable desktop build marker)",
                data_version.as_deref().unwrap_or("unknown")
            ),
        }
    } else {
        classify_pgdata_compatibility(
            data_version.as_deref(),
            data_build_marker.as_deref(),
            &bundled_version,
        )
    };
    let version_compatible = matches!(
        compatibility,
        DataDirectoryCompatibility::Compatible
            | DataDirectoryCompatibility::CompatibleLegacyMarkerMissing
    );
    let data_build_version = data_build_marker.clone().or_else(|| {
        data_version
            .as_deref()
            .filter(|major| *major == CONFIGURED_POSTGRES_MAJOR_VERSION)
            .map(|_| LEGACY_UNMARKED_POSTGRES_BUILD_IDENTITY.to_string())
    });

    // A major or pre-release build mismatch means we refuse to auto-start (see
    // refuse_if_pgdata_version_mismatch). Surface this as a machine-readable
    // state so the webview can offer a guided restore-from-backup upgrade.
    let needs_upgrade = data_version.is_some() && !version_compatible;
    let latest_backup = if needs_upgrade {
        latest_backup_pair().map(|pair| LatestBackup::from(&pair))
    } else {
        None
    };

    serde_json::json!({
        "running": running,
        "initialized": initialized,
        "data_version": data_version,
        "bundled_version": bundled_version.major,
        "configured_bundled_version": CONFIGURED_POSTGRES_MAJOR_VERSION,
        "data_build_version": data_build_version,
        "bundled_build_version": bundled_version.build_identity,
        "configured_bundled_build_version": CONFIGURED_POSTGRES_BUILD_IDENTITY,
        "version_compatible": version_compatible,
        "needs_upgrade": needs_upgrade,
        "data_dir_major": data_version,
        "bundled_major": bundled_version.major,
        "latest_backup": latest_backup,
        "port": POSTGRES_PORT,
        "user": POSTGRES_USER,
        "database": POSTGRES_DB,
        "password_auth": true,
        "data_directory": pgdata.to_string_lossy(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postmaster_pid_parse_reads_pid_and_port_lines() {
        let dir = std::env::temp_dir().join(format!("hotel-pmpid-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("postmaster.pid");
        std::fs::write(
            &path,
            "12345\n/some/pgdata\n2026-08-22 10:00:00\n5433\n/tmp\n*\n\nready   ",
        )
        .unwrap();

        assert_eq!(read_postmaster_pid(path.clone()), Some((12345, 5433)));

        // A pidfile naming a different port must not claim ownership.
        std::fs::write(
            &path,
            "999\n/some/pgdata\n2026-08-22 10:00:00\n5432\n/tmp\n*\n",
        )
        .unwrap();
        assert_eq!(read_postmaster_pid(path), Some((999, 5432)));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn postmaster_pid_parse_rejects_missing_and_malformed_files() {
        assert_eq!(
            read_postmaster_pid(std::env::temp_dir().join("hotel-no-such-postmaster.pid")),
            None
        );

        let dir = std::env::temp_dir().join(format!("hotel-pmpid-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("postmaster.pid");

        // Truncated file: no port line.
        std::fs::write(&path, "12345\n/some/pgdata\n").unwrap();
        assert_eq!(read_postmaster_pid(path.clone()), None);

        // Non-numeric PID.
        std::fs::write(&path, "not-a-pid\n/d\n2026\n5433\n").unwrap();
        assert_eq!(read_postmaster_pid(path), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    fn build(major: &str, identity: &str) -> PostgresBuildVersion {
        PostgresBuildVersion {
            major: major.to_string(),
            build_identity: identity.to_string(),
        }
    }

    #[test]
    fn parses_prerelease_build_identity_exactly() {
        assert_eq!(
            extract_postgres_build_version("postgres (PostgreSQL) 19beta1"),
            Some(build("19", "19beta1"))
        );
        assert_eq!(
            extract_postgres_build_version("initdb (PostgreSQL) 19rc2"),
            Some(build("19", "19rc2"))
        );
    }

    #[test]
    fn normalizes_ga_patch_versions_to_the_compatible_major() {
        assert_eq!(
            extract_postgres_build_version("postgres (PostgreSQL) 19.3"),
            Some(build("19", "19"))
        );
    }

    #[test]
    fn accepts_matching_marked_cluster() {
        let expected = build("19", "19beta2");
        assert_eq!(
            classify_pgdata_compatibility(Some("19"), Some("19beta2"), &expected),
            DataDirectoryCompatibility::Compatible
        );
    }

    #[test]
    fn adopts_only_the_known_legacy_beta1_cluster_without_a_marker() {
        let beta = build("19", "19beta1");
        assert_eq!(
            classify_pgdata_compatibility(Some("19"), None, &beta),
            DataDirectoryCompatibility::CompatibleLegacyMarkerMissing
        );

        let rc = build("19", "19rc1");
        assert!(matches!(
            classify_pgdata_compatibility(Some("19"), None, &rc),
            DataDirectoryCompatibility::Incompatible { found }
                if found.contains("inferred 19beta1")
        ));
    }

    #[test]
    fn rejects_same_major_different_prerelease_builds() {
        let expected = build("19", "19rc1");
        assert_eq!(
            classify_pgdata_compatibility(Some("19"), Some("19beta1"), &expected),
            DataDirectoryCompatibility::Incompatible {
                found: "19beta1".to_string()
            }
        );
    }

    #[test]
    fn managed_file_predicates_split_dumps_from_uploads() {
        assert!(is_managed_backup_name("hotel-backup-20260918-120000.dump"));
        assert!(!is_managed_backup_name(
            "hotel-backup-20260918-120000-uploads.tar.gz"
        ));
        assert!(is_managed_uploads_name(
            "hotel-backup-20260918-120000-uploads.tar.gz"
        ));
        assert!(!is_managed_uploads_name(
            "hotel-backup-20260918-120000.dump"
        ));
        assert!(!is_managed_uploads_name("random.tar.gz"));
        // A dump without our prefix must never be treated as a managed
        // artifact (pruning only ever removes managed files).
        assert!(!is_managed_backup_name("someone-elses.dump"));
    }

    #[test]
    fn uploads_archive_entries_must_be_plain_files_under_upload_roots() {
        use tar::EntryType;

        // Regular files and directories under the two upload roots pass.
        for path in [
            "uploads",
            "uploads/room-photos/lobby.jpg",
            "private_uploads",
            "private_uploads/ekyc/session-1/front.png",
        ] {
            assert!(
                uploads_entry_is_restorable(Path::new(path), EntryType::Regular).is_ok(),
                "{path} should be restorable"
            );
        }
        assert!(
            uploads_entry_is_restorable(Path::new("uploads/ekyc"), EntryType::Directory).is_ok()
        );

        // Link entries are refused wherever they appear: `unpack` recreates
        // them with unchecked targets, which would let a crafted archive
        // plant a symlink under uploads/ pointing at an absolute host path.
        for entry_type in [
            EntryType::Symlink,
            EntryType::Link,
            EntryType::Fifo,
            EntryType::Char,
            EntryType::Block,
            EntryType::GNUSparse,
        ] {
            assert!(
                uploads_entry_is_restorable(Path::new("uploads/x"), entry_type).is_err(),
                "{entry_type:?} should be refused"
            );
        }

        // Traversal, absolute paths, and non-upload top-level names are
        // refused — an archive must never write postgres-password.txt or
        // into pgdata/.
        for path in [
            "uploads/../postgres-password.txt",
            "/tmp/evil",
            "postgres-password.txt",
            "pgdata/postgresql.conf",
            "./uploads/x",
            "backups/hotel-backup-1.dump",
        ] {
            assert!(
                uploads_entry_is_restorable(Path::new(path), EntryType::Regular).is_err(),
                "{path} should be refused"
            );
        }
    }

    #[test]
    fn restore_rejects_non_managed_filenames() {
        for bad in [
            "../etc/passwd",
            "foo/bar.dump",
            "hotel-backup-x.sql",
            "..",
            "backups/hotel-backup-1.dump",
        ] {
            assert!(!is_valid_restore_filename(bad), "{bad} should be refused");
        }
        // A bare managed filename passes the pure check; resolve_managed_dump
        // additionally requires the file to exist inside the backups dir.
        assert!(is_valid_restore_filename(
            "hotel-backup-20260918-120000.dump"
        ));
    }
}
