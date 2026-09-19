//! Tauri IPC Commands
//!
//! These commands can be invoked from the frontend via `invoke()`

use rand::RngExt;
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::get_data_directory;

/// Global state for the backend process
static BACKEND_RUNNING: AtomicBool = AtomicBool::new(false);
static BACKEND_STARTING: AtomicBool = AtomicBool::new(false);
static BACKEND_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static BACKEND_PORT: AtomicU16 = AtomicU16::new(3030);
static BACKEND_PROCESS: LazyLock<Arc<Mutex<Option<CommandChild>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

/// Status response for the application
#[derive(serde::Serialize)]
pub struct AppStatus {
    pub backend_running: bool,
    pub backend_starting: bool,
    pub backend_url: String,
    pub data_directory: String,
    pub version: String,
    pub postgres: serde_json::Value,
}

/// Get the current application status
#[tauri::command]
pub async fn get_status(app_handle: AppHandle) -> Result<AppStatus, String> {
    Ok(AppStatus {
        backend_running: BACKEND_RUNNING.load(Ordering::SeqCst),
        backend_starting: BACKEND_STARTING.load(Ordering::SeqCst),
        backend_url: get_backend_url(),
        data_directory: get_data_directory().to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        postgres: crate::postgres::get_postgres_status(&app_handle).await,
    })
}

fn find_available_backend_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }

    for offset in 1..=100 {
        let Some(port) = preferred.checked_add(offset) else {
            break;
        };

        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }

    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .unwrap_or(preferred)
}

fn get_backend_url() -> String {
    format!("http://127.0.0.1:{}", BACKEND_PORT.load(Ordering::SeqCst))
}

fn generate_desktop_jwt_secret() -> String {
    let secret: [u8; 64] = rand::rng().random();
    hex::encode(secret)
}

/// Start the backend sidecar process
pub async fn start_backend_sidecar(app_handle: &AppHandle) -> Result<(), String> {
    if BACKEND_RUNNING.load(Ordering::SeqCst) || BACKEND_STARTING.load(Ordering::SeqCst) {
        log::info!("Backend is already running");
        return Ok(());
    }

    log::info!("Starting backend sidecar...");
    BACKEND_STARTING.store(true, Ordering::SeqCst);
    BACKEND_STOP_REQUESTED.store(false, Ordering::SeqCst);

    // Desktop mode owns the bundled PostgreSQL instance. Do not let a user or
    // machine-level DATABASE_URL redirect the sidecar to an external database.
    let database_url = crate::postgres::get_database_url()
        .map_err(|e| format!("Failed to read database credential: {}", e))?;
    let preferred_port = std::env::var("BACKEND_PORT")
        .ok()
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(3030);
    let backend_port = find_available_backend_port(preferred_port);
    BACKEND_PORT.store(backend_port, Ordering::SeqCst);
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| generate_desktop_jwt_secret());

    let shell = app_handle.shell();
    let sidecar_command = shell
        .sidecar("hotel-app-be")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        // The backend resolves uploads/, private_uploads/ and other relative
        // paths against its CWD — pin it to the data dir so user files land in
        // managed storage (and therefore in backups) instead of wherever the
        // app happened to be launched from.
        .current_dir(get_data_directory())
        .env("DATABASE_URL", &database_url)
        .env("BACKEND_PORT", backend_port.to_string())
        .env("JWT_SECRET", jwt_secret)
        .env("HOTEL_DESKTOP_MODE", "1")
        // KEEP IN SYNC: dev proxy prefixes in hotel-web-fe/vite.config.ts;
        // router merge in hotel-app-be/src/routes/mod.rs; dev http origins in
        // src-tauri/capabilities/default.json remote.urls — parity enforced by
        // hotel-desktop/scripts/origin-parity.test.mjs.
        .env(
            "ALLOWED_ORIGINS",
            "tauri://localhost,http://tauri.localhost,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173",
        )
        .env("SKIP_EMAIL_VERIFICATION", "true")
        .env("TRUST_PROXY_HEADERS", "false")
        .env("RUST_LOG", "info");

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child process
    {
        let mut process = BACKEND_PROCESS.lock().await;
        *process = Some(child);
    }

    // Spawn a task to monitor the sidecar output
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::info!("[Backend] {}", line_str);
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::warn!("[Backend] {}", line_str);
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("Backend process terminated with code: {:?}", payload.code);
                    BACKEND_RUNNING.store(false, Ordering::SeqCst);
                    BACKEND_STARTING.store(false, Ordering::SeqCst);
                    {
                        let mut process = BACKEND_PROCESS.lock().await;
                        *process = None;
                    }

                    // Emit event to frontend
                    if let Some(window) = app_handle_clone.get_webview_window("main") {
                        let _ = window.emit("backend-terminated", payload.code);
                    }
                    if !BACKEND_STOP_REQUESTED.load(Ordering::SeqCst) {
                        let restart_handle = app_handle_clone.clone();
                        tauri::async_runtime::spawn(async move {
                            restart_backend_with_backoff(restart_handle).await;
                        });
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    log::error!("Backend process error: {}", err);
                }
                _ => {}
            }
        }
    });

    // Wait for backend to be ready
    if let Err(e) = wait_for_backend_ready(backend_port).await {
        BACKEND_STARTING.store(false, Ordering::SeqCst);
        BACKEND_RUNNING.store(false, Ordering::SeqCst);
        return Err(e);
    }

    BACKEND_STARTING.store(false, Ordering::SeqCst);
    BACKEND_RUNNING.store(true, Ordering::SeqCst);

    // Every path that brings the backend up — initial start, manual restart,
    // restore, guided upgrade, crash backoff — goes through here, so this is
    // the single point that guarantees the scheduled-backup loop is running.
    // The spawn is idempotent; repeat starts are no-ops.
    crate::spawn_scheduled_backups(app_handle.clone());

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("backend-ready", get_backend_url());
    }

    log::info!(
        "Backend sidecar started successfully on {}",
        get_backend_url()
    );
    Ok(())
}

