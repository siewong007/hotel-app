//! Live-PostgreSQL coverage for Phase 4 guest segments: dynamic rule
//! evaluation (no materialized membership), the segments CRUD/preview path,
//! and the `email_campaigns.segment_id` intersection with the existing
//! consent / suppression / dedup audience gates.
//!
//! Skips when `DATABASE_URL` is unset. Each test owns a private 994_Nxx
//! sub-band (994_0xx / 994_1xx / 994_2xx) and a band-scoped `country`
//! sentinel so the suite runs in parallel without cross-test matches.

mod postgres_tests {
    use hotel_app_be::modules::communications::models::CampaignInput;
    use hotel_app_be::modules::communications::repository::CommunicationsRepository as CommsRepo;
    use hotel_app_be::modules::communications::service as comms_service;
    use hotel_app_be::modules::segments::models::{
        SegmentInput, SegmentPreviewInput, SegmentScope,
    };
    use hotel_app_be::modules::segments::service as segments_service;
    use serde_json::json;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    const ACTOR: i64 = 1000;
    const TOPIC: &str = "announcement";

    async fn pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) if !url.is_empty() => url,
            _ => {
                eprintln!("Skipping segment-targeting test: DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(3)
                // Some baselines make audit_logs append-only; this GUC is the
                // test escape hatch and a no-op where the trigger is absent.
                .after_connect(|conn, _| {
                    Box::pin(async move {
                        sqlx::query("SET app.allow_audit_mutation = 'on'")
                            .execute(conn)
                            .await
                            .map(|_| ())
                    })
                })
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    /// Band-scoped `country` value — unique per test so parallel fixtures
    /// never satisfy each other's segment rules.
    fn seg_country(base: i64) -> String {
        format!("SegTestLand-{base}")
    }

    fn seg_rules(base: i64) -> serde_json::Value {
        json!({"groups":[{"conditions":[
            {"field":"country","op":"eq","value":seg_country(base)}
        ]}]})
    }

    /// `base` is the first id of a private 100-id band (994000, 994100, ...).
    /// The tests in this file run in parallel against one database, so every
    /// predicate must stay inside the band — a cross-band sweep would delete
    /// another test's fixtures mid-assertion. Service-created rows (segments,
    /// campaigns) take sequence ids outside the band; their names/slugs embed
    /// the base digits so the marker sweep below finds them.
    async fn cleanup(pool: &PgPool, base: i64) {
        for stmt in [
            "DELETE FROM audit_logs WHERE resource_type IN ('guest_segment', 'email_campaign') \
                AND resource_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM email_deliveries WHERE guest_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM email_deliveries WHERE campaign_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM email_campaigns WHERE id BETWEEN $1 AND $1 + 99 \
                OR segment_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM notification_subscriptions WHERE guest_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM guest_segments WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM guests WHERE id BETWEEN $1 AND $1 + 99",
        ] {
            sqlx::query(stmt).bind(base).execute(pool).await.unwrap();
        }

        // Service-created rows carry the base digits in their name/slug and
        // in the audit-row details.
        let marker = format!("%{base}%");
        for stmt in [
            "DELETE FROM audit_logs WHERE resource_type IN ('guest_segment', 'email_campaign') \
                AND details::text LIKE $1",
            "DELETE FROM email_campaigns WHERE name LIKE $1",
            "DELETE FROM guest_segments WHERE name LIKE $1 OR slug LIKE $1",
        ] {
            sqlx::query(stmt).bind(&marker).execute(pool).await.unwrap();
        }

        // Suppression emails embed the guest id, so the band shares a prefix
        // (994000-994099 -> seg994-9940*@hotel.local).
        sqlx::query("DELETE FROM email_suppressions WHERE email LIKE $1")
            .bind(format!("seg994-{}%", base / 100))
            .execute(pool)
            .await
            .unwrap();
    }

    /// Active guest with an email; caller attaches subscriptions etc.
    async fn seed_guest(pool: &PgPool, id: i64, country: &str) {
        sqlx::query(
            "INSERT INTO guests (id, nick_name, first_name, email, country, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Seg', $3, $4, true)",
        )
        .bind(id)
        .bind(format!("Seg994 Guest {id}"))
        .bind(format!("seg994-{id}@hotel.local"))
        .bind(country)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn subscribe(pool: &PgPool, guest_id: i64) {
        sqlx::query(
            "INSERT INTO notification_subscriptions (guest_id, channel, topic, subscribed) \
             VALUES ($1, 'email', $2, true)",
        )
        .bind(guest_id)
        .bind(TOPIC)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Segment row with a caller-controlled id (service-generated ids land
    /// outside the band; direct insert keeps cleanup deterministic).
    async fn seed_segment(pool: &PgPool, id: i64, base: i64, is_active: bool) {
        sqlx::query(
            "INSERT INTO guest_segments (id, name, slug, rules, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(id)
        .bind(format!("Seg994 Segment {id}"))
        .bind(format!("seg994-segment-{id}"))
        .bind(seg_rules(base))
        .bind(is_active)
        .execute(pool)
        .await
        .unwrap();
    }

    fn segment_input(name: &str, base: i64, is_active: bool) -> SegmentInput {
        SegmentInput {
            name: name.to_string(),
            description: None,
            rules: seg_rules(base),
            is_active: Some(is_active),
        }
    }

    #[tokio::test]
    async fn segment_crud_preview_and_audience_intersection() {
        const BASE: i64 = 994_000;
        let Some(pool) = pg_pool().await else {
            return;
        };
        cleanup(&pool, BASE).await;

        // Audience fixture matrix against segment "country = SegTestLand-994000":
        //   +1 in-segment + subscribed            → reachable
        //   +2 in-segment, no subscription        → excluded_unsubscribed
        //   +3 subscribed, outside segment        → excluded_segment
        //   +4 in-segment + subscribed + suppress → excluded_suppressed
        //   +5 in-segment + subscribed, no email  → excluded_no_email
        //   +6 in-segment + subscribed, inactive  → excluded_inactive
        //   +7 in-segment + subscribed            → reachable (dedup below)
        let country = seg_country(BASE);
        seed_guest(&pool, BASE + 1, &country).await;
        seed_guest(&pool, BASE + 2, &country).await;
        seed_guest(&pool, BASE + 3, "Elsewhere").await;
        seed_guest(&pool, BASE + 4, &country).await;
        seed_guest(&pool, BASE + 6, &country).await;
        seed_guest(&pool, BASE + 7, &country).await;
        sqlx::query(
            "INSERT INTO guests (id, nick_name, first_name, email, country, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Seg', NULL, $3, true)",
        )
        .bind(BASE + 5)
        .bind(format!("Seg994 Guest {}", BASE + 5))
        .bind(&country)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE guests SET is_active = false WHERE id = $1")
            .bind(BASE + 6)
            .execute(&pool)
            .await
            .unwrap();
        for id in [BASE + 1, BASE + 3, BASE + 4, BASE + 5, BASE + 6, BASE + 7] {
            subscribe(&pool, id).await;
        }
        sqlx::query("INSERT INTO email_suppressions (email, reason) VALUES ($1, 'manual')")
            .bind(format!("seg994-{}@hotel.local", BASE + 4))
            .execute(&pool)
            .await
            .unwrap();

        // --- CRUD + preview -------------------------------------------------
        let segment = segments_service::create_segment(
            &pool,
            ACTOR,
            segment_input(&format!("Seg994 Country {BASE}"), BASE, true),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(segment.rules, seg_rules(BASE));
        assert!(segment.is_active);

        let preview = segments_service::preview_saved(&pool, segment.id)
            .await
            .unwrap();
        // Five in-segment fixtures are active (BASE+6 is not) — preview
        // measures active membership regardless of the audience gates.
        assert_eq!(preview.count, 5);
        assert_eq!(preview.sample.len(), 5);
        assert!(preview.sample.iter().all(|g| g.id / 100 == BASE / 100));

        // Unsaved-rules preview takes the same compiler path.
        let dry = segments_service::preview_rules(
            &pool,
            SegmentPreviewInput {
                rules: seg_rules(BASE),
            },
        )
        .await
        .unwrap();
        assert_eq!(dry.count, 5);

        // --- Audience intersection ------------------------------------------
        let scope = segments_service::audience_scope_for(&pool, Some(segment.id))
            .await
            .unwrap();
        let count = CommsRepo::count_audience(&pool, TOPIC, &scope)
            .await
            .unwrap();
        assert_eq!(count.eligible, 2, "BASE+1 and BASE+7 pass every gate");
        assert!(
            count.excluded_segment >= 1,
            "BASE+3 is eligible but outside"
        );
        assert!(count.excluded_suppressed >= 1, "BASE+4 is suppressed");
        assert!(count.excluded_no_email >= 1, "BASE+5 has no email");
        assert!(count.excluded_inactive >= 1, "BASE+6 is inactive");
        assert!(count.excluded_unsubscribed >= 1, "BASE+2 never subscribed");

        let batch = CommsRepo::audience_batch(&pool, TOPIC, BASE + 90, &scope, 50)
            .await
            .unwrap();
        let ids: Vec<i64> = batch.iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![BASE + 1, BASE + 7], "count/batch parity");

        // Dedup gate: a prior delivery for this campaign removes the guest.
        // (email_deliveries.campaign_id is FK-constrained, so the campaign row
        // must exist.)
        sqlx::query(
            "INSERT INTO email_campaigns (id, name, campaign_type, topic, subject, body_html) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'Seg994 dedup campaign', 'announcement', $2, 's', '<p>x</p>')",
        )
        .bind(BASE + 90)
        .bind(TOPIC)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_deliveries (campaign_id, kind, guest_id, topic, \
             recipient_email, subject, body_html, idempotency_key) \
             VALUES ($1, 'campaign', $2, $3, $4, 's', '<p>x</p>', $5)",
        )
        .bind(BASE + 90)
        .bind(BASE + 7)
        .bind(TOPIC)
        .bind(format!("seg994-{}@hotel.local", BASE + 7))
        .bind(format!("seg994-dedup-{BASE}"))
        .execute(&pool)
        .await
        .unwrap();
        let batch = CommsRepo::audience_batch(&pool, TOPIC, BASE + 90, &scope, 50)
            .await
            .unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].id, BASE + 1);

        // --- Update + delete --------------------------------------------------
        let updated = segments_service::update_segment(
            &pool,
            ACTOR,
            segment.id,
            SegmentInput {
                name: format!("Seg994 Country Renamed {BASE}"),
                description: Some("renamed".to_string()),
                rules: seg_rules(BASE),
                is_active: Some(true),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(updated.name, format!("Seg994 Country Renamed {BASE}"));

        segments_service::delete_segment(&pool, ACTOR, segment.id, None, None)
            .await
            .unwrap();
        assert!(
            segments_service::get_segment(&pool, segment.id)
                .await
                .is_err()
        );

        cleanup(&pool, BASE).await;
    }

    #[tokio::test]
    async fn inactive_and_missing_segments_fail_closed() {
        const BASE: i64 = 994_100;
        let Some(pool) = pg_pool().await else {
            return;
        };
        cleanup(&pool, BASE).await;

        seed_guest(&pool, BASE + 1, &seg_country(BASE)).await;
        subscribe(&pool, BASE + 1).await;
        seed_segment(&pool, BASE + 10, BASE, false).await;

        // Attaching an inactive segment to a campaign is rejected up front.
        assert!(
            segments_service::require_active_segment(&pool, BASE + 10)
                .await
                .is_err()
        );

        // If a segment goes inactive after attach, expansion fails closed —
        // the campaign reaches nobody rather than the untargeted audience.
        let scope = segments_service::audience_scope_for(&pool, Some(BASE + 10))
            .await
            .unwrap();
        assert!(matches!(scope, SegmentScope::Empty));
        let batch = CommsRepo::audience_batch(&pool, TOPIC, BASE + 90, &scope, 50)
            .await
            .unwrap();
        assert!(batch.is_empty());
        let count = CommsRepo::count_audience(&pool, TOPIC, &scope)
            .await
            .unwrap();
        assert_eq!(count.eligible, 0);

        // A deleted segment id resolves the same way.
        let scope = segments_service::audience_scope_for(&pool, Some(BASE + 11))
            .await
            .unwrap();
        assert!(matches!(scope, SegmentScope::Empty));

        cleanup(&pool, BASE).await;
    }

    #[tokio::test]
    async fn campaign_segment_validation_and_persistence() {
        const BASE: i64 = 994_200;
        let Some(pool) = pg_pool().await else {
            return;
        };
        cleanup(&pool, BASE).await;
        seed_segment(&pool, BASE + 10, BASE, true).await;

        let input = |segment_id: Option<i64>| CampaignInput {
            name: format!("Seg994 campaign {BASE}"),
            campaign_type: "announcement".to_string(),
            subject: "Seg994 subject".to_string(),
            body_html: "<p>hi</p>".to_string(),
            body_text: None,
            template_id: None,
            promotion_id: None,
            segment_id,
        };

        // Unknown segment id is rejected at create time.
        assert!(
            comms_service::create_campaign(&pool, ACTOR, input(Some(BASE + 11)), None, None)
                .await
                .is_err()
        );

        // A valid segment persists onto the campaign row.
        let campaign =
            comms_service::create_campaign(&pool, ACTOR, input(Some(BASE + 10)), None, None)
                .await
                .unwrap();
        assert_eq!(campaign.segment_id, Some(BASE + 10));

        // Deleting a segment still referenced by a campaign is a conflict —
        // deactivate instead.
        assert!(
            segments_service::delete_segment(&pool, ACTOR, BASE + 10, None, None)
                .await
                .is_err()
        );

        cleanup(&pool, BASE).await;
    }
}
