use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, PartialEq, Eq)]
struct PatchEntry {
    generation: i32,
    version: i32,
    name: String,
    checksum: String,
    file: String,
}

fn postgres_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("database/postgres")
}

fn patch_source(file: &str) -> String {
    std::fs::read_to_string(postgres_dir().join("patches").join(file))
        .expect("patch catalog file must exist")
}

fn manifest_entries() -> Vec<PatchEntry> {
    let manifest = std::fs::read_to_string(postgres_dir().join("patches/manifest.tsv"))
        .expect("patch manifest must exist");
    manifest
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            assert_eq!(
                fields.len(),
                5,
                "manifest row must have five tab-separated fields: {line}"
            );
            PatchEntry {
                generation: fields[0].parse().expect("generation must be an integer"),
                version: fields[1].parse().expect("version must be an integer"),
                name: fields[2].to_owned(),
                checksum: fields[3].to_owned(),
                file: fields[4].to_owned(),
            }
        })
        .collect()
}

#[test]
fn postgres_patch_manifest_is_ordered_complete_and_checksummed() {
    let entries = manifest_entries();
    assert_eq!(
        entries
            .iter()
            .take(3)
            .map(|entry| {
                (
                    entry.generation,
                    entry.version,
                    entry.name.as_str(),
                    entry.checksum.as_str(),
                    entry.file.as_str(),
                )
            })
            .collect::<Vec<_>>(),
        vec![
            (
                1,
                2,
                "google-subject",
                "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650",
                "0002_google_subject.sql",
            ),
            (
                1,
                3,
                "payment-idempotency",
                "sha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36",
                "0003_payment_idempotency.sql",
            ),
            (
                1,
                4,
                "booking-status-vocabulary",
                "sha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7",
                "0004_booking_status_vocabulary.sql",
            ),
        ]
    );
    assert!(entries.iter().all(|entry| entry.generation == 1));
    assert_eq!(entries.first().map(|entry| entry.version), Some(2));
    assert!(
        entries
            .windows(2)
            .all(|pair| pair[1].version == pair[0].version + 1)
    );
    for entry in entries {
        let bytes = std::fs::read(postgres_dir().join("patches").join(&entry.file))
            .expect("manifest-listed patch must exist");
        let actual = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
        assert_eq!(
            actual, entry.checksum,
            "checksum mismatch for {}",
            entry.file
        );
    }
    assert!(postgres_dir().join("patches/_begin.sql").is_file());
    assert!(postgres_dir().join("patches/_end.sql").is_file());
}

#[test]
fn shared_patch_controls_preserve_lock_guard_skip_and_atomic_recording_semantics() {
    let begin = patch_source("_begin.sql");
    assert!(begin.starts_with("\\set ON_ERROR_STOP on\nBEGIN;\n"));
    assert!(begin.contains("CREATE TEMP TABLE hotel_patch_context"));
    assert!(begin.contains(") ON COMMIT DROP;"));
    assert!(
        begin.contains(
            "VALUES (:patch_generation, :patch_version, :'patch_name', :'patch_checksum');"
        )
    );
    assert!(begin.contains("SELECT pg_advisory_xact_lock(8246773601043201);"));
    assert!(
        begin.contains("sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d")
    );
    assert!(begin.contains("WHERE generation = 1 AND version = 1;"));
    assert!(begin.contains("IF baseline_checksum IS DISTINCT FROM expected_v1_checksum THEN"));
    assert!(begin.contains(
        "IF recorded_checksum IS NOT NULL AND recorded_checksum <> context_row.checksum THEN"
    ));
    assert!(begin.contains("RAISE EXCEPTION 'patch %.% checksum mismatch: database %, catalog %'"));
    assert!(begin.contains(
        "SELECT NOT EXISTS (\n    SELECT 1\n    FROM public.hotel_schema_revisions AS revision\n    JOIN hotel_patch_context AS context"
    ));
    assert!(begin.contains(
        "ON revision.generation = context.generation\n     AND revision.version = context.version\n     AND revision.checksum = context.checksum"
    ));
    assert!(begin.contains(") AS hotel_patch_needed\n\\gset\n\n\\if :hotel_patch_needed"));

    let end = patch_source("_end.sql");
    assert!(end.contains(
        "INSERT INTO public.hotel_schema_revisions (generation, version, name, checksum, app_build)"
    ));
    assert!(
        end.contains("SELECT generation, version, name, checksum, NULL\nFROM hotel_patch_context;")
    );
    assert!(end.contains("\\echo applied patch :patch_generation.:patch_version :patch_name"));
    assert!(end.contains(
        "\\else\n\\echo skipped patch :patch_generation.:patch_version :patch_name\n\\endif"
    ));
    assert!(end.ends_with("COMMIT;\n"));
}

#[test]
fn shared_patch_control_files_match_reviewed_bytes() {
    for (file, expected) in [
        (
            "_begin.sql",
            "sha256:fc045984f9241bbf0814538e9a8546be53de6fce839995874e7c22db6d9cd592",
        ),
        (
            "_end.sql",
            "sha256:0380b8661a8e87cb0cf9dbe56f896545acc09fa16058600bb757d81df687c421",
        ),
    ] {
        let bytes = std::fs::read(postgres_dir().join("patches").join(file))
            .expect("shared patch control file must exist");
        let actual = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
        assert_eq!(
            actual, expected,
            "reviewed control bytes changed for {file}"
        );
    }
}

