//! Startup guard: refuse to serve a database that lacks a schema patch this
//! build was compiled against.
//!
//! The patch catalog (`database/postgres/patches/manifest.tsv`) is applied by
//! `apply-patches.sh` (deploy, `make db-patch`) and by the desktop launcher,
//! never by the backend. Nothing used to stop the backend from starting when a
//! catalog run had failed or been skipped: a CRLF checkout that failed every
//! patch checksum and a desktop bundle shipped with an empty manifest both left
//! databases without their patches while the backend kept serving, and the
//! first symptom was a 500 from a query needing a column a missing patch adds.
//! The manifest is compiled in here so `main` can refuse to start and name the
//! missing revisions instead.
//!
//! A required revision is satisfied when a `hotel_schema_revisions` row matches
//! its generation, version, *and* checksum — the same test `_begin.sql` uses to
//! decide a patch has already run. Recorded revisions this build does not know
//! are ignored: a deploy rollback runs the previous release against a database
//! the newer release already patched, and patches are additive by contract.

use std::fmt;

/// The catalog manifest this binary was built with.
const MANIFEST: &str = include_str!("../../database/postgres/patches/manifest.tsv");

/// One patch the compiled-in manifest requires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredRevision {
    pub generation: i32,
    pub version: i32,
    pub name: String,
    pub checksum: String,
}

/// A `hotel_schema_revisions` row as a catalog executor recorded it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedRevision {
    pub generation: i32,
    pub version: i32,
    pub checksum: String,
}

/// Why the database does not satisfy one required revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevisionGap {
    /// No row for this generation and version: the patch never ran.
    Missing(RequiredRevision),
    /// A row exists, but it was applied from a catalog with a different
    /// checksum for this version — which shipped catalogs never do.
    ChecksumMismatch {
        required: RequiredRevision,
        recorded_checksum: String,
    },
}

impl fmt::Display for RevisionGap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(required) => write!(
                f,
                "{}.{} {} (missing)",
                required.generation, required.version, required.name
            ),
            Self::ChecksumMismatch {
                required,
                recorded_checksum,
            } => write!(
                f,
                "{}.{} {} (recorded checksum {} differs from {})",
                required.generation,
                required.version,
                required.name,
                recorded_checksum,
                required.checksum
            ),
        }
    }
}

/// Outcome of comparing the database with the compiled-in catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogCheck {
    /// Every required revision is recorded. `head` is the newest required
    /// `(generation, version)` — `None` for an empty catalog — and
    /// `newer_recorded` counts recorded revisions beyond it, as after a rollback.
    Current {
        head: Option<(i32, i32)>,
        newer_recorded: usize,
    },
    /// Required revisions the database does not satisfy, in manifest order.
    Behind(Vec<RevisionGap>),
}

/// Why the comparison could not be made.
#[derive(Debug)]
pub enum CheckError {
    /// The manifest compiled into this binary does not parse: a broken build.
    Manifest(String),
    /// `hotel_schema_revisions` could not be read.
    Probe(sqlx::Error),
}

impl fmt::Display for CheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Manifest(message) => {
                write!(f, "compiled-in patch manifest is invalid: {message}")
            }
            Self::Probe(error) => write!(f, "cannot read hotel_schema_revisions: {error}"),
        }
    }
}

/// Parse manifest text: `#` comments and blank lines are skipped, and every
/// other line must carry exactly five tab-separated fields —
/// generation, version, name, `sha256:<64 hex>` checksum, file — as
/// `apply-patches.sh` and the desktop executor require. Ordering and
/// contiguity are the executors' rules and are not re-checked here.
pub fn parse_manifest(contents: &str) -> Result<Vec<RequiredRevision>, String> {
    let mut revisions = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        let line_number = index + 1;
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        let [generation, version, name, checksum, _file] = fields.as_slice() else {
            return Err(format!(
                "manifest line {line_number} must have exactly five tab-separated fields"
            ));
        };
        let generation = parse_positive(generation)
            .ok_or_else(|| format!("invalid generation on manifest line {line_number}"))?;
        let version = parse_positive(version)
            .ok_or_else(|| format!("invalid version on manifest line {line_number}"))?;
        if name.is_empty() {
            return Err(format!("invalid name on manifest line {line_number}"));
        }
        let valid_checksum = checksum.strip_prefix("sha256:").is_some_and(|hex| {
            hex.len() == 64 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        });
        if !valid_checksum {
            return Err(format!("invalid checksum on manifest line {line_number}"));
        }
        revisions.push(RequiredRevision {
            generation,
            version,
            name: (*name).to_string(),
            checksum: (*checksum).to_string(),
        });
    }
    Ok(revisions)
}