async fn restart_backend_with_backoff(app_handle: AppHandle) {
    for attempt in 1..=3 {
        let delay_secs = attempt * 2;
        log::warn!(
            "Backend sidecar exited unexpectedly; restart attempt {} in {} seconds",
            attempt,
            delay_secs
        );
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.emit("backend-restarting", attempt);
        }

        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        if BACKEND_STOP_REQUESTED.load(Ordering::SeqCst) {
            log::info!("Skipping backend auto-restart because shutdown was requested");
            return;
        }

        let restart_handle = app_handle.clone();
        let start_result = tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(start_backend_sidecar(&restart_handle))
        })
        .await
        .unwrap_or_else(|error| Err(format!("Backend restart task failed: {}", error)));

        match start_result {
            Ok(()) => {
                log::info!("Backend sidecar auto-restart succeeded");
                return;
            }
            Err(error) => {
                log::error!(
                    "Backend sidecar auto-restart attempt {} failed: {}",
                    attempt,
                    error
                );
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("backend-restart-failed", error);
                }
            }
        }
    }

    log::error!("Backend sidecar auto-restart exhausted all attempts");
}

/// Wait for the backend to be ready (health check)
async fn wait_for_backend_ready(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{}/health", port);

    for i in 0..30 {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => {
                log::info!("Backend is ready after {} seconds", i);
                return Ok(());
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }

    Err(format!(
        "Backend failed to become ready within 30 seconds at {}",
        health_url
    ))
}

/// Stop the backend sidecar process
pub async fn stop_backend_sidecar() -> Result<(), String> {
    log::info!("Stopping backend sidecar...");
    BACKEND_STOP_REQUESTED.store(true, Ordering::SeqCst);

    let mut process = BACKEND_PROCESS.lock().await;
    if let Some(child) = process.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill backend process: {}", e))?;
        BACKEND_RUNNING.store(false, Ordering::SeqCst);
        BACKEND_STARTING.store(false, Ordering::SeqCst);
        log::info!("Backend sidecar stopped");
    }

    Ok(())
}

/// Restart the backend process
#[tauri::command]
pub async fn restart_backend(app_handle: AppHandle) -> Result<(), String> {
    log::info!("Restarting backend...");

    // Stop the current backend
    stop_backend_sidecar().await?;

    // Wait a moment for cleanup
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // Start the backend again
    start_backend_sidecar(&app_handle).await?;

    Ok(())
}

/// Backup the bundled PostgreSQL database.
#[tauri::command]
pub async fn backup_database(
    app_handle: AppHandle,
    destination: Option<String>,
) -> Result<String, String> {
    log::info!("Database backup requested");
    crate::postgres::backup_database(&app_handle, destination)
        .await
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|err| err.to_string())
}

