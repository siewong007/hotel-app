use super::{command_output_details, PostgresError, PATH_SEP};
use sha2::{Digest, Sha256};
use std::fs::{File, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Component, Path};
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

#[cfg(not(any(target_os = "linux", target_vendor = "apple", windows)))]
compile_error!("desktop patch file identity checks require Linux, Apple, or Windows");

const DIAGNOSTIC_OUTPUT_LIMIT: usize = 32 * 1024;
const DIAGNOSTIC_TRUNCATION_MARKER: &[u8] = b"\n[diagnostic output truncated after 32768 bytes]\n";
// Let an already-exiting child publish its real failure before treating EPIPE as primary.
const CHILD_EXIT_DIAGNOSTIC_GRACE: Duration = Duration::from_millis(50);
// Killing a local child should be immediate; never let abnormal OS cleanup hang startup.
const CHILD_REAP_TIMEOUT: Duration = Duration::from_secs(2);
// A reaped direct child closes its pipes; this only expires for inherited descendant handles.
const DRAIN_COMPLETION_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq, Eq)]
struct PatchManifestEntry {
    generation: i32,
    version: i32,
    name: String,
    checksum: String,
    file: String,
}

struct VerifiedPatch {
    entry: PatchManifestEntry,
    source: Vec<u8>,
}

pub(super) struct PsqlConnection {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) user: String,
    pub(super) database: String,
    pub(super) password: String,
}

impl PsqlConnection {
    pub(super) fn new(
        host: impl Into<String>,
        port: u16,
        user: impl Into<String>,
        database: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            user: user.into(),
            database: database.into(),
            password: password.into(),
        }
    }
}

fn catalog_error(message: impl Into<String>) -> PostgresError {
    PostgresError::MigrationFailed(format!(
        "Invalid PostgreSQL patch catalog: {}",
        message.into()
    ))
}

fn is_positive_integer(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'1'..=b'9')) && bytes.all(|byte| byte.is_ascii_digit())
}

fn is_patch_name(value: &str) -> bool {
    !value.is_empty()
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn is_checksum(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn is_patch_file(value: &str) -> bool {
    let path = Path::new(value);
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return false;
    }

    let Some(stem) = value.strip_suffix(".sql") else {
        return false;
    };
    let bytes = stem.as_bytes();
    bytes.len() > 5
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'_'
        && bytes[5..]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
}

fn parse_manifest(contents: &str) -> Result<Vec<PatchManifestEntry>, PostgresError> {
    let mut entries: Vec<PatchManifestEntry> = Vec::new();

    for (index, line) in contents.lines().enumerate() {
        let line_number = index + 1;
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 5 {
            return Err(catalog_error(format!(
                "manifest line {line_number} must have exactly five tab-separated fields"
            )));
        }
        let [generation, version, name, checksum, file] = fields.as_slice() else {
            unreachable!("field count was checked")
        };

        if !is_positive_integer(generation) {
            return Err(catalog_error(format!(
                "invalid generation on manifest line {line_number}"
            )));
        }
        if !is_positive_integer(version) {
            return Err(catalog_error(format!(
                "invalid version on manifest line {line_number}"
            )));
        }
        if !is_patch_name(name) {
            return Err(catalog_error(format!(
                "invalid name on manifest line {line_number}"
            )));
        }
        if !is_checksum(checksum) {
            return Err(catalog_error(format!(
                "invalid checksum on manifest line {line_number}"
            )));
        }
        if !is_patch_file(file) {
            return Err(catalog_error(format!(
                "invalid file on manifest line {line_number}"
            )));
        }

        let generation = generation.parse::<i32>().map_err(|_| {
            catalog_error(format!("invalid generation on manifest line {line_number}"))
        })?;
        let version = version.parse::<i32>().map_err(|_| {
            catalog_error(format!("invalid version on manifest line {line_number}"))
        })?;
        if generation != 1 {
            return Err(catalog_error(format!(
                "unsupported generation on manifest line {line_number}"
            )));
        }

        match entries.last() {
            None if version != 2 => {
                return Err(catalog_error("the first patch version must be 2"));
            }
            Some(previous) if version <= previous.version => {
                return Err(catalog_error(format!(
                    "duplicate or non-increasing patch version: {version}"
                )));
            }
            Some(previous) if version != previous.version + 1 => {
                return Err(catalog_error(format!(
                    "patch versions must be contiguous: expected {}, found {version}",
                    previous.version + 1
                )));
            }
            _ => {}
        }

        entries.push(PatchManifestEntry {
            generation,
            version,
            name: (*name).to_string(),
            checksum: (*checksum).to_string(),
            file: (*file).to_string(),
        });
    }

    let required_prefix = [
        (
            2,
            "google-subject",
            "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650",
            "0002_google_subject.sql",
        ),
        (
            3,
            "payment-idempotency",
            "sha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36",
            "0003_payment_idempotency.sql",
        ),
        (
            4,
            "booking-status-vocabulary",
            "sha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7",
            "0004_booking_status_vocabulary.sql",
        ),
        (
            5,
            "booking-status-enforcement",
            "sha256:a9ea019977a421f15bf923e074384ecaf88e458af85b3f15c6bc6b3aa66a08e3",
            "0005_booking_status_enforcement.sql",
        ),
    ];
    if entries.len() < required_prefix.len()
        || entries
            .iter()
            .zip(required_prefix)
            .any(|(entry, (version, name, checksum, file))| {
                entry.version != version
                    || entry.name != name
                    || entry.checksum != checksum
                    || entry.file != file
            })
    {
        return Err(catalog_error(
            "manifest must begin with the committed V1 patch versions 2, 3, 4, and 5",
        ));
    }

    Ok(entries)
}

#[cfg(unix)]
fn open_catalog_file(path: &Path, file: &str) -> Result<File, PostgresError> {
    use std::os::unix::fs::OpenOptionsExt;

    #[cfg(target_os = "linux")]
    const O_NOFOLLOW: i32 = 0x0002_0000;
    #[cfg(target_vendor = "apple")]
    const O_NOFOLLOW: i32 = 0x0000_0100;

    OpenOptions::new()
        .read(true)
        .custom_flags(O_NOFOLLOW)
        .open(path)
        .map_err(|error| catalog_error(format!("{file} is unavailable: {error}")))
}

#[cfg(windows)]
fn open_catalog_file(path: &Path, file: &str) -> Result<File, PostgresError> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    // Omitting FILE_SHARE_DELETE keeps this path entry locked until its validated handle closes.
    const FILE_SHARE_READ_WRITE: u32 = 0x0000_0001 | 0x0000_0002;

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| catalog_error(format!("{file} is unavailable: {error}")))
}