fn parse_positive(field: &str) -> Option<i32> {
    if field.starts_with('0') || !field.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    field.parse().ok().filter(|value: &i32| *value > 0)
}

/// The revisions this binary was built to require.
pub fn required_revisions() -> Result<Vec<RequiredRevision>, String> {
    parse_manifest(MANIFEST)
}

/// Required revisions that `recorded` does not satisfy, in manifest order.
pub fn find_gaps(required: &[RequiredRevision], recorded: &[RecordedRevision]) -> Vec<RevisionGap> {
    required
        .iter()
        .filter_map(|revision| {
            let row = recorded.iter().find(|row| {
                row.generation == revision.generation && row.version == revision.version
            });
            match row {
                None => Some(RevisionGap::Missing(revision.clone())),
                Some(row) if row.checksum != revision.checksum => {
                    Some(RevisionGap::ChecksumMismatch {
                        required: revision.clone(),
                        recorded_checksum: row.checksum.clone(),
                    })
                }
                Some(_) => None,
            }
        })
        .collect()
}

/// Compare `recorded` with `required` and summarize the result.
pub fn evaluate(required: &[RequiredRevision], recorded: &[RecordedRevision]) -> CatalogCheck {
    let gaps = find_gaps(required, recorded);
    if !gaps.is_empty() {
        return CatalogCheck::Behind(gaps);
    }
    let head = required
        .iter()
        .map(|revision| (revision.generation, revision.version))
        .max();
    let newer_recorded = match head {
        Some(head) => recorded
            .iter()
            .filter(|row| (row.generation, row.version) > head)
            .count(),
        None => 0,
    };
    CatalogCheck::Current {
        head,
        newer_recorded,
    }
}

/// Every revision the database records. Generic over the executor so a test
/// can read inside a transaction it later rolls back.
pub async fn recorded_revisions<'e, E>(executor: E) -> Result<Vec<RecordedRevision>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let rows = sqlx::query_as::<_, (i32, i32, String)>(
        "SELECT generation, version, checksum FROM public.hotel_schema_revisions \
         ORDER BY generation, version",
    )
    .fetch_all(executor)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(generation, version, checksum)| RecordedRevision {
            generation,
            version,
            checksum,
        })
        .collect())
}

