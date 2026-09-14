//! Regression tests for the streamed `hotel-backup` v3 export.
//!
//! `transfer_tables` introspects `pg_class`/`pg_constraint` and is the first
//! thing both `GET /api/data-transfer/export` and its preview call, so a
//! malformed catalog query fails the whole export with a 500 while every
//! compile-time gate stays green. Runs only with `DATABASE_URL` set.

use hotel_app_be::repositories::data_transfer::DataTransferRepository;
use hotel_app_be::services::data_transfer::{
    TABLE_INSERT_ORDER, export_booking_data, export_booking_data_body, export_columns,
};
use serde_json::Value;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL data-transfer export test because DATABASE_URL is not set"
            );
            return None;
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

/// The raw text of one streamed export — key order checks need the bytes, not
/// a parsed `Value` (a deserialized map cannot prove field order).
async fn streamed_export_text(pool: &PgPool) -> String {
    let body = export_booking_data_body(pool, 0)
        .await
        .expect("streamed export must build");
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .expect("streamed export body must collect");
    String::from_utf8(bytes.to_vec()).expect("export must be UTF-8")
}

/// `exportId`, `exportedAt` and `integrity.completedAt` change on every run;
/// everything else must be identical between two exports of the same data.
/// Normalizing the raw text — not the parsed `Value` — keeps the comparison
/// byte-for-byte, so key and row order are checked too.
fn normalize_volatile_text(document: &str) -> String {
    let mut normalized = document.to_string();
    for key in ["exportId", "exportedAt", "completedAt"] {
        let needle = format!("\"{key}\":\"");
        let mut search_from = 0;
        while let Some(relative) = normalized[search_from..].find(&needle) {
            let start = search_from + relative;
            let value_start = start + needle.len();
            let Some(value_end) = normalized[value_start..]
                .find('"')
                .map(|found| found + value_start)
            else {
                break;
            };
            normalized.replace_range(start..=value_end, &format!("\"{key}\":\"<volatile>\""));
            search_from = start + needle.len() + "<volatile>\"".len();
        }
    }
    normalized
}

/// Recursively assert no JSON object key carries credential material. A
/// `settings:manage` holder can download this file, so no password hash,
/// TOTP seed, or live token may appear anywhere in it — including inside
/// jsonb row payloads.
fn assert_no_secret_keys(value: &Value, path: &str) {
    const SECRET_KEY_PATTERNS: &[&str] = &["password", "totp", "secret", "token", "refresh_token"];
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                let lowered = key.to_lowercase();
                for pattern in SECRET_KEY_PATTERNS {
                    assert!(
                        !lowered.contains(pattern),
                        "export carries credential-looking key '{key}' at {path}"
                    );
                }
                assert_no_secret_keys(nested, &format!("{path}.{key}"));
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                assert_no_secret_keys(item, &format!("{path}[{index}]"));
            }
        }
        _ => {}
    }
}

/// The catalog introspection behind every export must actually execute.
/// `FROM pg_constraint constraint` compiled fine and failed at runtime with
/// `syntax error at or near "constraint"` -- `constraint` is a reserved word.
#[tokio::test]
async fn transfer_tables_introspects_the_live_catalog() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let tables = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");

    let bookings = tables
        .iter()
        .find(|table| table.table.key() == "public.bookings")
        .expect("public.bookings must be transferable");

    assert!(
        bookings.columns.contains("id"),
        "column introspection returned nothing for bookings"
    );
    assert_eq!(bookings.primary_key_columns, vec!["id".to_string()]);
    // Proves the foreign-key query ran: bookings has FKs to rooms and guests.
    assert!(
        bookings.dependencies.contains("public.rooms"),
        "foreign-key introspection lost bookings -> rooms; got {:?}",
        bookings.dependencies
    );

    // The row read itself must survive `row_to_json` over every column type.
    let columns = export_columns(bookings);
    let rows = DataTransferRepository::export_transfer_table(&pool, bookings, &columns)
        .await
        .expect("exporting bookings must succeed");
    let count = DataTransferRepository::count_transfer_table(&pool, bookings)
        .await
        .expect("counting bookings must succeed");
    assert_eq!(rows.len() as i64, count);

    // The guest-portal bearer token must be neither projected nor listed.
    assert!(!columns.iter().any(|column| column == "pre_checkin_token"));
    for row in &rows {
        assert!(
            row.as_object()
                .is_some_and(|object| !object.contains_key("pre_checkin_token")),
            "export must never emit the guest-portal bearer token"
        );
    }
}