#[cfg(unix)]
fn same_file_identity(opened: &Metadata, path: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    opened.dev() == path.dev() && opened.ino() == path.ino()
}

#[cfg(windows)]
fn same_file_identity(opened: &Metadata, path: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    // The open handle prevents replacement; stable metadata fields confirm both views agree.
    opened.file_attributes() == path.file_attributes()
        && opened.creation_time() == path.creation_time()
        && opened.last_write_time() == path.last_write_time()
        && opened.file_size() == path.file_size()
}

#[cfg(unix)]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn read_opened_catalog_file(
    mut opened: File,
    path: &Path,
    file: &str,
) -> Result<Vec<u8>, PostgresError> {
    let opened_metadata = opened
        .metadata()
        .map_err(|error| catalog_error(format!("{file} is unavailable: {error}")))?;
    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| catalog_error(format!("{file} is unavailable: {error}")))?;
    if !opened_metadata.is_file()
        || !path_metadata.is_file()
        || path_metadata.file_type().is_symlink()
        || is_reparse_point(&opened_metadata)
        || is_reparse_point(&path_metadata)
    {
        return Err(catalog_error(format!("{file} is unavailable")));
    }
    if !same_file_identity(&opened_metadata, &path_metadata) {
        return Err(catalog_error(format!("{file} changed while being read")));
    }

    let mut bytes = Vec::new();
    opened
        .read_to_end(&mut bytes)
        .map_err(|error| catalog_error(format!("{file} cannot be read: {error}")))?;
    Ok(bytes)
}

fn read_catalog_file(patch_dir: &Path, file: &str) -> Result<Vec<u8>, PostgresError> {
    let path = patch_dir.join(file);
    let opened = open_catalog_file(&path, file)?;
    read_opened_catalog_file(opened, &path, file)
}

fn append_segment(source: &mut Vec<u8>, segment: &[u8]) {
    source.extend_from_slice(segment);
    if !source.ends_with(b"\n") {
        source.push(b'\n');
    }
}

fn load_catalog(patch_dir: &Path) -> Result<Vec<VerifiedPatch>, PostgresError> {
    let manifest_bytes = read_catalog_file(patch_dir, "manifest.tsv")?;
    let manifest = std::str::from_utf8(&manifest_bytes)
        .map_err(|error| catalog_error(format!("manifest.tsv is not UTF-8: {error}")))?;
    let entries = parse_manifest(manifest)?;
    let begin = read_catalog_file(patch_dir, "_begin.sql")?;
    let end = read_catalog_file(patch_dir, "_end.sql")?;

    entries
        .into_iter()
        .map(|entry| {
            let bytes = read_catalog_file(patch_dir, &entry.file)?;
            let actual_checksum = format!("sha256:{}", hex::encode(Sha256::digest(&bytes)));
            if actual_checksum != entry.checksum {
                return Err(catalog_error(format!(
                    "checksum mismatch for {}",
                    entry.file
                )));
            }

            let mut source = Vec::with_capacity(begin.len() + bytes.len() + end.len() + 3);
            append_segment(&mut source, &begin);
            append_segment(&mut source, &bytes);
            append_segment(&mut source, &end);
            Ok(VerifiedPatch { entry, source })
        })
        .collect()
}

fn redact_password(details: String, password: &str) -> String {
    if password.is_empty() {
        details
    } else {
        details.replace(password, "[redacted]")
    }
}

fn redact_diagnostic_prefix(bytes: &[u8], password: &[u8]) -> (Vec<u8>, bool) {
    let visible_end = bytes.len().min(DIAGNOSTIC_OUTPUT_LIMIT);
    let mut sanitized = Vec::with_capacity(visible_end);
    let mut offset = 0;
    let mut truncated = false;
    while offset < visible_end && sanitized.len() < DIAGNOSTIC_OUTPUT_LIMIT {
        if !password.is_empty() && bytes[offset..].starts_with(password) {
            let replacement = b"[redacted]";
            let remaining = DIAGNOSTIC_OUTPUT_LIMIT - sanitized.len();
            sanitized.extend_from_slice(&replacement[..replacement.len().min(remaining)]);
            truncated |= replacement.len() > remaining;
            offset += password.len();
        } else {
            sanitized.push(bytes[offset]);
            offset += 1;
        }
    }
    truncated |= offset < visible_end;
    (sanitized, truncated)
}

async fn drain_output(
    mut output: impl AsyncRead + Unpin,
    password: Arc<[u8]>,
) -> std::io::Result<Vec<u8>> {
    let retention_limit = DIAGNOSTIC_OUTPUT_LIMIT.saturating_add(password.len().saturating_sub(1));
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = output.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        truncated |= bytes.len().saturating_add(read) > DIAGNOSTIC_OUTPUT_LIMIT;
        let remaining = retention_limit.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    let (mut sanitized, sanitization_truncated) = redact_diagnostic_prefix(&bytes, &password);
    if truncated || sanitization_truncated {
        sanitized.extend_from_slice(DIAGNOSTIC_TRUNCATION_MARKER);
    }
    Ok(sanitized)
}

async fn collected_output(
    label: &str,
    stream: &str,
    task: &mut tokio::task::JoinHandle<std::io::Result<Vec<u8>>>,
) -> Result<Vec<u8>, PostgresError> {
    task.await
        .map_err(|error| {
            PostgresError::MigrationFailed(format!(
                "{label} failed while collecting {stream}: {error}"
            ))
        })?
        .map_err(|error| {
            PostgresError::MigrationFailed(format!(
                "{label} failed while reading {stream}: {error}"
            ))
        })
}

async fn collected_outputs(
    label: &str,
    mut stdout_task: tokio::task::JoinHandle<std::io::Result<Vec<u8>>>,
    mut stderr_task: tokio::task::JoinHandle<std::io::Result<Vec<u8>>>,
) -> Result<(Vec<u8>, Vec<u8>), PostgresError> {
    let completion = tokio::time::timeout(DRAIN_COMPLETION_TIMEOUT, async {
        let (stdout, stderr) = tokio::join!(
            collected_output(label, "stdout", &mut stdout_task),
            collected_output(label, "stderr", &mut stderr_task),
        );
        Ok::<_, PostgresError>((stdout?, stderr?))
    })
    .await;
    match completion {
        Ok(output) => output,
        Err(_) => {
            stdout_task.abort();
            stderr_task.abort();
            let _ = tokio::time::timeout(DRAIN_COMPLETION_TIMEOUT, async {
                let _ = tokio::join!(&mut stdout_task, &mut stderr_task);
            })
            .await;
            Err(PostgresError::MigrationFailed(format!(
                "{label} timed out after {}s while collecting stdout/stderr after child exit",
                DRAIN_COMPLETION_TIMEOUT.as_secs()
            )))
        }
    }
}