/// Compare the database behind `executor` with the compiled-in catalog.
pub async fn check<'e, E>(executor: E) -> Result<CatalogCheck, CheckError>
where
    E: sqlx::PgExecutor<'e>,
{
    let required = required_revisions().map_err(CheckError::Manifest)?;
    let recorded = recorded_revisions(executor)
        .await
        .map_err(CheckError::Probe)?;
    Ok(evaluate(&required, &recorded))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "# generation\tversion\tname\tchecksum\tfile\n";

    fn checksum(fill: char) -> String {
        format!("sha256:{}", fill.to_string().repeat(64))
    }

    fn required(version: i32, name: &str, fill: char) -> RequiredRevision {
        RequiredRevision {
            generation: 1,
            version,
            name: name.to_string(),
            checksum: checksum(fill),
        }
    }

    fn recorded(version: i32, fill: char) -> RecordedRevision {
        RecordedRevision {
            generation: 1,
            version,
            checksum: checksum(fill),
        }
    }

    /// V1 baseline row as `seed.sql` records it; no manifest entry mentions it.
    fn baseline() -> RecordedRevision {
        recorded(1, 'b')
    }

    fn catalog() -> Vec<RequiredRevision> {
        vec![
            required(2, "deposit-forfeited", 'a'),
            required(3, "guest-relations-phase2", 'c'),
            required(4, "consent-locale-zh", 'd'),
        ]
    }

    #[test]
    fn committed_manifest_parses_in_strictly_increasing_order() {
        let revisions = required_revisions().expect("the compiled-in manifest must parse");
        let keys: Vec<(i32, i32)> = revisions
            .iter()
            .map(|revision| (revision.generation, revision.version))
            .collect();
        assert!(
            keys.windows(2).all(|pair| pair[0] < pair[1]),
            "manifest revisions must be strictly increasing: {keys:?}"
        );
    }

    #[test]
    fn parse_skips_comments_and_blank_lines() {
        let manifest = format!(
            "{HEADER}\n1\t2\tdeposit-forfeited\t{}\t0002_deposit_forfeited.sql\n\n",
            checksum('a')
        );
        assert_eq!(
            parse_manifest(&manifest).unwrap(),
            vec![required(2, "deposit-forfeited", 'a')]
        );
    }

    #[test]
    fn parse_accepts_an_empty_catalog() {
        assert_eq!(parse_manifest(HEADER).unwrap(), Vec::new());
    }

    #[test]
    fn parse_rejects_malformed_lines() {
        let good = checksum('a');
        let cases = [
            (format!("1\t2\tname\t{good}\n"), "five tab-separated fields"),
            (
                format!("1\t2\tname\t{good}\tf.sql\textra\n"),
                "five tab-separated fields",
            ),
            (format!("x\t2\tname\t{good}\tf.sql\n"), "invalid generation"),
            (format!("1\t0\tname\t{good}\tf.sql\n"), "invalid version"),
            (format!("1\t02\tname\t{good}\tf.sql\n"), "invalid version"),
            (format!("1\t-2\tname\t{good}\tf.sql\n"), "invalid version"),
            (format!("1\t2\t\t{good}\tf.sql\n"), "invalid name"),
            (
                "1\t2\tname\tsha256:abc\tf.sql\n".to_string(),
                "invalid checksum",
            ),
            (
                format!("1\t2\tname\tmd5:{}\tf.sql\n", "a".repeat(64)),
                "invalid checksum",
            ),
            (
                format!("1\t2\tname\tsha256:{}\tf.sql\n", "A".repeat(64)),
                "invalid checksum",
            ),
        ];
        for (line, expected) in cases {
            let error = parse_manifest(&format!("{HEADER}{line}"))
                .expect_err(&format!("{line:?} must be rejected"));
            assert!(
                error.contains(expected) && error.contains("line 2"),
                "{line:?} gave {error:?}"
            );
        }
    }

    #[test]
    fn database_at_head_is_current() {
        let rows = vec![
            baseline(),
            recorded(2, 'a'),
            recorded(3, 'c'),
            recorded(4, 'd'),
        ];
        assert_eq!(
            evaluate(&catalog(), &rows),
            CatalogCheck::Current {
                head: Some((1, 4)),
                newer_recorded: 0
            }
        );
    }

    #[test]
    fn baseline_only_database_is_missing_every_patch() {
        let CatalogCheck::Behind(gaps) = evaluate(&catalog(), &[baseline()]) else {
            panic!("a baseline-only database must be behind");
        };
        let versions: Vec<i32> = gaps
            .iter()
            .map(|gap| match gap {
                RevisionGap::Missing(revision) => revision.version,
                other => panic!("expected only missing revisions, got {other:?}"),
            })
            .collect();
        assert_eq!(versions, vec![2, 3, 4]);
    }

    #[test]
    fn database_missing_the_newest_patch_is_behind() {
        let rows = vec![baseline(), recorded(2, 'a'), recorded(3, 'c')];
        assert_eq!(
            evaluate(&catalog(), &rows),
            CatalogCheck::Behind(vec![RevisionGap::Missing(required(
                4,
                "consent-locale-zh",
                'd'
            ))])
        );
    }

    #[test]
    fn database_ahead_of_this_build_is_current() {
        // A rollback runs this build against revisions a newer release recorded.
        let rows = vec![
            baseline(),
            recorded(2, 'a'),
            recorded(3, 'c'),
            recorded(4, 'd'),
            recorded(5, 'e'),
            RecordedRevision {
                generation: 2,
                version: 1,
                checksum: checksum('f'),
            },
        ];
        assert_eq!(
            evaluate(&catalog(), &rows),
            CatalogCheck::Current {
                head: Some((1, 4)),
                newer_recorded: 2
            }
        );
    }

    #[test]
    fn a_revision_recorded_from_a_different_catalog_is_a_gap() {
        let rows = vec![
            baseline(),
            recorded(2, 'a'),
            recorded(3, 'e'),
            recorded(4, 'd'),
        ];
        assert_eq!(
            evaluate(&catalog(), &rows),
            CatalogCheck::Behind(vec![RevisionGap::ChecksumMismatch {
                required: required(3, "guest-relations-phase2", 'c'),
                recorded_checksum: checksum('e'),
            }])
        );
    }

    #[test]
    fn empty_catalog_is_satisfied_by_any_database() {
        assert_eq!(
            evaluate(&[], &[baseline()]),
            CatalogCheck::Current {
                head: None,
                newer_recorded: 0
            }
        );
    }

    #[test]
    fn gaps_name_the_revision_and_the_problem() {
        assert_eq!(
            RevisionGap::Missing(required(8, "distributed-state", 'a')).to_string(),
            "1.8 distributed-state (missing)"
        );
        let mismatch = RevisionGap::ChecksumMismatch {
            required: required(3, "guest-relations-phase2", 'c'),
            recorded_checksum: checksum('e'),
        }
        .to_string();
        assert!(mismatch.starts_with("1.3 guest-relations-phase2 (recorded checksum sha256:eee"));
        assert!(mismatch.ends_with(&format!("differs from {})", checksum('c'))));
    }
}