#[test]
fn google_subject_patch_rejects_unbounded_varchar_and_non_index_name_collisions() {
    let patch = patch_source("0002_google_subject.sql");
    assert!(patch.contains("found_length IS DISTINCT FROM 255"));
    assert!(patch.contains("found_relation regclass;"));
    assert!(patch.contains("found_relation := to_regclass('public.uq_users_google_subject');"));
    assert!(patch.contains("found_index := pg_get_indexdef(found_relation);"));
    assert!(patch.contains(
        "found_relation IS NOT NULL AND\n       (found_index IS NULL OR found_index <> expected_index)"
    ));
}

#[test]
fn patch_runner_check_mode_validates_the_committed_catalog() {
    let status = Command::new(postgres_dir().join("apply-patches.sh"))
        .arg("--check")
        .status()
        .expect("patch runner must start");
    assert!(status.success());
}

#[test]
fn patch_runner_check_mode_rejects_corrupted_patch_bytes() {
    let source_dir = postgres_dir().join("patches");
    let temporary_dir = std::env::temp_dir().join(format!(
        "hotel-app-postgres-patches-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time must be after Unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir(&temporary_dir).expect("temporary catalog directory must be created");

    for entry in std::fs::read_dir(&source_dir).expect("patch catalog directory must be readable") {
        let entry = entry.expect("patch catalog entry must be readable");
        std::fs::copy(entry.path(), temporary_dir.join(entry.file_name()))
            .expect("patch catalog entry must be copied");
    }
    let corrupt_file = temporary_dir.join("0004_booking_status_vocabulary.sql");
    let mut bytes = std::fs::read(&corrupt_file).expect("patch bytes must be readable");
    bytes[0] ^= 1;
    std::fs::write(&corrupt_file, bytes).expect("corrupt patch bytes must be written");

    let output = Command::new(postgres_dir().join("apply-patches.sh"))
        .arg("--check")
        .env("PATCH_CATALOG_DIR", &temporary_dir)
        .output()
        .expect("patch runner must start");
    std::fs::remove_dir_all(&temporary_dir).expect("temporary catalog directory must be removed");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("checksum mismatch"));
}

#[test]
fn patch_runner_check_mode_rejects_complete_deployment_options() {
    let output = Command::new(postgres_dir().join("apply-patches.sh"))
        .args(["--check", "--container", "postgres", "--user", "hotel", "--database", "hotel"])
        .output()
        .expect("patch runner must start");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--check cannot be combined"));
}

#[test]
fn patch_runner_check_mode_rejects_incomplete_deployment_options() {
    let output = Command::new(postgres_dir().join("apply-patches.sh"))
        .args(["--check", "--container", "postgres"])
        .output()
        .expect("patch runner must start");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--check cannot be combined"));
}

#[test]
fn patch_runner_executes_the_validated_patch_snapshot() {
    let source_dir = postgres_dir().join("patches");
    let temporary_dir = std::env::temp_dir().join(format!(
        "hotel-app-postgres-snapshot-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time must be after Unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir(&temporary_dir).expect("temporary catalog directory must be created");
    for entry in std::fs::read_dir(&source_dir).expect("patch catalog directory must be readable") {
        let entry = entry.expect("patch catalog entry must be readable");
        std::fs::copy(entry.path(), temporary_dir.join(entry.file_name()))
            .expect("patch catalog entry must be copied");
    }

    let command_dir = temporary_dir.join("bin");
    std::fs::create_dir(&command_dir).expect("temporary command directory must be created");
    let fake_sha256sum = command_dir.join("sha256sum");
    std::fs::write(
        &fake_sha256sum,
        "#!/usr/bin/env bash\nshasum -a 256 \"$@\"\nprintf '%s\\n' '-- source changed after validation' > \"$SNAPSHOT_TARGET\"\n",
    )
    .expect("fake sha256sum must be written");
    let fake_psql = command_dir.join("psql");
    std::fs::write(&fake_psql, "#!/usr/bin/env bash\ncat >> \"$PSQL_CAPTURE\"\n")
        .expect("fake psql must be written");
    for command in [&fake_sha256sum, &fake_psql] {
        let mut permissions = std::fs::metadata(command)
            .expect("fake command metadata must be readable")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(command, permissions).expect("fake command must be executable");
    }

    let capture_file = temporary_dir.join("psql-input.sql");
    let path = format!(
        "{}:{}",
        command_dir.display(),
        std::env::var("PATH").expect("PATH must be set")
    );
    let output = Command::new(postgres_dir().join("apply-patches.sh"))
        .env("PATCH_CATALOG_DIR", &temporary_dir)
        .env("DATABASE_URL", "postgresql://unused")
        .env("PATH", path)
        .env(
            "SNAPSHOT_TARGET",
            temporary_dir.join("0002_google_subject.sql"),
        )
        .env("PSQL_CAPTURE", &capture_file)
        .output()
        .expect("patch runner must start");
    let captured_input = std::fs::read_to_string(&capture_file).expect("fake psql input must exist");
    std::fs::remove_dir_all(&temporary_dir).expect("temporary catalog directory must be removed");

    assert!(output.status.success());
    assert!(
        !captured_input.contains("-- source changed after validation"),
        "the runner must execute the validated snapshot rather than reopening a source path"
    );
}