struct ReapOutcome {
    status: std::process::ExitStatus,
    kill_error: Option<std::io::Error>,
}

async fn kill_and_reap(
    child: &mut tokio::process::Child,
    label: &str,
) -> Result<ReapOutcome, PostgresError> {
    if let Ok(Some(status)) = child.try_wait() {
        return Ok(ReapOutcome {
            status,
            kill_error: None,
        });
    }
    let kill_error = match child.start_kill() {
        Ok(()) => None,
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => None,
        Err(error) => Some(error),
    };
    match tokio::time::timeout(CHILD_REAP_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => Ok(ReapOutcome { status, kill_error }),
        Ok(Err(error)) => {
            let _ = child.start_kill();
            Err(PostgresError::MigrationFailed(format!(
                "{label} failed to reap after a stdin error: {error}"
            )))
        }
        Err(_) => {
            let _ = child.start_kill();
            let kill_details = kill_error
                .map(|error| format!("; initial termination failed: {error}"))
                .unwrap_or_default();
            Err(PostgresError::MigrationFailed(format!(
                "{label} timed out after {}s while reaping after a stdin error{kill_details}",
                CHILD_REAP_TIMEOUT.as_secs()
            )))
        }
    }
}

fn process_failure(
    label: &str,
    output: &Output,
    password: &str,
    context: Option<String>,
) -> PostgresError {
    let mut details = command_output_details(label, output);
    if let Some(context) = context {
        details.push_str("\ncontext: ");
        details.push_str(&context);
    }
    let details = redact_password(details, password);
    log::error!("{} failed: {}", label, details);
    PostgresError::MigrationFailed(format!("{label} failed: {details}"))
}

enum PatchCompletion {
    Exited {
        status: std::process::ExitStatus,
        write_result: Result<(), (&'static str, std::io::Error)>,
    },
    StdinFailed {
        reap: ReapOutcome,
        action: &'static str,
        error: std::io::Error,
    },
    CleanupFailed(PostgresError),
}

async fn apply_patch(
    psql_path: &Path,
    connection: &PsqlConnection,
    patch: VerifiedPatch,
) -> Result<(), PostgresError> {
    let label = format!(
        "psql apply patch {}.{} {}",
        patch.entry.generation, patch.entry.version, patch.entry.name
    );
    let port = connection.port.to_string();
    let mut command = tokio::process::Command::new(psql_path);
    command.args([
        "-h",
        &connection.host,
        "-p",
        &port,
        "-U",
        &connection.user,
        "-d",
        &connection.database,
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
    ]);
    command
        .arg(format!("--set=patch_generation={}", patch.entry.generation))
        .arg(format!("--set=patch_version={}", patch.entry.version))
        .arg(format!("--set=patch_name={}", patch.entry.name))
        .arg(format!("--set=patch_checksum={}", patch.entry.checksum))
        .env("PGPASSWORD", &connection.password)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(pgsql_bin) = psql_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        command
            .env(
                "PATH",
                format!(
                    "{}{}{}",
                    pgsql_bin.to_string_lossy(),
                    PATH_SEP,
                    current_path
                ),
            )
            .current_dir(pgsql_bin);
    }

    #[cfg(windows)]
    command.creation_flags(super::CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| {
        PostgresError::MigrationFailed(format!("{label} failed to start: {error}"))
    })?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        PostgresError::MigrationFailed(format!("{label} failed: stdin was unavailable"))
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        PostgresError::MigrationFailed(format!("{label} failed: stdout was unavailable"))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        PostgresError::MigrationFailed(format!("{label} failed: stderr was unavailable"))
    })?;
    let password = Arc::<[u8]>::from(connection.password.as_bytes());
    let stdout_task = tokio::spawn(drain_output(stdout, Arc::clone(&password)));
    let stderr_task = tokio::spawn(drain_output(stderr, password));
    let write_stdin = async move {
        stdin
            .write_all(&patch.source)
            .await
            .map_err(|error| ("write", error))?;
        stdin.shutdown().await.map_err(|error| ("close", error))
    };
    tokio::pin!(write_stdin);
    let completion = tokio::select! {
        biased;
        status = child.wait() => {
            match status {
                Ok(status) => PatchCompletion::Exited {
                    status,
                    write_result: write_stdin.await,
                },
                Err(wait_error) => {
                    let reap = match kill_and_reap(&mut child, &label).await {
                        Ok(reap) => reap,
                        Err(error) => {
                            stdout_task.abort();
                            stderr_task.abort();
                            return Err(error);
                        }
                    };
                    let kill_details = reap
                        .kill_error
                        .map(|error| format!("; termination also failed: {error}"))
                        .unwrap_or_default();
                    PatchCompletion::CleanupFailed(
                        PostgresError::MigrationFailed(format!(
                            "{label} failed while waiting: {wait_error}{kill_details}"
                        )),
                    )
                }
            }
        }
        write_result = &mut write_stdin => {
            match write_result {
                Ok(()) => {
                    match child.wait().await {
                        Ok(status) => PatchCompletion::Exited {
                            status,
                            write_result: Ok(()),
                        },
                        Err(wait_error) => {
                            let reap = match kill_and_reap(&mut child, &label).await {
                                Ok(reap) => reap,
                                Err(error) => {
                                    stdout_task.abort();
                                    stderr_task.abort();
                                    return Err(error);
                                }
                            };
                            let kill_details = reap
                                .kill_error
                                .map(|error| format!("; termination also failed: {error}"))
                                .unwrap_or_default();
                            PatchCompletion::CleanupFailed(
                                PostgresError::MigrationFailed(format!(
                                    "{label} failed while waiting: {wait_error}{kill_details}"
                                )),
                            )
                        }
                    }
                }
                Err((action, error)) => {
                    let child_status = match child.try_wait() {
                        Ok(None) => {
                            match tokio::time::timeout(
                                CHILD_EXIT_DIAGNOSTIC_GRACE,
                                child.wait(),
                            )
                            .await
                            {
                                Ok(status) => status.map(Some),
                                Err(_) => Ok(None),
                            }
                        }
                        status => status,
                    };
                    match child_status {
                        Ok(Some(status)) => PatchCompletion::Exited {
                            status,
                            write_result: Err((action, error)),
                        },
                        Ok(None) => {
                            let reap = match kill_and_reap(&mut child, &label).await {
                                Ok(reap) => reap,
                                Err(error) => {
                                    stdout_task.abort();
                                    stderr_task.abort();
                                    return Err(error);
                                }
                            };
                            PatchCompletion::StdinFailed {
                                reap,
                                action,
                                error,
                            }
                        }
                        Err(wait_error) => {
                            let reap = match kill_and_reap(&mut child, &label).await {
                                Ok(reap) => reap,
                                Err(error) => {
                                    stdout_task.abort();
                                    stderr_task.abort();
                                    return Err(error);
                                }
                            };
                            let kill_details = reap
                                .kill_error
                                .map(|error| format!("; termination also failed: {error}"))
                                .unwrap_or_default();
                            PatchCompletion::CleanupFailed(PostgresError::MigrationFailed(format!(
                                "{label} failed while checking child status after a stdin error: {wait_error}{kill_details}"
                            )))
                        }
                    }
                }
            }
        }
    };
    let (stdout, stderr) = collected_outputs(&label, stdout_task, stderr_task).await?;
    match completion {
        PatchCompletion::Exited {
            status,
            write_result,
        } => {
            let output = Output {
                status,
                stdout,
                stderr,
            };
            if !output.status.success() {
                return Err(process_failure(&label, &output, &connection.password, None));
            }
            if let Err((action, error)) = write_result {
                return Err(PostgresError::MigrationFailed(format!(
                    "{label} failed to {action} stdin: {error}"
                )));
            }
            Ok(())
        }
        PatchCompletion::StdinFailed {
            reap,
            action,
            error,
        } => {
            let output = Output {
                status: reap.status,
                stdout,
                stderr,
            };
            let kill_details = reap
                .kill_error
                .map(|kill_error| format!("; child termination also failed: {kill_error}"))
                .unwrap_or_default();
            let stdin_failure = format!("{label} failed to {action} stdin: {error}{kill_details}");
            if !output.status.success() {
                return Err(process_failure(
                    &label,
                    &output,
                    &connection.password,
                    Some(stdin_failure),
                ));
            }
            Err(PostgresError::MigrationFailed(stdin_failure))
        }
        PatchCompletion::CleanupFailed(error) => Err(error),
    }
}