/// Perform a guided major-version upgrade by restoring the latest backup into a
/// fresh cluster built with the bundled PostgreSQL version.
///
/// This is only ever invoked after explicit user confirmation in the webview
/// (see DesktopServiceGate). The old data directory is preserved (renamed aside),
/// and any failure rolls back to the pre-upgrade state.
#[tauri::command]
pub async fn upgrade_database_from_backup(
    app_handle: AppHandle,
) -> Result<crate::postgres::UpgradeSummary, String> {
    log::info!("Guided database upgrade from backup requested");
    let summary = crate::postgres::upgrade_database_from_backup(&app_handle)
        .await
        .map_err(|err| err.to_string())?;

    // Bring the backend sidecar up against the freshly-restored database so the
    // app can resume normal operation without a full restart.
    if let Err(err) = start_backend_sidecar(&app_handle).await {
        log::warn!(
            "Upgrade restore succeeded but starting the backend sidecar failed: {}",
            err
        );
        return Err(format!(
            "Database upgrade succeeded, but the backend failed to start: {}. Try restarting the app.",
            err
        ));
    }

    Ok(summary)
}

/// Restore a managed backup (dump + uploads pair) into the live database.
/// Validates the selection first, then stops the sidecar, restores, and
/// restarts — the webview sees the normal service-restart flow while this
/// runs.
#[tauri::command]
pub async fn restore_database(
    app_handle: AppHandle,
    filename: String,
) -> Result<crate::postgres::RestoreSummary, String> {
    log::info!("Database restore requested from {}", filename);
    // Resolve + verify BEFORE stopping the backend: an invalid filename or
    // unreadable dump must not bounce the app for nothing.
    let prepared = crate::postgres::prepare_restore(&app_handle, &filename)
        .await
        .map_err(|err| err.to_string())?;
    // Backups and restores are mutually exclusive for the whole
    // stop → restore → restart window — a scheduled dump taken mid-restore
    // would capture a half-restored database, and its pruning could delete
    // the restore source. Checked before the sidecar stops so a busy reply
    // doesn't bounce the backend either.
    let guard = crate::postgres::try_begin_backup_or_restore()
        .ok_or_else(|| crate::postgres::PostgresError::OperationInProgress.to_string())?;
    stop_backend_sidecar().await?;
    let result = crate::postgres::restore_prepared(&app_handle, prepared, guard).await;
    // Always try to bring the app back — even on failure the pre-restore
    // state (rolled back or not) is the database the app should serve.
    if let Err(err) = start_backend_sidecar(&app_handle).await {
        return Err(format!(
            "Backend restart failed: {}. {}",
            err,
            match &result {
                Ok(_) => "The restore itself had finished".to_string(),
                Err(restore_err) => format!("The restore also failed: {}", restore_err),
            }
        ));
    }
    result.map_err(|e| e.to_string())
}

/// List managed database backups (newest first) for the backup/restore UI.
#[tauri::command]
pub async fn list_backups() -> Result<Vec<crate::postgres::BackupInfo>, String> {
    Ok(crate::postgres::managed_backup_infos())
}

/// Get recent log entries
#[tauri::command]
pub async fn get_logs(lines: Option<usize>) -> Result<Vec<String>, String> {
    let log_dir = get_data_directory().join("logs");
    let lines = lines.unwrap_or(100);

    // Find the most recent log file
    let mut log_files: Vec<_> = std::fs::read_dir(&log_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    log_files.sort_by(|a, b| {
        let a_modified = a.metadata().and_then(|m| m.modified()).ok();
        let b_modified = b.metadata().and_then(|m| m.modified()).ok();
        b_modified.cmp(&a_modified)
    });

    if let Some(latest_log) = log_files.first() {
        let content = std::fs::read_to_string(latest_log.path()).map_err(|e| e.to_string())?;

        let log_lines: Vec<String> = content
            .lines()
            .rev()
            .take(lines)
            .map(|s| s.to_string())
            .collect();

        Ok(log_lines.into_iter().rev().collect())
    } else {
        Ok(vec!["No log files found".to_string()])
    }
}

/// Open `path` in the OS file explorer (macOS `open`, Windows `explorer`,
/// Linux `xdg-open`). Fire-and-forget: the spawned child keeps running after
/// its handle is dropped.
fn open_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Open the data folder in the file explorer
#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
    open_in_file_manager(&get_data_directory())
}

/// Open the managed backups folder in the OS file explorer so the user can
/// copy dumps off-app. Deliberately folder-only: arbitrary destination paths
/// stay refused (see ensure_within_data_dir).
#[tauri::command]
pub async fn open_backups_folder() -> Result<(), String> {
    let dir = crate::postgres::backups_directory();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_in_file_manager(&dir)
}

