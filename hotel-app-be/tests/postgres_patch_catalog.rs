use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

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
            .map(|entry| (entry.generation, entry.version, entry.name.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (1, 2, "google-subject"),
            (1, 3, "payment-idempotency"),
            (1, 4, "booking-status-vocabulary")
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
