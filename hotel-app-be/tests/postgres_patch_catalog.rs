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

fn repository_file(path: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("backend directory must have a repository parent")
            .join(path),
    )
    .unwrap_or_else(|error| panic!("repository file {path} must be readable: {error}"))
}

fn active_lines(source: &str) -> Vec<&str> {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
}

fn active_line_position(lines: &[&str], expected: &str) -> usize {
    lines
        .iter()
        .position(|line| *line == expected)
        .unwrap_or_else(|| panic!("active line must exist: {expected}"))
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
fn deployment_static_contracts_reject_commented_commands() {
    let commented_commands = "# backup_existing_database\n  # prepare_database_for_release \"$TAG\"\n# cp catalog-file destination\n";
    assert!(active_lines(commented_commands).is_empty());
}

#[test]
fn deployment_release_bundle_contains_the_complete_verified_patch_catalog() {
    let workflow = repository_file(".github/workflows/deploy.yml");
    let bundle_step = workflow
        .split("      - name: Create checksummed release bundle\n")
        .nth(1)
        .and_then(|source| source.split("      - name: Configure pinned SSH access\n").next())
        .expect("release workflow must define the checksummed bundle step");
    let bundle_lines = active_lines(bundle_step);
    let mut resources = vec![
        "apply-patches.sh".to_owned(),
        "patches/manifest.tsv".to_owned(),
        "patches/_begin.sql".to_owned(),
        "patches/_end.sql".to_owned(),
    ];
    resources.extend(
        manifest_entries()
            .into_iter()
            .map(|entry| format!("patches/{}", entry.file)),
    );

    for resource in resources {
        let source = format!("hotel-app-be/database/postgres/{resource}");
        let bundled = format!("database/{resource}");
        assert!(
            bundle_lines.contains(&format!("cp {source} \\").as_str()),
            "release workflow must actively copy authoritative resource {source}"
        );
        assert!(
            bundle_lines.contains(&format!("\"$bundle_dir/{bundled}\"").as_str()),
            "release workflow must actively install {bundled} into the bundle"
        );
        assert!(
            bundle_lines.contains(&format!("{bundled} \\").as_str()),
            "SHA256SUMS must actively cover bundled resource {bundled}"
        );
    }

    assert!(
        !bundle_lines.iter().any(|line| {
            line.contains("postgres/patches/*")
                || line.contains("postgres/patches/.")
                || line.contains("cp -r hotel-app-be/database/postgres/patches")
        }),
        "release bundling must not admit files outside the manifest and control catalog"
    );
}

#[test]
fn deployment_installs_the_verified_catalog_with_exact_modes() {
    let deploy = repository_file("deploy/deploy.sh");
    let install_function = deploy
        .split("install_release_files() {")
        .nth(1)
        .and_then(|source| source.split("\n}\n").next())
        .expect("deploy script must define install_release_files");
    let deploy_lines = active_lines(&deploy);
    let install_lines = active_lines(install_function);
    let mut patch_files = vec![
        "manifest.tsv".to_owned(),
        "_begin.sql".to_owned(),
        "_end.sql".to_owned(),
    ];
    patch_files.extend(manifest_entries().into_iter().map(|entry| entry.file));

    for payload in std::iter::once("database/apply-patches.sh".to_owned()).chain(
        patch_files
            .iter()
            .map(|file| format!("database/patches/{file}")),
    ) {
        assert!(
            deploy_lines.contains(&payload.as_str()),
            "deploy script must actively require release payload {payload}"
        );
    }
    assert!(
        install_lines
            .contains(&"install -d -m 0755 \"$APP_DIR/database\" \"$APP_DIR/database/patches\"")
    );
    assert!(install_lines.contains(
        &"install -m 0750 \"$RELEASE_DIR/database/apply-patches.sh\" \"$APP_DIR/database/apply-patches.sh\""
    ));
    for file in patch_files {
        assert!(
            install_lines.contains(
                &format!(
                    "install -m 0644 \"$RELEASE_DIR/database/patches/{file}\" \"$APP_DIR/database/patches/{file}\""
                )
                .as_str()
            ),
            "deploy script must install {file} with mode 0644"
        );
    }
    assert!(
        !install_lines
            .iter()
            .any(|line| line.contains("patches/*") || line.contains("patches/.")),
        "deploy installation must not admit files outside the checked catalog"
    );
}

#[test]
fn deployment_prepares_database_without_recreating_existing_service() {
    let deploy = repository_file("deploy/deploy.sh");
    let preparation = deploy
        .split("prepare_database_for_release() {")
        .nth(1)
        .and_then(|source| source.split("\n}\n").next())
        .expect("deploy script must define prepare_database_for_release");
    let preparation_lines = active_lines(preparation);
    assert!(preparation_lines.contains(&"local compose_tag=${1:-$TAG}"));
    assert!(preparation_lines.contains(&"export IMAGE_TAG=$compose_tag"));
    assert!(preparation_lines.contains(&"compose config >/dev/null"));
    assert!(preparation_lines.contains(&"compose up --detach --no-recreate postgres"));
    assert!(preparation_lines.contains(&"wait_for_healthy saliminn-db"));
    assert!(preparation_lines.contains(&"wait_for_database_baseline"));
    assert!(preparation_lines.contains(&"\"$APP_DIR/database/apply-patches.sh\" \\"));
    assert!(preparation_lines.contains(&"--container saliminn-db \\"));
    assert!(preparation_lines.contains(&"--user hotel_admin \\"));
    assert!(preparation_lines.contains(&"--database hotel_management"));
}

#[test]
fn deployment_waits_for_final_tcp_v1_database_before_patching() {
    let deploy = repository_file("deploy/deploy.sh");
    let readiness = deploy
        .split("wait_for_database_baseline() {")
        .nth(1)
        .and_then(|source| source.split("\n}\n").next())
        .expect("deploy script must define bounded final-database readiness");
    let readiness_lines = active_lines(readiness);
    assert!(readiness_lines.contains(&"local deadline=$((SECONDS + 240))"));
    assert!(readiness_lines.iter().any(|line| {
        line.contains("docker exec saliminn-db pg_isready")
            && line.contains("-h 127.0.0.1")
            && line.contains("-U hotel_admin")
            && line.contains("-d hotel_management")
    }));
    assert!(readiness_lines.iter().any(|line| {
        line.contains("FROM public.hotel_schema_revisions")
            && line.contains("generation = 1")
            && line.contains("version = 1")
    }));
    assert!(readiness_lines.contains(&"return 1"));
}

#[test]
fn deployment_backs_up_and_patches_before_application_activation() {
    let deploy = repository_file("deploy/deploy.sh");
    let executable_tail = deploy
        .split("\nensure_host_runtime\n")
        .nth(1)
        .expect("deploy script must have an executable tail");
    let tail_lines = active_lines(executable_tail);
    let previous_tag = active_line_position(
        &tail_lines,
        "read -r previous_tag < \"$CURRENT_TAG_FILE\"",
    );
    let backup = active_line_position(&tail_lines, "backup_existing_database");
    let prepare = active_line_position(&tail_lines, "prepare_database_for_release \"$TAG\"");
    let activate = tail_lines
        .iter()
        .position(|line| {
            line.strip_prefix("if ")
                .and_then(|condition| condition.split(" && ").next())
                == Some("deploy_tag \"$TAG\"")
        })
        .expect("deploy_tag must be the first active release condition");

    assert!(
        previous_tag < backup,
        "previous tag must be read before backup and preparation"
    );
    assert!(
        backup < prepare,
        "database backup must precede patch application"
    );
    assert!(
        prepare < activate,
        "patch application must precede app activation"
    );
}

#[test]
fn deployment_local_database_setup_records_the_patch_catalog() {
    let makefile = repository_file("Makefile");
    let make_lines = active_lines(&makefile);
    assert!(make_lines.contains(&"override DATABASE_URL := $(value DATABASE_URL)"));
    assert!(make_lines.contains(&"export DATABASE_URL"));
    assert!(
        !makefile.contains("$(DATABASE_URL)"),
        "Make recipes must leave DATABASE_URL expansion to the shell environment"
    );
    assert!(make_lines.contains(&"db-setup db-patch db-reset db-pg19-tune db-pg19-tune-rollback db-pg19-benchmark \\"));
    assert!(make_lines.contains(&"db-patch: ## Apply verified V1 compatibility patches (requires DATABASE_URL)"));

    let setup = makefile
        .split("db-setup: ##")
        .nth(1)
        .and_then(|source| source.split("\n\n").next())
        .expect("Makefile must define db-setup");
    let setup_lines = active_lines(setup);
    let baseline = active_line_position(
        &setup_lines,
        "psql \"$$DATABASE_URL\" -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql",
    );
    let seed = active_line_position(
        &setup_lines,
        "psql \"$$DATABASE_URL\" -f hotel-app-be/database/postgres/seed.sql",
    );
    let patches = active_line_position(&setup_lines, "$(MAKE) db-patch");
    assert!(baseline < seed && seed < patches);

    let patch_target = makefile
        .split("db-patch: ##")
        .nth(1)
        .and_then(|source| source.split("\n\n").next())
        .expect("Makefile must define db-patch");
    assert!(active_lines(patch_target)
        .contains(&"hotel-app-be/database/postgres/apply-patches.sh"));
}

#[test]
fn deployment_local_database_url_preserves_literal_dollars() {
    let database_url = "postgresql://hotel:pa$word@localhost/hotel?token=$cash";

    for invocation in ["environment", "command-line"] {
        let temporary_dir = std::env::temp_dir().join(format!(
            "hotel-app-make-database-url-{invocation}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time must be after Unix epoch")
                .as_nanos()
        ));
        let command_dir = temporary_dir.join("bin");
        let runner_dir = temporary_dir.join("hotel-app-be/database/postgres");
        std::fs::create_dir_all(&command_dir).expect("fake command directory must be created");
        std::fs::create_dir_all(&runner_dir).expect("fake runner directory must be created");
        std::fs::write(temporary_dir.join("Makefile"), repository_file("Makefile"))
            .expect("Makefile test copy must be written");

        let fake_psql = command_dir.join("psql");
        std::fs::write(
            &fake_psql,
            "#!/usr/bin/env bash\nprintf 'psql-arg=<%s> env=<%s>\\n' \"$1\" \"$DATABASE_URL\" >> \"$CAPTURE_FILE\"\n",
        )
        .expect("fake psql must be written");
        let fake_runner = runner_dir.join("apply-patches.sh");
        std::fs::write(
            &fake_runner,
            "#!/usr/bin/env bash\nprintf 'runner-env=<%s>\\n' \"$DATABASE_URL\" >> \"$CAPTURE_FILE\"\n",
        )
        .expect("fake patch runner must be written");
        for command in [&fake_psql, &fake_runner] {
            let mut permissions = std::fs::metadata(command)
                .expect("fake command metadata must be readable")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(command, permissions)
                .expect("fake command must be executable");
        }

        let capture_file = temporary_dir.join("capture.txt");
        let path = format!(
            "{}:{}",
            command_dir.display(),
            std::env::var("PATH").expect("PATH must be set")
        );
        let mut make = Command::new("make");
        make.args(["--no-print-directory", "db-setup"])
            .current_dir(&temporary_dir)
            .env("PATH", path)
            .env("CAPTURE_FILE", &capture_file);
        if invocation == "environment" {
            make.env("DATABASE_URL", database_url);
        } else {
            make.env_remove("DATABASE_URL")
                .arg(format!("DATABASE_URL={database_url}"));
        }
        let output = make.output().expect("Make database harness must start");
        let capture = std::fs::read_to_string(&capture_file).unwrap_or_default();
        std::fs::remove_dir_all(&temporary_dir).expect("Make harness must be removed");

        assert!(
            output.status.success(),
            "{invocation} Make invocation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            capture,
            format!(
                "psql-arg=<{database_url}> env=<{database_url}>\npsql-arg=<{database_url}> env=<{database_url}>\nrunner-env=<{database_url}>\n"
            ),
            "{invocation} Make invocation must preserve literal dollar-prefixed URL text"
        );
    }
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