/// Shutdown the application gracefully
#[tauri::command]
pub async fn shutdown_app(app_handle: AppHandle) -> Result<(), String> {
    log::info!("Shutting down application...");

    // Stop backend
    stop_backend_sidecar().await?;

    // Stop PostgreSQL
    if let Err(e) = crate::postgres::stop_postgres(&app_handle).await {
        log::warn!("Failed to stop PostgreSQL: {}", e);
    }

    // Exit the application
    app_handle.exit(0);

    Ok(())
}

/// Information about an available update, returned to the frontend.
#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

/// Check the configured update endpoint for a newer, signature-verified release.
///
/// This only *checks*; it does not download or install. The signature is
/// verified by the updater plugin against `plugins.updater.pubkey` in
/// `tauri.conf.json`. Returns `available: false` when the app is up to date.
#[tauri::command]
pub async fn check_for_updates(app_handle: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;

    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app_handle.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: update.version.clone(),
            current_version,
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: current_version.clone(),
            current_version,
            notes: None,
        }),
        Err(err) => {
            log::warn!("Update check failed: {}", err);
            Err(err.to_string())
        }
    }
}

/// Best-effort shutdown of the backend sidecar and bundled PostgreSQL, shared
/// by the `RunEvent::Exit` handler and `install_update`'s pre-exit hook.
/// Failures are logged and swallowed — teardown must never abort an exit path.
pub(crate) async fn stop_services_for_exit(app_handle: &AppHandle) {
    if let Err(e) = stop_backend_sidecar().await {
        log::warn!("Failed to stop backend sidecar on exit: {}", e);
    }
    if let Err(e) = crate::postgres::stop_postgres(app_handle).await {
        log::warn!("Failed to stop PostgreSQL on exit: {}", e);
    }
}

/// Outcome of an `install_update` call, returned to the frontend.
#[derive(serde::Serialize)]
pub struct InstallOutcome {
    pub installed: bool,
    pub version: String,
}

/// Download, verify (against `plugins.updater.pubkey` in `tauri.conf.json`),
/// and install the pending update. Restart is a separate command so the UI can
/// confirm with the user first.
///
/// Platform note for the update UI (Task 4): on macOS/Linux the install alone
/// does not relaunch the app — the UI should offer `restart_app` next. On
/// Windows the updater runs the NSIS/MSI installer and exits the process via
/// `std::process::exit(0)`; the installer itself relaunches the app
/// (`restart_after_install`, default true). The invoke promise therefore never
/// resolves on Windows — process exit is the success signal, not a failure.
#[tauri::command]
pub async fn install_update(app_handle: AppHandle) -> Result<InstallOutcome, String> {
    use tauri_plugin_updater::UpdaterExt;

    // Windows-only hook (a no-op on other platforms): the plugin's install
    // ends in std::process::exit(0), which bypasses the RunEvent::Exit
    // teardown — the sidecar and pgsql binaries inside the install dir would
    // stay running and file-locked while the installer replaces them.
    // on_before_exit lives on UpdaterBuilder, not Update, and *replaces* the
    // plugin's default cleanup_before_exit hook — so it is re-run here. The
    // callback also fires inside the runtime's async context, where block_on
    // panics, so the async teardown is driven from a helper thread.
    let updater = app_handle
        .updater_builder()
        .on_before_exit({
            let app_handle = app_handle.clone();
            move || {
                let handle = app_handle.clone();
                if let Err(e) = std::thread::spawn(move || {
                    tauri::async_runtime::block_on(stop_services_for_exit(&handle));
                })
                .join()
                {
                    log::warn!("update pre-exit service teardown panicked: {:?}", e);
                }
                app_handle.cleanup_before_exit();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(InstallOutcome {
            installed: false,
            version: env!("CARGO_PKG_VERSION").to_string(),
        });
    };
    let version = update.version.clone();
    let mut downloaded: usize = 0;
    update
        .download_and_install(
            |chunk_length, content_length| {
                downloaded += chunk_length;
                log::info!("update: {}/{}", downloaded, content_length.unwrap_or(0));
            },
            || log::info!("update download finished; installing"),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(InstallOutcome {
        installed: true,
        version,
    })
}

/// Relaunch the app (e.g. after `install_update`). Kept separate from install
/// so the user can finish what they're doing before the restart. Uses
/// `request_restart`, which routes the exit through the event loop — the
/// `RunEvent::Exit` teardown (sidecar + postgres stop) still runs — rather
/// than `tauri::process::restart`, which hard-exits and would orphan them.
/// Returns immediately; the app exits and relaunches shortly after.
#[tauri::command]
pub fn restart_app(app_handle: AppHandle) {
    app_handle.request_restart();
}