pub(super) async fn apply_catalog(
    psql_path: &Path,
    connection: &PsqlConnection,
    patch_dir: &Path,
) -> Result<(), PostgresError> {
    let patches = load_catalog(patch_dir)?;
    if psql_path.components().count() > 1 && !psql_path.is_file() {
        return Err(PostgresError::BinaryNotFound(
            psql_path.to_string_lossy().to_string(),
        ));
    }

    for patch in patches {
        apply_patch(psql_path, connection, patch).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_catalog, parse_manifest, read_catalog_file, read_opened_catalog_file,
        PatchManifestEntry, PsqlConnection,
    };
    use std::fs::File;
    use std::path::{Path, PathBuf};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    const MANIFEST: &str = "# generation\tversion\tname\tchecksum\tfile\n\
1\t2\tgoogle-subject\tsha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650\t0002_google_subject.sql\n\
1\t3\tpayment-idempotency\tsha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36\t0003_payment_idempotency.sql\n\
1\t4\tbooking-status-vocabulary\tsha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7\t0004_booking_status_vocabulary.sql\n\
1\t5\tbooking-status-enforcement\tsha256:a9ea019977a421f15bf923e074384ecaf88e458af85b3f15c6bc6b3aa66a08e3\t0005_booking_status_enforcement.sql\n\
1\t6\tguest-role-isolation\tsha256:b1a5687a8b94c1abdc97c340ab0c6996ddd41d5072867f7476c81099e3b1f4a4\t0006_guest_role_isolation.sql\n";

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestPatchDir(PathBuf);

    impl TestPatchDir {
        fn new() -> Self {
            let suffix = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "hotel-desktop-patches-{}-{suffix}",
                std::process::id()
            ));
            std::fs::create_dir(&path).expect("temporary patch directory must be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write(&self, file: &str, bytes: &[u8]) {
            std::fs::write(self.0.join(file), bytes).expect("test patch file must be written");
        }
    }

    impl Drop for TestPatchDir {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).expect("temporary patch directory must be removed");
        }
    }

    fn test_connection() -> PsqlConnection {
        PsqlConnection::new("localhost", 5432, "hotel", "hotel", "test-password")
    }

    fn manifest_with(overrides: &[(&str, &str)]) -> String {
        let mut manifest = MANIFEST.to_string();
        for (from, to) in overrides {
            manifest = manifest.replacen(from, to, 1);
        }
        manifest
    }

    fn committed_patch_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../hotel-app-be/database/postgres/patches")
    }

    /// Copies the controls plus every patch the committed manifest lists.
    ///
    /// Derived from the manifest rather than hardcoded: a hardcoded list
    /// silently stops copying the newest patch the moment one is added, and the
    /// resulting failure surfaces as an unrelated assertion about some earlier
    /// patch's diagnostics rather than as "the catalog is incomplete".
    fn copy_committed_catalog(destination: &TestPatchDir) {
        let mut files = vec![
            "manifest.tsv".to_string(),
            "_begin.sql".to_string(),
            "_end.sql".to_string(),
        ];
        files.extend(
            committed_manifest_entries()
                .into_iter()
                .map(|(_, _, _, file)| file),
        );
        for file in files {
            let bytes = std::fs::read(committed_patch_dir().join(&file))
                .expect("committed patch catalog must be readable");
            destination.write(&file, &bytes);
        }
    }

    /// The committed manifest's `(version, name, checksum, file)` rows, in order.
    fn committed_manifest_entries() -> Vec<(i32, String, String, String)> {
        let manifest = std::fs::read_to_string(committed_patch_dir().join("manifest.tsv"))
            .expect("committed manifest must be readable");
        manifest
            .lines()
            .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
            .map(|line| {
                let fields: Vec<&str> = line.split('\t').collect();
                assert_eq!(
                    fields.len(),
                    5,
                    "manifest row must have five fields: {line}"
                );
                (
                    fields[1]
                        .parse()
                        .expect("manifest version must be an integer"),
                    fields[2].to_string(),
                    fields[3].to_string(),
                    fields[4].to_string(),
                )
            })
            .collect()
    }

    fn add_future_patch(directory: &TestPatchDir, file: &str, name: &str, bytes: &[u8]) {
        let checksum = format!(
            "sha256:{}",
            hex::encode(<sha2::Sha256 as sha2::Digest>::digest(bytes))
        );
        directory.write(file, bytes);
        let mut manifest = std::fs::read_to_string(directory.path().join("manifest.tsv"))
            .expect("manifest must be readable");
        // The next contiguous version after whatever the committed catalog ends
        // on, so adding a real patch cannot turn this fixture into a duplicate.
        let next_version = committed_manifest_entries()
            .last()
            .map(|(version, _, _, _)| version + 1)
            .expect("committed manifest must list at least one patch");
        manifest.push_str(&format!("1\t{next_version}\t{name}\t{checksum}\t{file}\n"));
        directory.write("manifest.tsv", manifest.as_bytes());
    }

    fn test_patch(source: Vec<u8>) -> super::VerifiedPatch {
        super::VerifiedPatch {
            entry: PatchManifestEntry {
                generation: 1,
                version: 5,
                name: "test-patch".to_string(),
                checksum: "sha256:test-only".to_string(),
                file: "0005_test_patch.sql".to_string(),
            },
            source,
        }
    }

    fn live_connection(database_env: &str) -> Option<(PathBuf, PsqlConnection)> {
        let database = std::env::var(database_env).ok()?;
        let psql_path = std::env::var_os("DESKTOP_TEST_PSQL")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("psql"));
        let connection = PsqlConnection {
            host: std::env::var("DESKTOP_TEST_PGHOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("DESKTOP_TEST_PGPORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(5432),
            user: std::env::var("DESKTOP_TEST_PGUSER").unwrap_or_else(|_| "postgres".to_string()),
            database,
            password: std::env::var("DESKTOP_TEST_PGPASSWORD").unwrap_or_default(),
        };
        Some((psql_path, connection))
    }

    fn live_patch_dir() -> PathBuf {
        std::env::var_os("DESKTOP_TEST_PATCH_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(committed_patch_dir)
    }

    async fn scalar(psql_path: &Path, connection: &PsqlConnection, sql: &str) -> String {
        let output = tokio::process::Command::new(psql_path)
            .args([
                "-h",
                &connection.host,
                "-p",
                &connection.port.to_string(),
                "-U",
                &connection.user,
                "-d",
                &connection.database,
                "-tAc",
                sql,
            ])
            .env("PGPASSWORD", &connection.password)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .expect("psql catalog query must run");
        assert!(
            output.status.success(),
            "psql catalog query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[cfg(unix)]
    fn fake_psql(directory: &TestPatchDir, script: &str) -> PathBuf {
        let path = directory.path().join("psql");
        directory.write("psql", script.as_bytes());
        let mut permissions = std::fs::metadata(&path)
            .expect("fake psql metadata must be readable")
            .permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&path, permissions).expect("fake psql must be made executable");
        path
    }

    #[test]
    fn parses_the_exact_committed_catalog_prefix() {
        let entries = parse_manifest(MANIFEST).expect("committed manifest must parse");

        assert_eq!(
            entries,
            vec![
                PatchManifestEntry {
                    generation: 1,
                    version: 2,
                    name: "google-subject".to_string(),
                    checksum:
                        "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650"
                            .to_string(),
                    file: "0002_google_subject.sql".to_string(),
                },
                PatchManifestEntry {
                    generation: 1,
                    version: 3,
                    name: "payment-idempotency".to_string(),
                    checksum:
                        "sha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36"
                            .to_string(),
                    file: "0003_payment_idempotency.sql".to_string(),
                },
                PatchManifestEntry {
                    generation: 1,
                    version: 4,
                    name: "booking-status-vocabulary".to_string(),
                    checksum:
                        "sha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7"
                            .to_string(),
                    file: "0004_booking_status_vocabulary.sql".to_string(),
                },
                PatchManifestEntry {
                    generation: 1,
                    version: 5,
                    name: "booking-status-enforcement".to_string(),
                    checksum:
                        "sha256:a9ea019977a421f15bf923e074384ecaf88e458af85b3f15c6bc6b3aa66a08e3"
                            .to_string(),
                    file: "0005_booking_status_enforcement.sql".to_string(),
                },
                PatchManifestEntry {
                    generation: 1,
                    version: 6,
                    name: "guest-role-isolation".to_string(),
                    checksum:
                        "sha256:b1a5687a8b94c1abdc97c340ab0c6996ddd41d5072867f7476c81099e3b1f4a4"
                            .to_string(),
                    file: "0006_guest_role_isolation.sql".to_string(),
                },
            ]
        );
    }

    /// MANIFEST is a literal mirror of the committed catalog, so it can drift
    /// from it silently. Every parser test above is only meaningful while the
    /// two are the same bytes.
    #[test]
    fn manifest_fixture_mirrors_the_committed_catalog() {
        let committed = std::fs::read_to_string(committed_patch_dir().join("manifest.tsv"))
            .expect("committed manifest must be readable");
        assert_eq!(
            MANIFEST, committed,
            "the MANIFEST test fixture must be updated whenever the committed catalog changes"
        );
    }

    #[test]
    fn accepts_contiguous_future_v1_patches() {
        // One past whatever the committed catalog ends on, so this stays a
        // future patch rather than colliding with a real one.
        let next_version = committed_manifest_entries()
            .last()
            .map(|(version, _, _, _)| version + 1)
            .expect("committed manifest must list at least one patch");
        let manifest = format!(
            "{MANIFEST}1\t{next_version}\tfuture-patch\tsha256:{}\t{next_version:04}_future_patch.sql\n",
            "0".repeat(64)
        );

        assert_eq!(
            parse_manifest(&manifest)
                .expect("future contiguous V1 patch must parse")
                .last()
                .map(|entry| entry.version),
            Some(next_version)
        );
    }

    #[test]
    fn rejects_a_changed_committed_catalog_prefix() {
        for (from, to) in [
            ("google-subject", "changed-name"),
            ("0002_google_subject.sql", "0002_changed.sql"),
            (
                "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650",
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            ),
        ] {
            let error = parse_manifest(&manifest_with(&[(from, to)]))
                .expect_err("the committed prefix must remain exact");
            assert!(error.to_string().contains("committed V1 patch"));
        }
    }

    #[test]
    fn rejects_unsupported_generations_and_wrong_starting_version() {
        for (from, to, expected) in [
            ("1\t2\tgoogle-subject", "2\t2\tgoogle-subject", "generation"),
            (
                "1\t2\tgoogle-subject",
                "1\t1\tgoogle-subject",
                "first patch",
            ),
        ] {
            let error = parse_manifest(&manifest_with(&[(from, to)]))
                .expect_err("unsupported catalog coordinates must be rejected");
            assert!(error.to_string().contains(expected));
        }
    }

    #[test]
    fn rejects_malformed_manifest_field_count() {
        let error = parse_manifest(&manifest_with(&[(
            "\t0002_google_subject.sql",
            "\textra\t0002_google_subject.sql",
        )]))
        .expect_err("six fields must be rejected");

        assert!(error.to_string().contains("exactly five"));
    }

    #[test]
    fn rejects_empty_comment_only_and_whitespace_prefixed_comment_catalogs() {
        for manifest in ["", "# comment only\n"] {
            let error = parse_manifest(manifest).expect_err("an empty catalog must be rejected");
            assert!(error.to_string().contains("committed V1 patch"));
        }

        let error = parse_manifest("  # not a manifest comment\n")
            .expect_err("comments must begin in the first column");
        assert!(error.to_string().contains("exactly five"));
    }

    #[test]
    fn rejects_empty_and_unicode_manifest_fields() {
        for (manifest, expected) in [
            (manifest_with(&[("google-subject", "")]), "invalid name"),
            (
                manifest_with(&[("google-subject", "gøøgle-subject")]),
                "invalid name",
            ),
        ] {
            let error = parse_manifest(&manifest).expect_err("invalid fields must be rejected");
            assert!(error.to_string().contains(expected));
        }
    }

    #[test]
    fn rejects_duplicate_or_non_increasing_versions() {
        for version in ["2", "1"] {
            let manifest = manifest_with(&[(
                "1\t3\tpayment-idempotency",
                &format!("1\t{version}\tpayment-idempotency"),
            )]);
            let error = parse_manifest(&manifest)
                .expect_err("duplicate or non-increasing version must be rejected");
            assert!(error.to_string().contains("non-increasing"));
        }
    }

    #[test]
    fn rejects_non_contiguous_versions() {
        let error = parse_manifest(&manifest_with(&[(
            "1\t3\tpayment-idempotency",
            "1\t4\tpayment-idempotency",
        )]))
        .expect_err("a version gap must be rejected");

        assert!(error.to_string().contains("contiguous"));
    }

    #[test]
    fn rejects_patch_paths_outside_the_catalog_directory() {
        let error = parse_manifest(&manifest_with(&[("0002_google_subject.sql", "../bad.sql")]))
            .expect_err("path traversal must be rejected");

        assert!(error.to_string().contains("file"));
    }

    #[test]
    fn rejects_uppercase_or_wrong_length_checksums() {
        for checksum in [
            format!("sha256:{}", "A".repeat(64)),
            format!("sha256:{}", "a".repeat(63)),
        ] {
            let manifest = manifest_with(&[(
                "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650",
                &checksum,
            )]);
            let error = parse_manifest(&manifest).expect_err("invalid checksum must be rejected");
            assert!(error.to_string().contains("checksum"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_direct_catalog_symlinks() {
        let patch_dir = TestPatchDir::new();
        patch_dir.write("target.sql", b"SELECT 1;\n");
        std::os::unix::fs::symlink(
            patch_dir.path().join("target.sql"),
            patch_dir.path().join("linked.sql"),
        )
        .expect("test symlink must be created");

        let error = read_catalog_file(patch_dir.path(), "linked.sql")
            .expect_err("direct catalog symlink must be rejected");

        assert!(error.to_string().contains("linked.sql is unavailable"));
    }

    #[test]
    fn rejects_a_catalog_path_replaced_after_its_handle_is_opened() {
        let patch_dir = TestPatchDir::new();
        let path = patch_dir.path().join("patch.sql");
        patch_dir.write("patch.sql", b"approved bytes\n");
        let opened = File::open(&path).expect("approved catalog file must open");
        std::fs::rename(&path, patch_dir.path().join("original.sql"))
            .expect("approved path must be movable");
        patch_dir.write("patch.sql", b"replacement bytes\n");

        let error = read_opened_catalog_file(opened, &path, "patch.sql")
            .expect_err("replacement must be detected before reading the handle");

        assert!(error
            .to_string()
            .contains("patch.sql changed while being read"));
    }

    #[tokio::test]
    async fn rejects_missing_catalog_files_before_starting_psql() {
        for missing_file in [
            "_begin.sql",
            "_end.sql",
            "0004_booking_status_vocabulary.sql",
            "0005_booking_status_enforcement.sql",
        ] {
            let patch_dir = TestPatchDir::new();
            copy_committed_catalog(&patch_dir);
            std::fs::remove_file(patch_dir.path().join(missing_file))
                .expect("test catalog file must be removable");

            let error = apply_catalog(
                Path::new("definitely-missing-psql"),
                &test_connection(),
                patch_dir.path(),
            )
            .await
            .expect_err("missing catalog file must fail validation");

            assert!(error.to_string().contains(missing_file));
            assert!(!error.to_string().contains("binary not found"));
        }
    }

    #[tokio::test]
    async fn rejects_patch_byte_mismatches_before_starting_psql() {
        let patch_dir = TestPatchDir::new();
        patch_dir.write("manifest.tsv", MANIFEST.as_bytes());
        patch_dir.write("_begin.sql", b"BEGIN;\n");
        patch_dir.write("_end.sql", b"COMMIT;\n");
        for (_, _, _, file) in committed_manifest_entries() {
            patch_dir.write(&file, b"wrong bytes\n");
        }

        let error = apply_catalog(
            Path::new("definitely-missing-psql"),
            &test_connection(),
            patch_dir.path(),
        )
        .await
        .expect_err("byte mismatch must fail validation");

        assert!(error.to_string().contains("checksum mismatch"));
        assert!(!error.to_string().contains("binary not found"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn validates_the_complete_catalog_before_starting_psql() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        patch_dir.write(
            "0004_booking_status_vocabulary.sql",
            b"corrupted final patch\n",
        );
        let capture_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &capture_dir,
            "#!/bin/sh\nprintf started > \"$CAPTURE_DIR/started\"\ncat >/dev/null\n",
        );
        let mut connection = test_connection();
        connection.password = "catalog-test-password".to_string();

        let error = apply_catalog(&psql_path, &connection, patch_dir.path())
            .await
            .expect_err("a corrupt final patch must fail before psql starts");

        assert!(error
            .to_string()
            .contains("checksum mismatch for 0004_booking_status_vocabulary.sql"));
        assert!(!capture_dir.path().join("started").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn streams_each_verified_patch_once_with_metadata_and_password_env() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        let capture_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &capture_dir,
            "#!/bin/sh\nset -eu\ncount_file=\"$CAPTURE_DIR/count\"\ncount=0\nif [ -f \"$count_file\" ]; then count=$(cat \"$count_file\"); fi\ncount=$((count + 1))\nprintf '%s' \"$count\" > \"$count_file\"\nprintf '%s\\n' \"$@\" > \"$CAPTURE_DIR/args-$count\"\nprintf '%s' \"$PGPASSWORD\" > \"$CAPTURE_DIR/password-$count\"\ncat > \"$CAPTURE_DIR/stdin-$count\"\nif [ \"$count\" -eq 1 ]; then printf 'changed after validation\\n' > \"$MUTATE_PATCH\"; fi\n",
        );
        let password = "only-in-pgpassword";
        let connection = PsqlConnection::new("db-host", 5444, "db-user", "db-name", password);
        let begin = std::fs::read(patch_dir.path().join("_begin.sql"))
            .expect("begin control must be readable");
        let end =
            std::fs::read(patch_dir.path().join("_end.sql")).expect("end control must be readable");
        let committed_catalog = committed_manifest_entries();
        let original_patch_bytes: Vec<Vec<u8>> = committed_catalog
            .iter()
            .map(|(_, _, _, file)| {
                std::fs::read(patch_dir.path().join(file)).expect("patch source must be readable")
            })
            .collect();
        std::env::set_var("CAPTURE_DIR", capture_dir.path());
        std::env::set_var(
            "MUTATE_PATCH",
            patch_dir.path().join("0003_payment_idempotency.sql"),
        );

        apply_catalog(&psql_path, &connection, patch_dir.path())
            .await
            .expect("valid catalog must be streamed");

        // One psql invocation per manifest row, in manifest order -- derived so
        // that adding a patch cannot leave this test silently checking a prefix.
        assert_eq!(
            std::fs::read_to_string(capture_dir.path().join("count"))
                .expect("process count must be captured"),
            committed_catalog.len().to_string()
        );
        for (index, (version, name, checksum, _)) in committed_catalog.iter().enumerate() {
            let invocation = index + 1;
            let arguments =
                std::fs::read_to_string(capture_dir.path().join(format!("args-{invocation}")))
                    .expect("arguments must be captured");
            assert!(arguments.lines().any(|argument| argument == "-X"));
            assert!(arguments
                .lines()
                .any(|argument| argument == "ON_ERROR_STOP=1"));
            assert!(arguments.contains("--set=patch_generation=1"));
            assert!(arguments.contains(&format!("--set=patch_version={version}")));
            assert!(arguments.contains(&format!("--set=patch_name={name}")));
            assert!(arguments.contains(&format!("--set=patch_checksum={checksum}")));
            assert!(!arguments.contains(password));
            assert_eq!(
                std::fs::read_to_string(capture_dir.path().join(format!("password-{invocation}")))
                    .expect("password environment must be captured"),
                password
            );

            let mut expected_source = Vec::new();
            super::append_segment(&mut expected_source, &begin);
            super::append_segment(&mut expected_source, &original_patch_bytes[index]);
            super::append_segment(&mut expected_source, &end);
            assert_eq!(
                std::fs::read(capture_dir.path().join(format!("stdin-{invocation}")))
                    .expect("stdin must be captured"),
                expected_source
            );
        }
        std::env::remove_var("CAPTURE_DIR");
        std::env::remove_var("MUTATE_PATCH");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_psql_names_the_patch_and_redacts_the_password() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\ncat >/dev/null\nprintf 'fake failure password=%s\\n' \"$PGPASSWORD\" >&2\nexit 7\n",
        );
        let password = "must-not-leak";
        let connection = PsqlConnection::new("localhost", 5432, "hotel", "hotel", password);

        let error = apply_catalog(&psql_path, &connection, patch_dir.path())
            .await
            .expect_err("nonzero psql exit must be fatal");
        let message = error.to_string();

        assert!(message.contains("patch 1.2 google-subject"));
        assert!(message.contains("[redacted]"));
        assert!(!message.contains(password));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nonzero_child_diagnostics_win_the_stdin_close_race() {
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\nexec 0<&-\nprintf 'SQLSTATE 42P01 child diagnostic\\n' >&2\nsleep 0.025\nexit 7\n",
        );

        for attempt in 0..32 {
            let error = super::apply_patch(
                &psql_path,
                &test_connection(),
                test_patch(vec![b'-'; 4 * 1024 * 1024]),
            )
            .await
            .expect_err("nonzero psql exit must be fatal");
            let message = error.to_string();

            assert!(
                message.contains("SQLSTATE 42P01 child diagnostic"),
                "attempt {attempt} returned the competing stdin error: {message}"
            );
            assert!(message.contains("exited with code Some(7)"));
            assert!(!message.contains("failed to write stdin"));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bounds_and_marks_large_psql_failure_output() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\ncat >/dev/null\nprintf 'password=%s\\n' \"$PGPASSWORD\" >&2\nhead -c 1048576 /dev/zero | tr '\\000' x >&2\nexit 7\n",
        );
        let password = "large-output-secret";
        let connection = PsqlConnection::new("localhost", 5432, "hotel", "hotel", password);

        let error = apply_catalog(&psql_path, &connection, patch_dir.path())
            .await
            .expect_err("large nonzero psql output must be fatal");
        let message = error.to_string();

        assert!(message.contains("patch 1.2 google-subject"));
        assert!(message.contains("[redacted]"));
        assert!(!message.contains(password));
        assert!(message.contains("[diagnostic output truncated after 32768 bytes]"));
        assert!(
            message.len() <= 34 * 1024,
            "failure diagnostics must stay bounded, got {} bytes",
            message.len()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn redacts_a_password_straddling_both_diagnostic_cutoffs() {
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\ncat >/dev/null\nemit_large_secret() { head -c 32763 /dev/zero | tr '\\000' x; printf '%s' \"$PGPASSWORD\"; head -c 1048576 /dev/zero | tr '\\000' y; }\nemit_large_secret\nemit_large_secret >&2\nexit 7\n",
        );
        let password = "ZXQPV-secret-crosses-cutoff";
        let connection = PsqlConnection::new("localhost", 5432, "hotel", "hotel", password);

        let error =
            super::apply_patch(&psql_path, &connection, test_patch(b"SELECT 1;\n".to_vec()))
                .await
                .expect_err("large nonzero psql output must be fatal");
        let message = error.to_string();

        assert!(!message.contains(password));
        assert!(
            !message.contains("ZXQPV"),
            "a visible password prefix crossed the diagnostic cutoff"
        );
        assert_eq!(
            message
                .matches("[diagnostic output truncated after 32768 bytes]")
                .count(),
            2
        );
        assert!(
            message.len() <= 68 * 1024,
            "two-stream failure diagnostics must stay bounded, got {} bytes",
            message.len()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn streams_stdin_while_draining_large_psql_output() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        let large_patch = vec![b'-'; 4 * 1024 * 1024];
        add_future_patch(
            &patch_dir,
            "0005_large_patch.sql",
            "large-patch",
            &large_patch,
        );
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\nhead -c 4194304 /dev/zero\ncat >/dev/null\n",
        );

        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            apply_catalog(&psql_path, &test_connection(), patch_dir.path()),
        )
        .await
        .expect("psql stdin and output pipes must not deadlock")
        .expect("large valid patch must be streamed successfully");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bounds_drain_completion_when_a_descendant_inherits_the_pipes() {
        let patch_dir = TestPatchDir::new();
        copy_committed_catalog(&patch_dir);
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\n(sleep 30) &\nprintf '%s' \"$!\" > descendant.pid\nexit 0\n",
        );

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            apply_catalog(&psql_path, &test_connection(), patch_dir.path()),
        )
        .await;

        let pid = std::fs::read_to_string(fake_dir.path().join("descendant.pid"))
            .expect("fake psql descendant PID must be captured");
        let _ = std::process::Command::new("kill")
            .args(["-KILL", pid.trim()])
            .status();
        for _ in 0..100 {
            let alive = std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .expect("descendant liveness probe must run")
                .success();
            if !alive {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let descendant_alive = std::process::Command::new("kill")
            .args(["-0", pid.trim()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("final descendant liveness probe must run")
            .success();
        assert!(!descendant_alive, "fake psql descendant must be cleaned up");

        let error = result
            .expect("inherited output pipes must not hang catalog application")
            .expect_err("inherited output pipes must fail closed");
        let message = error.to_string();
        assert!(message.contains("patch 1.2 google-subject"));
        assert!(message.contains("timed out"));
        assert!(message.contains("stdout/stderr"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kills_and_reaps_psql_immediately_when_stdin_fails() {
        let fake_dir = TestPatchDir::new();
        let psql_path = fake_psql(
            &fake_dir,
            "#!/bin/sh\nexec 0<&-\nprintf '%s' \"$$\" > child.pid\nexec sleep 30\n",
        );
        let patch = super::VerifiedPatch {
            entry: PatchManifestEntry {
                generation: 1,
                version: 5,
                name: "large-patch".to_string(),
                checksum: "sha256:test-only".to_string(),
                file: "0005_large_patch.sql".to_string(),
            },
            source: vec![b'-'; 4 * 1024 * 1024],
        };

        let error = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            super::apply_patch(&psql_path, &test_connection(), patch),
        )
        .await
        .expect("stdin failure must not wait for a live psql child")
        .expect_err("closed psql stdin must be fatal");
        let message = error.to_string();
        assert!(message.contains("patch 1.5 large-patch"));
        assert!(message.contains("exited with code None"));
        assert!(message.contains("failed to write stdin"));

        let pid = std::fs::read_to_string(fake_dir.path().join("child.pid"))
            .expect("fake psql PID must be captured");
        let status = std::process::Command::new("kill")
            .args(["-0", pid.trim()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("process liveness probe must run");
        assert!(!status.success(), "failed psql child must be reaped");
    }

    #[tokio::test]
    async fn existing_v1_catalog_application_is_idempotent_on_live_postgres() {
        let Some((psql_path, connection)) = live_connection("DESKTOP_TEST_V1_DATABASE") else {
            eprintln!("skipping desktop V1 catalog test; set DESKTOP_TEST_V1_DATABASE to run it");
            return;
        };
        let patch_dir = live_patch_dir();

        apply_catalog(&psql_path, &connection, &patch_dir)
            .await
            .expect("first V1 catalog application must succeed");

        let receipt_index_oid = scalar(
            &psql_path,
            &connection,
            "SELECT indexrelid::text FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'idx_customer_ledger_payments_receipt_unique';",
        )
        .await;

        apply_catalog(&psql_path, &connection, &patch_dir)
            .await
            .expect("second V1 catalog application must succeed");

        assert_eq!(
            scalar(
                &psql_path,
                &connection,
                "SELECT string_agg(version::text || ':' || name || ':' || checksum, E'\\n' ORDER BY version) FROM public.hotel_schema_revisions WHERE generation = 1 AND version BETWEEN 2 AND 5;",
            )
            .await,
            "2:google-subject:sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650\n3:payment-idempotency:sha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36\n4:booking-status-vocabulary:sha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7\n5:booking-status-enforcement:sha256:a9ea019977a421f15bf923e074384ecaf88e458af85b3f15c6bc6b3aa66a08e3"
        );
        assert_eq!(
            scalar(
                &psql_path,
                &connection,
                "SELECT string_agg(table_name || '.' || column_name || '=' || data_type || '(' || character_maximum_length || '),nullable=' || is_nullable, E'\\n' ORDER BY table_name, column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('payments', 'customer_ledger_payments') AND column_name IN ('idempotency_key', 'idempotency_fingerprint');",
            )
            .await,
            "customer_ledger_payments.idempotency_fingerprint=character varying(64),nullable=YES\ncustomer_ledger_payments.idempotency_key=character varying(160),nullable=YES\npayments.idempotency_fingerprint=character varying(64),nullable=YES\npayments.idempotency_key=character varying(160),nullable=YES"
        );
        assert_eq!(
            scalar(
                &psql_path,
                &connection,
                "SELECT indexrelid::text FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'idx_customer_ledger_payments_receipt_unique';",
            )
            .await,
            receipt_index_oid,
            "the second catalog run must not rebuild the receipt index"
        );
    }

    #[tokio::test]
    async fn catalog_application_propagates_empty_database_failures() {
        let Some((psql_path, connection)) = live_connection("DESKTOP_TEST_EMPTY_DATABASE") else {
            eprintln!(
                "skipping desktop empty-database catalog test; set DESKTOP_TEST_EMPTY_DATABASE to run it"
            );
            return;
        };

        let error = apply_catalog(&psql_path, &connection, &live_patch_dir())
            .await
            .expect_err("an empty database must not hide failed V1 patch SQL");
        let message = error.to_string();
        assert!(message.contains("patch 1.2 google-subject"));
        assert!(message.contains("hotel_schema_revisions"));
    }
}
