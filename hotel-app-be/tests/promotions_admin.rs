//! Integration coverage for the staff voucher admin projections added for the
//! voucher workspace: the `guest_name` join, `revocation_reason` column,
//! `expired`/`expiring_soon` filter aliases, and `voucher_admin_summary`.
//!
//! SQLx row decoding is runtime-only in this crate, so these tests fetch the
//! admin projections end-to-end against live PostgreSQL. They skip when
//! `DATABASE_URL` is unset. Each test owns a private 992_Nxx id band so the
//! suite can run in parallel, and each voucher gets its own guest because
//! `uq_vouchers_promotion_guest` allows one voucher per guest per promotion.

mod postgres_tests {
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::promotions::models::VoucherIssueInput;
    use hotel_app_be::modules::promotions::repository::PromotionRepository;
    use hotel_app_be::modules::promotions::service;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping PostgreSQL promotions-admin test because DATABASE_URL is not set"
                );
                return None;
            }
        };

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some(pool)
    }

    /// `base` is the first id of a private 100-id band (992100, 992200, ...).
    /// Band layout: base+0 promotion/room-type/room/booking/redemption,
    /// base+1..base+4 guests and their vouchers (available, expired,
    /// expiring-soon, revoked).
    async fn cleanup_fixtures(pool: &PgPool, base: i64) {
        // RESTRICT foreign keys force this delete order.
        for statement in [
            "DELETE FROM voucher_redemptions WHERE id BETWEEN $1 AND $1 + 99",
            // Issued vouchers take identity ids outside the band, so match on
            // promotion_id as well as the band.
            "DELETE FROM vouchers WHERE promotion_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM vouchers WHERE id BETWEEN $1 AND $1 + 99",
            // A trigger logs every room insert; the log FKs to rooms.
            "DELETE FROM room_status_change_log WHERE room_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM bookings WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM rooms WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM room_types WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM promotions WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM guests WHERE id BETWEEN $1 AND $1 + 99",
        ] {
            sqlx::query(statement)
                .bind(base)
                .execute(pool)
                .await
                .unwrap();
        }
    }

    async fn seed_voucher(
        pool: &PgPool,
        base: i64,
        offset: i64,
        status: &str,
        expires_at: Option<chrono::DateTime<Utc>>,
        revoked_at: Option<chrono::DateTime<Utc>>,
        revocation_reason: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO vouchers (id, promotion_id, guest_id, code, status, source, expires_at, revoked_at, revocation_reason) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, 'admin_issue', $6, $7, $8)",
        )
        .bind(base + offset)
        .bind(base)
        .bind(base + offset)
        .bind(format!("VCH{}N{}", base, offset))
        .bind(status)
        .bind(expires_at)
        .bind(revoked_at)
        .bind(revocation_reason)
        .execute(pool)
        .await
        .expect("seeding a voucher must succeed");
    }

    async fn seed_fixtures(pool: &PgPool, base: i64) {
        cleanup_fixtures(pool, base).await;

        for offset in 1..=4_i64 {
            sqlx::query(
                "INSERT INTO guests (id, nick_name, guest_type, is_active) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'non_member', true)",
            )
            .bind(base + offset)
            .bind(format!("Vch992 Guest {base}-{offset}"))
            .execute(pool)
            .await
            .expect("seeding a guest must succeed");
        }

        sqlx::query(
            "INSERT INTO promotions (id, slug, name, status, promotion_kind, discount_type, discount_value, currency) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Vch992 Offer', 'published', 'voucher', 'fixed_amount', 25, 'MYR')",
        )
        .bind(base)
        .bind(format!("vch992-offer-{base}"))
        .execute(pool)
        .await
        .expect("seeding the promotion must succeed");

        seed_voucher(pool, base, 1, "available", None, None, None).await;
        seed_voucher(
            pool,
            base,
            2,
            "available",
            Some(Utc::now() - Duration::days(2)),
            None,
            None,
        )
        .await;
        seed_voucher(
            pool,
            base,
            3,
            "available",
            Some(Utc::now() + Duration::days(3)),
            None,
            None,
        )
        .await;
        seed_voucher(
            pool,
            base,
            4,
            "revoked",
            None,
            Some(Utc::now() - Duration::days(1)),
            Some("Fraudulent claim"),
        )
        .await;

        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 100)",
        )
        .bind(base)
        .bind(format!("VCH{base}"))
        .bind(format!("Vch992 Room {base}"))
        .execute(pool)
        .await
        .expect("seeding the room type must succeed");

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)",
        )
        .bind(base)
        .bind(format!("{base}R"))
        .bind(base)
        .execute(pool)
        .await
        .expect("seeding the room must succeed");

        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, total_amount) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, 100, 100, 100)",
        )
        .bind(base)
        .bind(format!("BK{base}"))
        .bind(base + 1)
        .bind(base)
        .bind(NaiveDate::from_ymd_opt(2026, 9, 1).unwrap())
        .bind(NaiveDate::from_ymd_opt(2026, 9, 3).unwrap())
        .execute(pool)
        .await
        .expect("seeding the booking must succeed");

        sqlx::query(
            "INSERT INTO voucher_redemptions (id, voucher_id, promotion_id, booking_id, guest_id, status, gross_subtotal, discount_type, discount_value, discount_amount, net_total) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, 'applied', 100, 'fixed_amount', 25, 25, 75)",
        )
        .bind(base)
        .bind(base + 1)
        .bind(base)
        .bind(base)
        .bind(base + 1)
        .execute(pool)
        .await
        .expect("seeding the redemption must succeed");
    }

    #[tokio::test]
    async fn admin_voucher_list_decodes_guest_join_and_revocation_reason() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 992_100;
        seed_fixtures(&pool, base).await;

        let (total, items) =
            PromotionRepository::list_admin_vouchers(&pool, None, None, Some(base), 50, 0)
                .await
                .expect("admin voucher list must decode");

        assert_eq!(total, 4);
        assert_eq!(items.len(), 4);
        let by_id = |id: i64| items.iter().find(|voucher| voucher.id == id).unwrap();

        let available = by_id(base + 1);
        let expected_guest = format!("Vch992 Guest {base}-1");
        assert_eq!(
            available.guest_name.as_deref(),
            Some(expected_guest.as_str())
        );
        assert_eq!(available.promotion_name, "Vch992 Offer");
        // Staff rows never carry the raw code — masked only.
        assert_eq!(available.code, None);
        assert_eq!(available.code_masked, "••••00N1");
        assert_eq!(available.revocation_reason, None);

        let revoked = by_id(base + 4);
        assert_eq!(revoked.status, "revoked");
        assert_eq!(
            revoked.revocation_reason.as_deref(),
            Some("Fraudulent claim")
        );

        cleanup_fixtures(&pool, base).await;
    }

    #[tokio::test]
    async fn expired_and_expiring_soon_filters_match_derived_status() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 992_200;
        seed_fixtures(&pool, base).await;

        let (expired_total, expired_items) = PromotionRepository::list_admin_vouchers(
            &pool,
            Some("expired"),
            None,
            Some(base),
            50,
            0,
        )
        .await
        .expect("expired filter must succeed");
        assert_eq!(expired_total, 1);
        assert_eq!(expired_items[0].id, base + 2);

        let (soon_total, soon_items) = PromotionRepository::list_admin_vouchers(
            &pool,
            Some("expiring_soon"),
            None,
            Some(base),
            50,
            0,
        )
        .await
        .expect("expiring_soon filter must succeed");
        assert_eq!(soon_total, 1);
        assert_eq!(soon_items[0].id, base + 3);

        cleanup_fixtures(&pool, base).await;
    }

    #[tokio::test]
    async fn voucher_admin_summary_decodes_counts_and_discount_totals() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 992_300;
        seed_fixtures(&pool, base).await;

        let summary = PromotionRepository::voucher_admin_summary(&pool)
            .await
            .expect("voucher summary must decode");

        // Other test files may leave vouchers behind, so assert relative.
        assert!(summary.total >= 4);
        assert!(summary.available >= 3);
        assert!(summary.revoked >= 1);
        assert!(summary.expired >= 1);
        assert!(summary.expiring_soon >= 1);
        assert!(summary.redemption_count >= 1);

        let myr = summary
            .discount_given
            .iter()
            .find(|discount| discount.currency == "MYR")
            .expect("fixture redemption must appear under MYR");
        // The fixture contributes exactly 25; other fixtures could add more
        // under the same currency, so assert the floor.
        assert!(myr.amount >= 25.0);

        cleanup_fixtures(&pool, base).await;
    }

    /// A public promotion hidden from the catalogue (claim limit reached) must
    /// also be unreachable by slug, and admin issue must translate the code
    /// uniqueness and guest FK guards into 409/404 instead of a 500.
    #[tokio::test]
    async fn public_slug_respects_claim_limit_and_issue_maps_integrity_errors() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 992_400;
        cleanup_fixtures(&pool, base).await;

        sqlx::query(
            "INSERT INTO guests (id, nick_name, guest_type, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'non_member', true)",
        )
        .bind(base + 1)
        .bind(format!("Vch992 Guest {base}-1"))
        .execute(&pool)
        .await
        .unwrap();

        // base = full public promo, base+2 = same but under the limit.
        for (id, slug, limit, claimed) in [
            (base, "vch992-full", Some(1), 1),
            (base + 2, "vch992-open", Some(2), 0),
        ] {
            sqlx::query(
                "INSERT INTO promotions (id, slug, name, status, promotion_kind, discount_type, discount_value, currency, claim_limit, claimed_count, is_public) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Vch992 Offer', 'published', 'voucher', 'fixed_amount', 25, 'MYR', $3, $4, true)",
            )
            .bind(id)
            .bind(slug)
            .bind(limit)
            .bind(claimed)
            .execute(&pool)
            .await
            .unwrap();
        }

        assert!(
            PromotionRepository::find_public_by_slug(&pool, "vch992-full")
                .await
                .unwrap()
                .is_none(),
            "a claim-limit-reached promotion must 404 on the public slug route"
        );
        assert!(
            PromotionRepository::find_public_by_slug(&pool, "vch992-open")
                .await
                .unwrap()
                .is_some(),
            "an under-limit public promotion stays fetchable by slug"
        );

        // Issue once to occupy a code, then re-issue with the same custom code.
        let input = |code: Option<&str>, guest_id: i64| VoucherIssueInput {
            promotion_id: base + 2,
            guest_id,
            code: code.map(str::to_string),
            expires_at: None,
        };
        service::issue_admin_voucher(&pool, 1000, input(Some("VCH992DUP1"), base + 1), None, None)
            .await
            .expect("first issue must succeed");

        // A second guest is needed because (promotion, guest) is unique.
        sqlx::query(
            "INSERT INTO guests (id, nick_name, guest_type, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'non_member', true)",
        )
        .bind(base + 3)
        .bind(format!("Vch992 Guest {base}-3"))
        .execute(&pool)
        .await
        .unwrap();

        let duplicate = service::issue_admin_voucher(
            &pool,
            1000,
            input(Some("VCH992DUP1"), base + 3),
            None,
            None,
        )
        .await;
        assert!(
            matches!(duplicate, Err(ApiError::Conflict(_))),
            "reused voucher code must be a 409, got {duplicate:?}"
        );

        let missing_guest =
            service::issue_admin_voucher(&pool, 1000, input(None, 992_499), None, None).await;
        assert!(
            matches!(missing_guest, Err(ApiError::NotFound(_))),
            "missing guest must be a 404, got {missing_guest:?}"
        );

        cleanup_fixtures(&pool, base).await;
    }
}