/// The streamed body must be exactly the v3 `hotel-backup` document: header
/// fields in spec order, the manifest declaring all transferable entities and
/// every exclusion, alphabetical `tables`, and a truthful `integrity`
/// trailer.
#[tokio::test]
async fn export_emits_the_v3_document() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let text = streamed_export_text(&pool).await;
    let document: Value = serde_json::from_str(&text).expect("export must be valid JSON");

    // --- header ---
    assert_eq!(document["format"], "hotel-backup");
    assert_eq!(document["version"], 3);
    assert_eq!(document["kind"], "business-data");
    let export_id = document["exportId"]
        .as_str()
        .expect("exportId must be a string");
    assert!(
        uuid::Uuid::parse_str(export_id).is_ok(),
        "exportId must be a UUID, got {export_id}"
    );
    assert!(
        chrono::DateTime::parse_from_rfc3339(document["exportedAt"].as_str().unwrap_or_default())
            .is_ok(),
        "exportedAt must be RFC 3339"
    );
    assert_eq!(document["applicationVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(document["source"]["databaseProvider"], "postgresql");
    let environment = document["source"]["environment"]
        .as_str()
        .unwrap_or_default();
    assert!(
        ["development", "staging", "production"].contains(&environment),
        "unexpected environment '{environment}'"
    );

    // Top-level keys must appear in the spec's exact order on the wire.
    let mut cursor = 0;
    for key in [
        "\"format\"",
        "\"version\"",
        "\"kind\"",
        "\"exportId\"",
        "\"exportedAt\"",
        "\"applicationVersion\"",
        "\"source\"",
        "\"manifest\"",
        "\"tables\"",
        "\"integrity\"",
    ] {
        let position = text[cursor..]
            .find(key)
            .map(|found| found + cursor)
            .unwrap_or_else(|| panic!("'{key}' missing or out of order after byte {cursor}"));
        cursor = position + key.len();
    }

    // --- manifest ---
    let entities = document["manifest"]["entities"]
        .as_array()
        .expect("manifest.entities must be an array");
    assert_eq!(
        entities.len(),
        TABLE_INSERT_ORDER.len(),
        "manifest must describe every transferable entity"
    );
    let entity_names: Vec<&str> = entities
        .iter()
        .map(|entity| entity["name"].as_str().unwrap())
        .collect();
    let mut sorted_names = entity_names.clone();
    sorted_names.sort_unstable();
    assert_eq!(
        entity_names, sorted_names,
        "manifest entities must be emitted alphabetically"
    );
    for entity in entities {
        let name = entity["name"].as_str().unwrap_or_default();
        assert!(
            entity["primaryKey"].is_array(),
            "{name}: primaryKey must be an array"
        );
        let columns = entity["columns"]
            .as_array()
            .unwrap_or_else(|| panic!("{name}: columns must be an array"));
        assert!(!columns.is_empty(), "{name}: no exportable columns");
    }
    let bookings = entities
        .iter()
        .find(|entity| entity["name"] == "public.bookings")
        .expect("public.bookings must be a manifest entity");
    let booking_columns: Vec<&str> = bookings["columns"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for credential_column in ["pre_checkin_token", "pre_checkin_token_expires_at"] {
        assert!(
            !booking_columns.contains(&credential_column),
            "manifest must not list {credential_column}"
        );
    }

    let exclusions = document["manifest"]["exclusions"]
        .as_array()
        .expect("manifest.exclusions must be an array");
    assert_eq!(
        exclusions.len(),
        29,
        "every excluded schema table must be declared"
    );
    for exclusion in exclusions {
        assert!(
            !exclusion["name"].as_str().unwrap_or_default().is_empty(),
            "exclusion needs a name"
        );
        assert!(
            !exclusion["reason"].as_str().unwrap_or_default().is_empty(),
            "exclusion {} needs a reason",
            exclusion["name"]
        );
    }

    // --- coverage: nothing is silently omitted. Every table the catalog
    // introspection can see must be declared, either as a transferable entity
    // or as a named exclusion. A future schema table missing from both lists
    // would otherwise drop out of the manifest with no signal.
    // `_`-prefixed names are scratch/non-schema by convention (e.g. a manual
    // `_legacy_*_backfill` left in a dev database) — never part of the schema,
    // so they sit outside the declaration contract.
    let declared: std::collections::HashSet<&str> = entity_names
        .iter()
        .copied()
        .chain(
            exclusions
                .iter()
                .filter_map(|exclusion| exclusion["name"].as_str()),
        )
        .collect();
    let catalog = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");
    let undeclared: Vec<String> = catalog
        .iter()
        .map(|table| table.table.key())
        .filter(|key| !key.rsplit('.').next().is_some_and(|name| name.starts_with('_')))
        .filter(|key| !declared.contains(key.as_str()))
        .collect();
    assert!(
        undeclared.is_empty(),
        "catalog tables missing from both manifest.entities and manifest.exclusions: {undeclared:?}"
    );

    // --- tables: every entity emitted, alphabetical on the wire ---
    let tables = document["tables"]
        .as_object()
        .expect("tables must be an object");
    assert_eq!(
        tables.len(),
        entities.len(),
        "every manifest entity must be emitted"
    );
    for name in &entity_names {
        assert!(tables[*name].is_array(), "tables[{name}] must be an array");
    }
    let tables_start = text.find("\"tables\":{").expect("tables object must exist");
    let mut cursor = tables_start;
    for name in &sorted_names {
        let needle = format!("\"{name}\":[");
        let position = text[cursor..]
            .find(&needle)
            .map(|found| found + cursor)
            .unwrap_or_else(|| panic!("table {name} missing or out of alphabetical order"));
        cursor = position + needle.len();
    }

    // --- integrity: the trailer counts what was actually written ---
    let integrity = &document["integrity"];
    assert_eq!(
        integrity["entities"].as_u64().unwrap(),
        entities.len() as u64
    );
    let entity_rows = integrity["entityRows"]
        .as_object()
        .expect("integrity.entityRows must be an object");
    let counted: u64 = entity_rows
        .values()
        .map(|count| count.as_u64().unwrap())
        .sum();
    let emitted: u64 = tables
        .values()
        .map(|rows| rows.as_array().unwrap().len() as u64)
        .sum();
    assert_eq!(
        integrity["rows"].as_u64().unwrap(),
        emitted,
        "integrity.rows must equal the emitted row total"
    );
    assert_eq!(counted, emitted, "entityRows must sum to rows");
    for (name, rows) in tables {
        assert_eq!(
            entity_rows
                .get(name.as_str())
                .and_then(Value::as_u64)
                .unwrap_or_else(|| panic!("entityRows[{name}] missing")),
            rows.as_array().unwrap().len() as u64,
            "entityRows[{name}] must equal the emitted row count"
        );
    }
    assert!(
        chrono::DateTime::parse_from_rfc3339(integrity["completedAt"].as_str().unwrap_or_default())
            .is_ok(),
        "completedAt must be RFC 3339"
    );

    // The whole document must round-trip through the import side's v3 parse
    // target — writer and reader must never drift apart.
    let parsed: hotel_app_be::models::BackupFile =
        serde_json::from_str(&text).expect("export must deserialize as BackupFile");
    assert_eq!(parsed.format, "hotel-backup");
    assert_eq!(parsed.integrity.rows, emitted);
    assert_eq!(parsed.manifest.entities.len(), entities.len());
}

/// Two exports of an unchanged database must be byte-for-byte identical apart
/// from `exportId`/`exportedAt`/`completedAt` — manifest, table order, and row
/// order are all deterministic.
#[tokio::test]
async fn repeated_exports_differ_only_in_volatile_fields() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let first = streamed_export_text(&pool).await;
    let second = streamed_export_text(&pool).await;
    serde_json::from_str::<Value>(&first).expect("first export must be valid JSON");
    serde_json::from_str::<Value>(&second).expect("second export must be valid JSON");

    assert_eq!(
        normalize_volatile_text(&first),
        normalize_volatile_text(&second),
        "exports must differ only in exportId/exportedAt/completedAt"
    );
}

/// The materialized test path runs the same generator as the streamed HTTP
/// path — they must emit the same document apart from the volatile fields.
#[tokio::test]
async fn streamed_export_matches_materialized_export() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let streamed = streamed_export_text(&pool).await;
    let materialized = export_booking_data(&pool)
        .await
        .expect("materialized export must succeed");

    assert_eq!(
        normalize_volatile_text(&streamed),
        normalize_volatile_text(&materialized)
    );
}

/// A download a `settings:manage` holder can trigger must never carry a
/// password hash, TOTP seed, or live token — the export walks only
/// transferable tables, and `bookings.pre_checkin_token` (the guest-portal
/// bearer credential) is projected out.
#[tokio::test]
async fn export_carries_no_credential_or_token_keys() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let document: Value = serde_json::from_str(&streamed_export_text(&pool).await)
        .expect("export must be valid JSON");
    assert_no_secret_keys(&document, "$");
}
