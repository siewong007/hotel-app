# Desktop Managed Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desktop app's scheduled `pg_dump` job into a complete managed backup solution — verified dump+uploads artifacts, a same-version restore command, an in-app backup/restore UI, and a documented recovery runbook.

**Architecture:** Extend the existing `postgres.rs` managed-backup block (`backup_database`, `list_managed_backups`, `prune_old_backups`, `upgrade_database_from_backup`). Each backup becomes a *pair*: `hotel-backup-<ts>.dump` (custom-format pg_dump, verified by `pg_restore --list`) plus `hotel-backup-<ts>-uploads.tar.gz` (uploaded files — mirrors the server's `database-backup.sh` dump+tarball pair). A new `restore_database` command does the same-version recovery the upgrade path already pioneered; the frontend gains a desktop-only card on `DataTransferPage`.

**Tech Stack:** Tauri 2 commands, tokio, `tar` + `flate2` (new deps — see Task 2), React/MUI on `DataTransferPage`, `src/desktop/runtimeApi.ts` invoke wrappers.

## Global Constraints

- `git status --short --branch` before editing — shared tree.
- Desktop crate gates: `cargo check` + `cargo test` in `hotel-desktop/src-tauri` (CI runs both on Ubuntu **and** Windows — code must compile `#[cfg(windows)]`-clean; psql-spawning tests stay `#[cfg(unix)]`-gated; `DESKTOP_TEST_*` env vars gate live-psql coverage).
- Backups stay **inside** the app data directory. `ensure_within_data_dir` exists precisely because the command surface is untrusted webview input — the restore path must validate filenames the same way, never accept absolute paths.
- A restore must never silently destroy data: verified dump in, safety dump out, old uploads renamed aside — never deleted before success.
- The existing `hotel-backup-YYYYMMDD-HHMMSS.dump` naming is the managed-file contract (`BACKUP_FILE_PREFIX`/`BACKUP_FILE_SUFFIX`). Keep it; the uploads pair extends it, doesn't change it.
- Frontend: all strings through `useTranslation`/`tOr`; new keys go in **all four** locale bundles (`en`, `ms`, `zh`, `zh-TW`) — the parity test enforces it.
- Format touched files only: `rustfmt --edition 2024 <file>`; never repo-wide `cargo fmt`.

---

### Task 1: Point the sidecar at the data directory so uploads land inside it

The backend writes `uploads/public/…`, `private_uploads/ekyc`, `private_uploads/payment_receipts` relative to its **process CWD**. `start_backend_sidecar` never sets one, so the sidecar inherits the Tauri app's CWD — in a packaged app that's arbitrary (and possibly read-only, e.g. `/` for a macOS `.app`). One `.current_dir()` fixes every relative-path write at once and makes uploads backable.

**Files:**
- Modify: `hotel-desktop/src-tauri/src/commands.rs:102-119` (`start_backend_sidecar` env block)
- Modify: `hotel-desktop/src-tauri/src/lib.rs:84-97` (`init_data_directories`)

**Interfaces:**
- Consumes: `get_data_directory()` (crate root, returns `dirs::data_local_dir()/HotelApp`).
- Produces: sidecar CWD = data dir; `uploads/` and `private_uploads/` exist under the data dir on every start.

- [ ] **Step 1: Set `current_dir` on the sidecar command**

In `commands.rs`, on the `sidecar_command` builder chain (before `.env("DATABASE_URL", …)`), add:

```rust
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
```

- [ ] **Step 2: Pre-create the upload roots**

In `lib.rs::init_data_directories`, alongside the `logs`/`backups` dirs:

```rust
    std::fs::create_dir_all(data_dir.join("uploads"))?;
    std::fs::create_dir_all(data_dir.join("private_uploads"))?;
```

- [ ] **Step 3: Verify**

Run: `cd hotel-desktop/src-tauri && cargo check && cargo test`
Expected: clean compile, existing tests green.

- [ ] **Step 4: Commit**

```bash
git add hotel-desktop/src-tauri/src/commands.rs hotel-desktop/src-tauri/src/lib.rs
git commit -m "fix(desktop): pin backend sidecar CWD to the app data dir"
```

Note for the commit message/report: existing installs may have stray `uploads/` trees at the old CWD; since no signed desktop release has shipped yet this is dev-only fallout — document it in the runbook (Task 7), don't build migration code.

---

### Task 2: Backup pair — verified dump + uploads tarball

Extend `backup_database` so a managed backup is a *pair* sharing one timestamp: `<name>.dump` + `<name>-uploads.tar.gz`. Verify each new dump with `pg_restore --list` before declaring success. Extend `is_managed_backup_file`/listing/pruning to cover pairs.

**Files:**
- Modify: `hotel-desktop/src-tauri/Cargo.toml` (add `tar`, `flate2`)
- Modify: `hotel-desktop/src-tauri/src/postgres.rs:1289-1470` (the whole managed-backup block)
- Modify: `hotel-desktop/src-tauri/Cargo.lock` (via `cargo check`)

**Interfaces:**
- Consumes: `get_data_directory()`, `get_pgsql_bin_dir()`, `read_or_create_postgres_password()`, `command_output_details()`, `ensure_within_data_dir()`, `EXE_SUFFIX`, `PATH_SEP`, `CREATE_NO_WINDOW` — all already in `postgres.rs`.
- Produces (consumed by Tasks 3–5):
  - `pub struct ManagedBackup { pub dump_path: PathBuf, pub uploads_path: Option<PathBuf>, pub timestamp: String /* RFC3339 */, pub size_bytes: u64 }`
  - `fn list_managed_backups() -> Vec<ManagedBackup>` — grouped pairs, newest first
  - `fn latest_backup_pair() -> Option<ManagedBackup>` — newest pair for the upgrade/restore paths
  - `async fn verify_backup_dump(app_handle, dump_path) -> Result<(), PostgresError>` — `pg_restore --list`
  - `fn backup_uploads(backup_stem: &str) -> Result<Option<PathBuf>, PostgresError>` — writes `<stem>-uploads.tar.gz` when `uploads/` or `private_uploads/` have content
  - `async fn restore_uploads_tarball(tarball_path: &Path) -> Result<(), PostgresError>` — safe extract (Task 4 uses it; Task 5 too)
  - `LatestBackup` (status display struct) gains `uploads_filename: Option<String>` + `size_bytes: u64`, built `from(&ManagedBackup)` in `get_postgres_status`

- [ ] **Step 1: Add the deps**

```bash
cd hotel-desktop/src-tauri && cargo add tar@0.4 flate2@1
```

`tar`+`flate2` are pure-Rust, well-established, and produce the same `.tar.gz` artifact class as the server's `database-backup.sh` — no system `tar` exists on Windows, so a crate is required. Verify the lockfile diff shows only these two (+ their deps: `filetime`, `xattr`, `crc32fast`, `miniz_oxide`).

- [ ] **Step 2: Restructure the managed-backup types**

Replace `list_managed_backups`/`is_managed_backup_file`/`LatestBackup` region (`postgres.rs:1375-1441`) with pair-aware versions:

```rust
const BACKUP_FILE_PREFIX: &str = "hotel-backup-";
const BACKUP_FILE_SUFFIX: &str = ".dump";
const UPLOADS_FILE_SUFFIX: &str = "-uploads.tar.gz";
const BACKUP_RETENTION_COUNT: usize = 14;

/// One managed backup: a verified pg_dump plus its uploads tarball (when any
/// uploaded files existed at backup time). The pair shares the timestamp stem
/// `hotel-backup-YYYYMMDD-HHMMSS`.
pub struct ManagedBackup {
    pub dump_path: PathBuf,
    pub uploads_path: Option<PathBuf>,
    pub timestamp: String, // RFC3339, from dump mtime
    pub size_bytes: u64,   // dump + uploads bytes
}

fn is_managed_backup_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => {
            name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(BACKUP_FILE_SUFFIX)
        }
        None => false,
    }
}

fn is_managed_uploads_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => {
            name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(UPLOADS_FILE_SUFFIX)
        }
        None => false,
    }
}

/// List managed backups (dump+uploads pairs) newest first by dump mtime.
/// A stray `-uploads.tar.gz` with no matching `.dump` is ignored — it cannot
/// be restored without its database half.
fn list_managed_backups() -> Vec<ManagedBackup> {
    let dir = backups_directory();
    let mut dumps: Vec<(PathBuf, std::time::SystemTime)> = match std::fs::read_dir(&dir) {
        Ok(read_dir) => read_dir
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| is_managed_backup_file(p))
            .map(|p| {
                let mtime = p.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                (p, mtime)
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    dumps.sort_by_key(|e| std::cmp::Reverse(e.1));
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
```

Then wire the accessors on the new pair type:

```rust
fn latest_backup_pair() -> Option<ManagedBackup> {
    list_managed_backups().into_iter().next()
}

impl From<&ManagedBackup> for LatestBackup {
    fn from(b: &ManagedBackup) -> Self {
        LatestBackup {
            path: b.dump_path.to_string_lossy().to_string(),
            filename: b.dump_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            timestamp: b.timestamp.clone(),
            size_bytes: b.size_bytes,
            uploads_filename: b
                .uploads_path
                .as_ref()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
        }
    }
}
```

`latest_managed_backup()` becomes `LatestBackup::from(&latest_backup_pair()?)` — `get_postgres_status` keeps returning the same JSON shape plus the two new fields (the FE's `DesktopUpgradeSummary`/`LatestBackup` types tolerate the additions). Task 5 then consumes `latest_backup_pair()` for the upgrade path.

- [ ] **Step 3: Dump verification + uploads tarball in `backup_database`**

After the successful `pg_dump` (before `Ok(backup_path)`), verify then archive uploads:

```rust
    // A dump that pg_restore can't even enumerate is worthless — verify now,
    // at creation time, rather than discovering it during a recovery.
    verify_backup_dump(app_handle, &backup_path).await?;

    // Uploads are user data the dump cannot cover (eKYC images, receipts,
    // room photos) — archive them alongside, sharing the timestamp stem.
    let stem = backup_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    backup_uploads(&stem)?;
```

Implement the two helpers (place them after `backup_database`):

```rust
/// `pg_restore --list` exits non-zero on a corrupt/unreadable dump.
async fn verify_backup_dump(app_handle: &AppHandle, dump_path: &Path) -> Result<(), PostgresError> {
    let pg_restore_path = get_pgsql_bin_dir(app_handle).join(format!("pg_restore{}", EXE_SUFFIX));
    if !pg_restore_path.exists() {
        return Err(PostgresError::BinaryNotFound(pg_restore_path.to_string_lossy().to_string()));
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
        // Don't leave a corrupt artifact on disk pretending to be a backup.
        let _ = std::fs::remove_file(dump_path);
        return Err(PostgresError::MigrationFailed(format!("Backup verification failed: {}", details)));
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
        .filter(|dir| dir.is_dir() && dir.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false))
        .collect::<Vec<_>>();
    if roots.is_empty() {
        return Ok(None);
    }

    let out_path = backups_directory().join(format!("{}{}", stem, UPLOADS_FILE_SUFFIX));
    let file = std::fs::File::create(&out_path)?;
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut builder = tar::Builder::new(encoder);
    for dir in roots {
        // Top-level entry name is the dir itself ("uploads", "private_uploads")
        // so extraction restores the layout verbatim.
        builder.append_dir_all(dir.file_name().unwrap_or_default(), &dir)?;
    }
    builder.into_inner()?.finish()?;
    Ok(Some(out_path))
}
```

- [ ] **Step 4: Pair-aware pruning**

`prune_old_backups` now iterates `list_managed_backups()` and removes the dump **and** its uploads partner (re-check both predicates before deleting):

```rust
fn prune_old_backups() {
    let backups = list_managed_backups();
    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }
    for stale in backups.into_iter().skip(BACKUP_RETENTION_COUNT) {
        for path in [stale.dump_path].into_iter().chain(stale.uploads_path) {
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
```

- [ ] **Step 5: Rust tests for the new predicates**

Add to the existing `#[cfg(test)]` module in `postgres.rs` (follow its current conventions):

```rust
#[test]
fn managed_file_predicates_split_dumps_from_uploads() {
    assert!(is_managed_backup_file(Path::new("hotel-backup-20260918-120000.dump")));
    assert!(!is_managed_backup_file(Path::new("hotel-backup-20260918-120000-uploads.tar.gz")));
    assert!(is_managed_uploads_file(Path::new("hotel-backup-20260918-120000-uploads.tar.gz")));
    assert!(!is_managed_uploads_file(Path::new("hotel-backup-20260918-120000.dump")));
    assert!(!is_managed_uploads_file(Path::new("random.tar.gz")));
}
```

(These predicates check `is_file()` — the predicates-as-written also need the file to exist; either split the name check from the file check (`fn is_managed_backup_name(name: &str)`) or create temp files in the test. Split the name check — cleaner and matches how the code is used.)

- [ ] **Step 6: Verify**

Run: `cd hotel-desktop/src-tauri && cargo check && cargo test`
Expected: clean; on a machine with a provisioned pgsql tree, a manual `bun run dev` produces both artifacts in `<data>/backups` after 120 s.

- [ ] **Step 7: Commit**

```bash
git add hotel-desktop/src-tauri/Cargo.toml hotel-desktop/src-tauri/Cargo.lock hotel-desktop/src-tauri/src/postgres.rs
git commit -m "feat(desktop): verified dump + uploads tarball as one managed backup"
```

---

### Task 3: `list_backups` and `open_backups_folder` commands

The frontend needs the full managed list (today only `latest_backup` exists, and only when `needs_upgrade`). `open_backups_folder` is the escape hatch for off-app copies — deliberately *open the folder*, not "save anywhere": `ensure_within_data_dir` exists so a dump of guest PII can't be written to an arbitrary path from webview script, and that policy stays.

**Files:**
- Modify: `hotel-desktop/src-tauri/src/postgres.rs` (expose `managed_backup_infos()`)
- Modify: `hotel-desktop/src-tauri/src/commands.rs` (two commands)
- Modify: `hotel-desktop/src-tauri/src/lib.rs:53-62` (invoke_handler)

**Interfaces:**
- Produces:
  - `postgres::managed_backup_infos() -> Vec<BackupInfo>` where `#[derive(serde::Serialize)] pub struct BackupInfo { pub filename: String, pub timestamp: String, pub size_bytes: u64, pub uploads_filename: Option<String> }`
  - `commands::list_backups() -> Vec<BackupInfo>`
  - `commands::open_backups_folder()` — same spawn pattern as `open_data_folder` on `backups_directory()`

- [ ] **Step 1: `BackupInfo` + public lister in postgres.rs**

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupInfo {
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
    pub uploads_filename: Option<String>,
}

pub fn managed_backup_infos() -> Vec<BackupInfo> {
    list_managed_backups()
        .into_iter()
        .map(|b| BackupInfo {
            filename: b.dump_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            timestamp: b.timestamp,
            size_bytes: b.size_bytes,
            uploads_filename: b
                .uploads_path
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
        })
        .collect()
}
```

- [ ] **Step 2: Commands**

```rust
/// List managed database backups (newest first) for the backup/restore UI.
#[tauri::command]
pub async fn list_backups() -> Result<Vec<crate::postgres::BackupInfo>, String> {
    Ok(crate::postgres::managed_backup_infos())
}

/// Open the managed backups folder in the OS file explorer so the user can
/// copy dumps off-app. Deliberately folder-only: arbitrary destination paths
/// stay refused (see ensure_within_data_dir).
#[tauri::command]
pub async fn open_backups_folder() -> Result<(), String> {
    let dir = get_data_directory().join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Same per-OS spawn as open_data_folder — factor a shared helper
    // `open_in_file_manager(path)` and call it from both commands.
    open_in_file_manager(&dir)
}
```

Factor `open_in_file_manager(path: &Path) -> Result<(), String>` out of `open_data_folder` (macOS `open`, Windows `explorer`, Linux `xdg-open`) and reuse it in both commands.

- [ ] **Step 3: Register + verify**

Add `commands::list_backups` and `commands::open_backups_folder` to `invoke_handler!` in `lib.rs`.

Run: `cd hotel-desktop/src-tauri && cargo check && cargo test`

- [ ] **Step 4: Commit**

```bash
git add hotel-desktop/src-tauri/src/commands.rs hotel-desktop/src-tauri/src/postgres.rs hotel-desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): list_backups + open_backups_folder commands"
```

---

### Task 4: `restore_database` — same-version recovery with safety dump + rollback

The missing half of managed backup: today `restore_backup_dump` exists but is private and only reachable via the major-version upgrade flow. Add a same-version restore: validate → verify → safety dump → stop sidecar → restore → restore uploads → restart sidecar → auto-rollback on failure.

**Files:**
- Modify: `hotel-desktop/src-tauri/src/postgres.rs` (`restore_database`, `restore_uploads_tarball`, `resolve_managed_dump`)
- Modify: `hotel-desktop/src-tauri/src/commands.rs` (`restore_database` command)
- Modify: `hotel-desktop/src-tauri/src/lib.rs` (invoke_handler)

**Interfaces:**
- Consumes: `stop_backend_sidecar()`/`start_backend_sidecar()` from `commands.rs`; `verify_backup_dump`, `list_managed_backups`, `is_managed_backup_file` from Task 2; `restore_backup_dump` (existing private).
- Produces:
  - `pub async fn restore_database(app_handle: &AppHandle, filename: &str) -> Result<RestoreSummary, PostgresError>`
  - `#[derive(serde::Serialize)] pub struct RestoreSummary { pub restored_backup: String, pub restored_uploads: Option<String>, pub safety_backup: String }`
  - `commands::restore_database(app_handle, filename: String) -> Result<RestoreSummary, String>` — stops the sidecar before delegating, restarts it after (mirroring `upgrade_database_from_backup`'s tail).

- [ ] **Step 1: Filename validation (untrusted input)**

```rust
/// Resolve a user-supplied backup filename to a managed dump inside the
/// backups dir. Bare filename only — no separators, must match the managed
/// pattern, must exist in the managed list (a file dropped there by hand
/// with a matching name is fine; anything else is refused).
fn resolve_managed_dump(filename: &str) -> Result<PathBuf, PostgresError> {
    let reject = || PostgresError::InvalidBackupDestination(filename.to_string());
    // Bare filename only — file_name() == the input rejects anything with separators.
    let name = Path::new(filename)
        .file_name()
        .filter(|n| *n == std::ffi::OsStr::new(filename))
        .ok_or_else(reject)?;
    let candidate = backups_directory().join(name);
    if !is_managed_backup_file(&candidate) {
        return Err(reject());
    }
    Ok(candidate)
}
```

- [ ] **Step 2: `restore_uploads_tarball`**

```rust
/// Extract a `-uploads.tar.gz` into the data dir. Current uploads/ and
/// private_uploads/ are renamed aside FIRST and only deleted after a clean
/// extract — a corrupt tarball can never leave the app without its files.
/// Tar entries are validated: absolute paths and `..` components abort.
async fn restore_uploads_tarball(tarball_path: &Path) -> Result<(), PostgresError> {
    let data_dir = get_data_directory();
    let file = std::fs::File::open(tarball_path)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);

    // Pre-validate every entry path before touching the filesystem.
    for entry in archive.entries()? {
        let entry = entry?;
        let path = entry.path()?;
        if path.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_))) {
            return Err(PostgresError::MigrationFailed(format!(
                "Refusing uploads archive with unsafe path {:?}",
                path
            )));
        }
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
            // Roll the renamed dirs back.
            for (aside, original) in retired {
                let _ = std::fs::remove_dir_all(&original);
                let _ = std::fs::rename(&aside, &original);
            }
            Err(PostgresError::MigrationFailed(format!("uploads restore failed: {}", err)))
        }
    }
}
```

- [ ] **Step 3: `restore_database` orchestration**

```rust
/// Same-version restore: replace the live database (and uploads) with a
/// managed backup. A fresh safety dump is taken first — if the restore fails,
/// the safety dump is restored back automatically (best effort) and named in
/// the error either way.
pub async fn restore_database(
    app_handle: &AppHandle,
    filename: &str,
) -> Result<RestoreSummary, PostgresError> {
    let dump_path = resolve_managed_dump(filename)?;
    verify_backup_dump(app_handle, &dump_path).await?;
    let uploads_path = {
        let stem = filename.trim_end_matches(BACKUP_FILE_SUFFIX);
        let candidate = backups_directory().join(format!("{}{}", stem, UPLOADS_FILE_SUFFIX));
        is_managed_uploads_file(&candidate).then_some(candidate)
    };

    // Safety net: a pre-restore dump the user can roll back to. Uses the same
    // managed naming so it lands in the list and prunes naturally.
    let safety_path = backup_database(app_handle, None).await?;
    let safety_name = safety_path.file_name().unwrap_or_default().to_string_lossy().to_string();

    if let Err(err) = restore_backup_dump(app_handle, &dump_path).await {
        // Best-effort auto-rollback to the pre-restore state.
        let rollback_note = match restore_backup_dump(app_handle, &safety_path).await {
            Ok(()) => "The pre-restore state was rolled back automatically.".to_string(),
            Err(rb) => format!(
                "Automatic rollback also failed ({}); restore {} manually to recover the pre-restore state.",
                rb, safety_name
            ),
        };
        return Err(PostgresError::MigrationFailed(format!(
            "Restore of {} failed: {}. {}",
            filename, err, rollback_note
        )));
    }

    if let Some(tarball) = &uploads_path {
        restore_uploads_tarball(tarball).await.map_err(|err| {
            PostgresError::MigrationFailed(format!(
                "Database restored but uploads restore failed: {}. Database state is from {}; uploaded files may be inconsistent.",
                err, filename
            ))
        })?;
    }

    Ok(RestoreSummary {
        restored_backup: filename.to_string(),
        restored_uploads: uploads_path.and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
        safety_backup: safety_name,
    })
}
```

Caveat to encode in the code comment: `pg_restore --clean` is not transactional — the safety dump is the mitigation for a mid-restore failure, which is why rollback is attempted immediately rather than left to the user.

- [ ] **Step 4: Command + registration**

```rust
/// Restore a managed backup (dump + uploads pair) into the live database.
/// Stops the sidecar first, restarts it after — the webview sees the normal
/// service-restart flow while this runs.
#[tauri::command]
pub async fn restore_database(
    app_handle: AppHandle,
    filename: String,
) -> Result<crate::postgres::RestoreSummary, String> {
    log::info!("Database restore requested from {}", filename);
    stop_backend_sidecar().await?;
    let result = crate::postgres::restore_database(&app_handle, &filename).await;
    // Always try to bring the app back — even on failure the pre-restore
    // state (rolled back or not) is the database the app should serve.
    if let Err(err) = start_backend_sidecar(&app_handle).await {
        return Err(format!("{} (additionally, backend restart failed: {})",
            result.map(|_| "Restore finished".to_string()).unwrap_or_else(|e| e.to_string()), err));
    }
    result.map_err(|e| e.to_string())
}
```

Register `commands::restore_database` in `invoke_handler!`.

- [ ] **Step 5: Unit test the validation**

```rust
#[test]
fn restore_rejects_non_managed_filenames() {
    for bad in ["../etc/passwd", "foo/bar.dump", "hotel-backup-x.sql", "..", "backups/hotel-backup-1.dump"] {
        assert!(resolve_managed_dump(bad).is_err(), "{bad} should be refused");
    }
}
```

(Like the predicate test, run inside the existing `#[cfg(test)]` module; `resolve_managed_dump` needs a backups dir — either point `get_data_directory()` at a temp dir in tests if an override exists, or split `resolve_managed_dump` into a pure name-validation fn + a filesystem lookup and test the pure half. Split it.)

- [ ] **Step 6: Verify + commit**

Run: `cd hotel-desktop/src-tauri && cargo check && cargo test`

```bash
git add hotel-desktop/src-tauri/src/postgres.rs hotel-desktop/src-tauri/src/commands.rs hotel-desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): same-version restore_database with safety dump and rollback"
```

---

### Task 5: Upgrade path restores uploads too

`upgrade_database_from_backup` currently restores only the dump — a guest upgrading across a postgres major bump would silently lose every uploaded file. One insertion fixes it.

**Files:**
- Modify: `hotel-desktop/src-tauri/src/postgres.rs:1671-1687` (between restore and `run_database_setup`), and `latest_managed_backup` usage at `:1580-1586`
- Modify: `UpgradeSummary` (+ `restored_uploads`), `runtimeApi.ts` `DesktopUpgradeSummary` type

**Interfaces:**
- Consumes: `ManagedBackup.uploads_path` (Task 2), `restore_uploads_tarball` (Task 4).
- Produces: `UpgradeSummary.restored_uploads: Option<String>`; FE `DesktopUpgradeSummary` gains `restored_uploads?: string | null`.

- [ ] **Step 1: Carry `ManagedBackup` through the upgrade flow**

The upgrade path needs the pair, not the display struct — change `upgrade_database_from_backup`'s `latest_managed_backup()` call to `latest_backup_pair()` (added in Task 2). `get_postgres_status` keeps using `latest_managed_backup()`/`LatestBackup` unchanged.

- [ ] **Step 2: Restore uploads after the dump**

After the `restore_backup_dump` block in `upgrade_database_from_backup`:

```rust
    // (e2) Restore uploaded files when the backup pair carries them.
    if let Some(tarball) = &latest.uploads_path {
        if let Err(err) = restore_uploads_tarball(tarball).await {
            let _ = stop_postgres(app_handle).await;
            return Err(rollback(format!("uploads restore from {:?} failed: {}", tarball, err)));
        }
    }
```

Add `restored_uploads: Option<String>` to `UpgradeSummary` and populate from `latest.uploads_path`.

- [ ] **Step 3: FE type update**

In `hotel-web-fe/src/desktop/runtimeApi.ts`:

```ts
export interface DesktopUpgradeSummary {
  restored_backup: string;
  restored_uploads?: string | null;
  retired_data_dir: string;
  from_version: string;
  to_version: string;
}
```

- [ ] **Step 4: Verify + commit**

Run: `cd hotel-desktop/src-tauri && cargo check && cargo test` and `cd hotel-web-fe && bun run typecheck`

```bash
git add hotel-desktop/src-tauri/src/postgres.rs hotel-web-fe/src/desktop/runtimeApi.ts
git commit -m "feat(desktop): guided upgrade restores the uploads half of the backup pair"
```

---

### Task 6: Frontend — desktop backup card on DataTransferPage

A desktop-only section on `/data-transfer` (the app's existing backup/restore surface): list managed backups, "Back up now", per-row Restore with an explicit-data-loss confirm, "Open backups folder". Restore intentionally drops the app into the normal `DesktopServiceGate` restart screen — the result arrives via a `desktop-restore-finished`-style status refresh when the app remounts.

**Files:**
- Create: `hotel-web-fe/src/features/admin/components/data-transfer/DesktopBackupsCard.tsx`
- Create: `hotel-web-fe/src/features/admin/components/data-transfer/DesktopBackupsCard.test.tsx`
- Modify: `hotel-web-fe/src/desktop/runtimeApi.ts` (wrappers + `DesktopBackupInfo` type)
- Modify: `hotel-web-fe/src/features/admin/components/DataTransferPage.tsx` (render the card — below the tab content, gated on `shouldUseDesktopRuntime()`)
- Modify: `hotel-web-fe/src/i18n/resources/{en,ms,zh,zh-TW}/common.json` (new `desktop.backups.*` keys)
- Modify: `hotel-web-fe/src/test/pageManifest.ts` (`data-transfer` `workflowTests` += the new test file)

**Interfaces:**
- Consumes: `list_backups`, `backup_database`, `restore_database`, `open_backups_folder` commands (Tasks 3–4); `shouldUseDesktopRuntime()`, `getTauriCoreApi()`; `DesktopServiceGate`'s restart flow (no changes needed).
- Produces:
  ```ts
  export interface DesktopBackupInfo {
    filename: string;
    timestamp: string;       // RFC3339 — render local via intlTag()
    size_bytes: number;
    uploads_filename: string | null;
  }
  export async function listBackups(): Promise<DesktopBackupInfo[]>
  export async function backupNow(): Promise<string>            // returns path
  export async function restoreDatabase(filename: string): Promise<DesktopRestoreSummary>
  export async function openBackupsFolder(): Promise<void>
  export interface DesktopRestoreSummary { restored_backup: string; restored_uploads: string | null; safety_backup: string }
  ```

- [ ] **Step 1: runtimeApi wrappers**

```ts
export interface DesktopBackupInfo {
  filename: string;
  timestamp: string;
  size_bytes: number;
  uploads_filename: string | null;
}

export interface DesktopRestoreSummary {
  restored_backup: string;
  restored_uploads: string | null;
  safety_backup: string;
}

export async function listBackups(): Promise<DesktopBackupInfo[]> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopBackupInfo[]>('list_backups');
}

export async function backupNow(): Promise<string> {
  const { invoke } = await getTauriCoreApi();
  return invoke<string>('backup_database', { destination: null });
}

export async function restoreDatabase(filename: string): Promise<DesktopRestoreSummary> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopRestoreSummary>('restore_database', { filename });
}

export async function openBackupsFolder(): Promise<void> {
  const { invoke } = await getTauriCoreApi();
  return invoke<void>('open_backups_folder');
}
```

- [ ] **Step 2: The card component**

`DesktopBackupsCard.tsx` — MUI `Card`, uses `useTranslation('common')` with `tOr` for `desktop.backups.*` keys:

- On mount: `listBackups()` → rows of `{filename, local timestamp, human size, uploads badge}`.
- "Back up now" → `backupNow()` → spinner → refetch list → toast via `notify` prop.
- Row "Restore" → confirm dialog: `tOr('desktop.backups.restoreConfirm', …)` stating *data after the backup is lost* and that a safety backup is taken first → `restoreDatabase(filename)` → the app drops into the gate's restart screen (expected); on rejection show the error in-place.
- "Open backups folder" → `openBackupsFolder()`.
- Render nothing when `!shouldUseDesktopRuntime()` (double-gate — the parent also gates, so the card never mounts its IPC calls in a browser).

- [ ] **Step 3: Mount on the page**

In `DataTransferPage.tsx`, below the tab content block:

```tsx
      {activeTab === 'history' && (
        <TransferHistoryList entries={historyEntries} loading={historyQuery.isLoading} />
      )}

      {shouldUseDesktopRuntime() && <DesktopBackupsCard notify={notify} />}
```

Import `shouldUseDesktopRuntime` from `../../../../desktop/runtimeApi` (check the relative path — `features/admin/components` → `src/desktop/runtimeApi` is `../../../desktop/runtimeApi`).

- [ ] **Step 4: i18n keys (all four locales)**

Under `common.json` `desktop` (the gate strings already live there):

```json
"backups": {
  "title": "Local backups",
  "subtitle": "Automatic database + file backups kept on this computer. Newest {{count}} kept.",
  "backUpNow": "Back up now",
  "openFolder": "Open backups folder",
  "includesFiles": "includes uploaded files",
  "restore": "Restore",
  "restoreConfirmTitle": "Restore this backup?",
  "restoreConfirmBody": "The app restores {{filename}} ({{date}}). Data changed after that point is lost — a fresh safety backup is taken first so you can roll back. The app restarts during the restore.",
  "restoreConfirm": "Restore and restart",
  "restoring": "Restoring… the app will restart when it finishes.",
  "restored": "Restored {{filename}}",
  "restoreFailed": "Restore failed",
  "empty": "No backups yet — the first one is created automatically about two minutes after startup.",
  "backedUp": "Backup created: {{filename}}"
}
```

Add translated equivalents to `ms`, `zh`, `zh-TW` `common.json` (parity test requires the same key set — write real translations, not English fallbacks).

- [ ] **Step 5: Component test**

`DesktopBackupsCard.test.tsx` — mock `../../../../desktop/runtimeApi` (`listBackups`, `backupNow`, `restoreDatabase`, `openBackupsFolder`, `shouldUseDesktopRuntime: () => true`):

```tsx
it('lists managed backups with size and uploads badge', async () => { … });
it('Back up now calls backupNow and refetches', async () => { … });
it('restore requires confirmation before invoking restoreDatabase', async () => {
  // click Restore on a row → dialog appears → assert restoreDatabase NOT called
  // → click confirm → assert called with the row filename
});
```

Register it in `pageManifest.ts` `data-transfer` `workflowTests`.

- [ ] **Step 6: Verify**

Run: `cd hotel-web-fe && bun run test src/features/admin/components/data-transfer/ src/test/pageCoverage.test.ts && bun run typecheck && bun run lint:strict`

- [ ] **Step 7: Commit**

```bash
git add hotel-web-fe/src/features/admin/components/data-transfer/DesktopBackupsCard.tsx \
        hotel-web-fe/src/features/admin/components/data-transfer/DesktopBackupsCard.test.tsx \
        hotel-web-fe/src/desktop/runtimeApi.ts \
        hotel-web-fe/src/features/admin/components/DataTransferPage.tsx \
        hotel-web-fe/src/i18n/resources/ \
        hotel-web-fe/src/test/pageManifest.ts
git commit -m "feat(desktop): managed backup/restore card on the data-transfer page"
```

---

### Task 7: Recovery runbook + docs

**Files:**
- Create: `docs/guides/desktop-backup-restore.md`
- Modify: `docs/guides/deployment.md:658-663` (replace the stale `cp -r` "Desktop Data Backup" section with a pointer)
- Modify: `docs/FEATURES.md` (desktop row — note managed backup)
- Modify: `docs/ongoing-dev.md` (if a backup entry exists, update; else nothing)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write `docs/guides/desktop-backup-restore.md`**

Content:

````markdown
# Desktop Backup & Restore

The desktop app manages its own backup lifecycle — no cron, no manual pg_dump.

## What a backup is

Each backup is a pair in `<data dir>/backups/`:

- `hotel-backup-YYYYMMDD-HHMMSS.dump` — custom-format `pg_dump` of the whole
  `hotel_management` database, verified with `pg_restore --list` at creation.
- `hotel-backup-YYYYMMDD-HHMMSS-uploads.tar.gz` — `uploads/` + `private_uploads/`
  (eKYC images, payment receipts, room photos) when any existed. Newest 14 pairs
  are kept; older ones are pruned automatically.

The data dir is `~/Library/Application Support/HotelApp` (macOS),
`%LOCALAPPDATA%\HotelApp` (Windows), `~/.local/share/HotelApp` (Linux).

## Schedule

First backup ~2 minutes after services come up, then every 24 h
(`FIRST_BACKUP_DELAY_SECS` / `BACKUP_INTERVAL_SECS` in `src-tauri/src/lib.rs`).
Failures log and retry next cycle; they never crash the app.

## In-app controls

`/data-transfer` → "Local backups" card (desktop builds only): list, back up
now, restore, open the backups folder. Off-app copies = copy files out of the
opened folder — arbitrary destination paths are refused by design
(`ensure_within_data_dir`).

## Recovery procedures

### Same-version restore (corruption, bad data day)

In-app: Local backups card → Restore → confirm → the app restarts itself.
CLI equivalent — `pg_restore` is a client, so the bundled postgres must be
running (whether the app itself is open or you started the cluster
manually); `--clean --if-exists` drops existing objects, so no pre-drop is
needed. The cluster enforces `scram-sha-256`, so `pg_restore` needs the
generated password in `<data dir>/postgres-password.txt` — pass it via
`PGPASSWORD` or it stops at a `Password:` prompt:

```bash
PGPASSWORD=$(cat ~/Library/Application\ Support/HotelApp/postgres-password.txt) \
  pg_restore -h localhost -p 5433 -U hotel_admin -d hotel_management \
  --clean --if-exists --no-owner --no-privileges \
  ~/Library/Application\ Support/HotelApp/backups/hotel-backup-<ts>.dump

# Move the current upload trees aside before extracting — the in-app
# restore does the same — so files written since the backup cannot
# silently merge into the restored tree.
cd ~/Library/Application\ Support/HotelApp
stamp=$(date +%Y%m%dT%H%M%SZ)
[ -d uploads ] && mv uploads "uploads.prerestore-$stamp"
[ -d private_uploads ] && mv private_uploads "private_uploads.prerestore-$stamp"
tar -xzf backups/hotel-backup-<ts>-uploads.tar.gz
# verify the restored trees, then delete the *.prerestore-* asides
```

The bundled binaries live under the app's `pgsql/bin` resource dir; any
matching-version `pg_restore` works. Every in-app restore first writes a
`hotel-backup-<now>.dump` safety backup — restoring *that* file rolls back a
restore.

### Major-version upgrade (new postgres build refuses the old data dir)

Automatic: the app detects the mismatch and offers "Restore from backup" at
startup (see `upgrade_database_from_backup`). The old `pgdata` is renamed
`pgdata-pg<ver>-retired-<ts>` — never deleted.

### Bare-metal / new machine

1. Install the app, let it initialize once, quit.
2. Replace `<data dir>/backups/` contents with the saved pair(s).
3. Start the app → Local backups → Restore the newest pair.
   (Or drop the pair anywhere and run the CLI form above.)
4. `pgdata` itself is NOT portable across versions — always move the logical
   backup, not the data directory.

### What is NOT covered

`pgdata` corruption *between* backups (latest dump wins — up to 24 h of writes
can be lost; shorten `BACKUP_INTERVAL_SECS` or back up before risky work), files
written outside the data dir, and anything the user never backed up before a
disk failure. Off-app copies are the real disaster-recovery story — the backups
folder is one filesystem.
````

- [ ] **Step 2: Fix `deployment.md`**

Replace the "Desktop Data Backup" `cp -r` block with:

```markdown
### Desktop Data Backup

Desktop builds manage their own verified backup pairs (`pg_dump` + uploads
tarball, newest 14 kept) under the app data dir — see
[desktop-backup-restore.md](../../guides/desktop-backup-restore.md). There
is no manual copy step; `pgdata` is not portable across bundled versions.
```

(The link target above is written relative to this plan file so the doc-link
checker resolves it; as deployed in `docs/guides/deployment.md` it is the
sibling `desktop-backup-restore.md`.)

- [ ] **Step 3: FEATURES.md + verify links**

Update the desktop row: append "managed backup pairs (dump+uploads, 14 kept) with in-app restore — `guides/desktop-backup-restore.md`". Run `python3 scripts/check-doc-links.py` (CI gate) to confirm no broken links.

- [ ] **Step 4: Commit**

```bash
git add docs/guides/desktop-backup-restore.md docs/guides/deployment.md docs/FEATURES.md
git commit -m "docs(desktop): backup/restore runbook and recovery procedures"
```
