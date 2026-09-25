//! Live-PostgreSQL check of `core::schema_catalog`, the startup guard that
//! refuses to serve a database missing a compiled-in schema patch.
//!
//! Plain `sqlx::query_as` compiles against any tuple, so only a real fetch
//! proves the revision query decodes `hotel_schema_revisions` (`integer`
//! columns as `i32`). The verdicts are then driven by rewriting the recorded
//! rows — all inside ONE transaction that is rolled back, so the target
//! database's real revision history is never changed and no other test can
//! observe the intermediate states.
//!
//! Skips when `DATABASE_URL` is unset.

mod postgres_tests {
    use hotel_app_be::core::schema_catalog::{self, CatalogCheck, RevisionGap};
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping schema-catalog test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    async fn insert_revision(
        tx: &mut sqlx::PgConnection,
        generation: i32,
        version: i32,
        name: &str,
        checksum: &str,
    ) {
        sqlx::query(
            "INSERT INTO public.hotel_schema_revisions (generation, version, name, checksum) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(generation)
        .bind(version)
        .bind(name)
        .bind(checksum)
        .execute(tx)
        .await
        .expect("insert revision row");
    }

    #[tokio::test]
    async fn verdict_follows_the_recorded_revisions() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let required =
            schema_catalog::required_revisions().expect("the compiled-in manifest must parse");
        let head = required
            .iter()
            .map(|revision| (revision.generation, revision.version))
            .max();
        let mut tx = pool.begin().await.expect("begin transaction");

        // Whatever this database records, the real rows must decode.
        schema_catalog::recorded_revisions(&mut *tx)
            .await
            .expect("hotel_schema_revisions must decode as (i32, i32, String)");

        // Start from exactly a canonical install: the V1 baseline row that
        // seed.sql writes, plus one row per compiled-in patch.
        sqlx::query(
            "DELETE FROM public.hotel_schema_revisions WHERE NOT (generation = 1 AND version = 1)",
        )
        .execute(&mut *tx)
        .await
        .expect("clear patch revisions");
        for revision in &required {
            insert_revision(
                &mut tx,
                revision.generation,
                revision.version,
                &revision.name,
                &revision.checksum,
            )
            .await;
        }
        assert_eq!(
            schema_catalog::check(&mut *tx).await.expect("probe"),
            CatalogCheck::Current {
                head,
                newer_recorded: 0
            },
            "a database at the compiled-in head must be current"
        );

        // A revision from a newer release, as after a rollback, is accepted.
        let (ahead_generation, ahead_version) =
            head.map_or((1, 2), |(generation, version)| (generation, version + 1));
        insert_revision(
            &mut tx,
            ahead_generation,
            ahead_version,
            "rollback-probe",
            &format!("sha256:{}", "f".repeat(64)),
        )
        .await;
        assert_eq!(
            schema_catalog::check(&mut *tx).await.expect("probe"),
            CatalogCheck::Current {
                head,
                newer_recorded: usize::from(head.is_some())
            },
            "revisions newer than this build must not block startup"
        );

        if let Some(newest) = required.last() {
            // Dropping the newest required revision makes the database behind.
            sqlx::query(
                "DELETE FROM public.hotel_schema_revisions WHERE generation = $1 AND version = $2",
            )
            .bind(newest.generation)
            .bind(newest.version)
            .execute(&mut *tx)
            .await
            .expect("delete newest revision");
            assert_eq!(
                schema_catalog::check(&mut *tx).await.expect("probe"),
                CatalogCheck::Behind(vec![RevisionGap::Missing(newest.clone())]),
            );

            // Recording that version from a different catalog is a gap too.
            let foreign = format!("sha256:{}", "0".repeat(64));
            insert_revision(
                &mut tx,
                newest.generation,
                newest.version,
                &newest.name,
                &foreign,
            )
            .await;
            assert_eq!(
                schema_catalog::check(&mut *tx).await.expect("probe"),
                CatalogCheck::Behind(vec![RevisionGap::ChecksumMismatch {
                    required: newest.clone(),
                    recorded_checksum: foreign,
                }]),
            );
        }

        tx.rollback().await.expect("roll back revision fixtures");
    }
}
