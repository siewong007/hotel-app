//! Live-PostgreSQL coverage for the Phase 3 campaign work: derived lifecycle
//! (`scheduled`/`live`/`expired`), the terminal `cancelled` transition, loyalty
//! tier and booking-channel targeting gates, and the per-campaign performance
//! report built on `vouchers` + `voucher_redemptions` +
//! `voucher_redemption_allocations`.
//!
//! Skips when `DATABASE_URL` is unset. Each test owns a private 993_Nxx id
//! band so the suite can run in parallel.

mod postgres_tests {
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::guest_booking::repository::{
        GuestBookingRepository, VoucherEligibilityQuery,
    };
    use hotel_app_be::modules::promotions::models::{
        ClaimPromotionInput, PromotionActionInput, VoucherIssueInput,
    };
    use hotel_app_be::modules::promotions::repository::PromotionRepository;
    use hotel_app_be::modules::promotions::service;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping PostgreSQL campaign test because DATABASE_URL is not set");
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

    /// `base` is the first id of a private 100-id band (993100, 993200, ...).
    async fn cleanup_fixtures(pool: &PgPool, base: i64) {
        // RESTRICT foreign keys force this delete order.
        for statement in [
            "DELETE FROM voucher_redemption_allocations WHERE redemption_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM voucher_redemption_allocations WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM voucher_redemptions WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM vouchers WHERE promotion_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM vouchers WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM promotion_channels WHERE promotion_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM promotion_loyalty_tiers WHERE promotion_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM promotion_room_types WHERE promotion_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM loyalty_accounts WHERE member_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM loyalty_members WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM loyalty_tiers WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM loyalty_programs WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM room_status_change_log WHERE room_id BETWEEN $1 AND $1 + 99",
            "DELETE FROM bookings WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM rooms WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM room_types WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM promotions WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM guests WHERE id BETWEEN $1 AND $1 + 99",
            "DELETE FROM booking_channels WHERE id BETWEEN $1 AND $1 + 99",
        ] {
            sqlx::query(statement)
                .bind(base)
                .execute(pool)
                .await
                .unwrap();
        }
    }

    async fn seed_guest(pool: &PgPool, id: i64) {
        sqlx::query(
            "INSERT INTO guests (id, nick_name, guest_type, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'non_member', true)",
        )
        .bind(id)
        .bind(format!("Cmp993 Guest {id}"))
        .execute(pool)
        .await
        .expect("seeding a guest must succeed");
    }

    /// `window` selects the claim window: `"live"` (open), `"scheduled"`
    /// (future start), or `"expired"` (past end).
    async fn seed_promotion(pool: &PgPool, id: i64, status: &str, window: &str, is_public: bool) {
        let (starts, ends) = match window {
            "scheduled" => (
                Some(Utc::now() + Duration::days(3)),
                Some(Utc::now() + Duration::days(10)),
            ),
            "expired" => (
                Some(Utc::now() - Duration::days(10)),
                Some(Utc::now() - Duration::days(1)),
            ),
            _ => (None, None),
        };
        sqlx::query(
            "INSERT INTO promotions (id, slug, name, status, promotion_kind, discount_type, discount_value, currency, is_public, claim_starts_at, claim_ends_at) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'voucher', 'fixed_amount', 25, 'MYR', $5, $6, $7)",
        )
        .bind(id)
        .bind(format!("cmp993-offer-{id}"))
        .bind(format!("Cmp993 Offer {id}"))
        .bind(status)
        .bind(is_public)
        .bind(starts)
        .bind(ends)
        .execute(pool)
        .await
        .expect("seeding the promotion must succeed");
    }

    async fn seed_voucher(
        pool: &PgPool,
        id: i64,
        promotion_id: i64,
        guest_id: i64,
        status: &str,
        source: &str,
    ) {
        sqlx::query(
            "INSERT INTO vouchers (id, promotion_id, guest_id, code, status, source) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(id)
        .bind(promotion_id)
        .bind(guest_id)
        .bind(format!("VCH993N{id}"))
        .bind(status)
        .bind(source)
        .execute(pool)
        .await
        .expect("seeding a voucher must succeed");
    }

    fn claim_input() -> ClaimPromotionInput {
        ClaimPromotionInput {
            client_request_id: None,
        }
    }

    fn action_input(reason: Option<&str>) -> PromotionActionInput {
        PromotionActionInput {
            expected_version: None,
            reason: reason.map(str::to_string),
        }
    }

    /// A published campaign resolves to `scheduled`/`live`/`expired` against
    /// the claim window; `cancelled` is a terminal stored state reachable from
    /// draft/published/paused but not from cancelled/archived.
    #[tokio::test]
    async fn campaign_lifecycle_is_derived_and_cancel_is_terminal() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 993_100;
        cleanup_fixtures(&pool, base).await;
        seed_guest(&pool, base + 50).await;

        seed_promotion(&pool, base, "published", "live", true).await;
        seed_promotion(&pool, base + 1, "published", "scheduled", true).await;
        seed_promotion(&pool, base + 2, "published", "expired", true).await;
        seed_promotion(&pool, base + 3, "draft", "live", false).await;
        seed_promotion(&pool, base + 4, "archived", "live", false).await;
        seed_promotion(&pool, base + 5, "paused", "live", false).await;

        let lifecycle_of = |id: i64| {
            let pool = pool.clone();
            async move {
                PromotionRepository::find_by_id(&pool, id)
                    .await
                    .unwrap()
                    .unwrap()
                    .lifecycle
            }
        };
        assert_eq!(lifecycle_of(base).await, "live");
        assert_eq!(lifecycle_of(base + 1).await, "scheduled");
        assert_eq!(lifecycle_of(base + 2).await, "expired");
        assert_eq!(lifecycle_of(base + 3).await, "draft");

        // Cancel is reachable from published and paused, audited, terminal.
        service::cancel_admin_promotion(
            &pool,
            1000,
            base,
            action_input(Some("Supply pulled")),
            None,
            None,
        )
        .await
        .expect("cancelling a published campaign must succeed");
        let cancelled = PromotionRepository::find_by_id(&pool, base)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.lifecycle, "cancelled");

        let again =
            service::cancel_admin_promotion(&pool, 1000, base, action_input(None), None, None)
                .await;
        assert!(
            matches!(again, Err(ApiError::Conflict(_))),
            "cancelling twice must be a 409, got {again:?}"
        );
        let archived =
            service::cancel_admin_promotion(&pool, 1000, base + 4, action_input(None), None, None)
                .await;
        assert!(
            matches!(archived, Err(ApiError::Conflict(_))),
            "cancelling an archived campaign must be a 409, got {archived:?}"
        );
        service::cancel_admin_promotion(&pool, 1000, base + 5, action_input(None), None, None)
            .await
            .expect("cancelling a paused campaign must succeed");

        // A cancelled campaign is unclaimable (claim requires published).
        let claim =
            service::claim_guest_promotion(&pool, base + 50, base, claim_input(), None, None).await;
        assert!(claim.is_err(), "a cancelled campaign must not be claimable");

        // The admin list filter accepts lifecycle values.
        let (cancelled_total, _) =
            PromotionRepository::list_admin(&pool, Some("cancelled"), Some("cmp993-offer"), 50, 0)
                .await
                .unwrap();
        assert_eq!(cancelled_total, 2, "base and base+5 are cancelled");
        let (scheduled_total, scheduled) =
            PromotionRepository::list_admin(&pool, Some("scheduled"), Some("cmp993-offer"), 50, 0)
                .await
                .unwrap();
        assert_eq!(scheduled_total, 1);
        assert_eq!(scheduled[0].id, base + 1);

        cleanup_fixtures(&pool, base).await;
    }

    /// Loyalty-tier targeting gates both guest claims and admin issue; channel
    /// targeting gates the portal claim path (always direct) and the voucher
    /// eligibility predicate used at redemption time.
    #[tokio::test]
    async fn campaign_targeting_gates_claim_issue_and_eligibility() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 993_200;
        cleanup_fixtures(&pool, base).await;

        // Loyalty program + tier the campaign targets.
        sqlx::query(
            "INSERT INTO loyalty_programs (id, name, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'Cmp993 Program', true)",
        )
        .bind(base)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO loyalty_tiers (id, program_id, code, name, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'CMP993G', 'Cmp993 Gold', true)",
        )
        .bind(base)
        .bind(base)
        .execute(&pool)
        .await
        .unwrap();

        // Tier-targeted campaign.
        seed_promotion(&pool, base, "published", "live", true).await;
        sqlx::query(
            "INSERT INTO promotion_loyalty_tiers (promotion_id, loyalty_tier_id) VALUES ($1, $2)",
        )
        .bind(base)
        .bind(base)
        .execute(&pool)
        .await
        .unwrap();

        seed_guest(&pool, base + 1).await;
        seed_guest(&pool, base + 2).await;
        seed_guest(&pool, base + 3).await;

        // Guest without the tier can neither claim nor be issued.
        let claim =
            service::claim_guest_promotion(&pool, base + 1, base, claim_input(), None, None).await;
        assert!(
            matches!(claim, Err(ApiError::Conflict(_))),
            "claim outside the tier set must be a 409, got {claim:?}"
        );
        let issue = service::issue_admin_voucher(
            &pool,
            1000,
            VoucherIssueInput {
                promotion_id: base,
                guest_id: base + 1,
                code: None,
                expires_at: None,
            },
            None,
            None,
        )
        .await;
        assert!(
            matches!(issue, Err(ApiError::Conflict(_))),
            "admin issue outside the tier set must be a 409, got {issue:?}"
        );

        // Grant the tier — member + account carrying current_tier_id.
        sqlx::query(
            "INSERT INTO loyalty_members (id, guest_id, member_number, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'active')",
        )
        .bind(base)
        .bind(base + 1)
        .bind(format!("CMP993M{base}"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO loyalty_accounts (id, member_id, current_tier_id) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)",
        )
        .bind(base)
        .bind(base)
        .bind(base)
        .execute(&pool)
        .await
        .unwrap();

        service::claim_guest_promotion(&pool, base + 1, base, claim_input(), None, None)
            .await
            .expect("a guest at the targeted tier must claim successfully");

        // Channel-targeted campaign: an OTA channel the portal can never use.
        sqlx::query(
            "INSERT INTO booking_channels (id, name, channel_type, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'ota', true)",
        )
        .bind(base + 10)
        .bind(format!("Cmp993 OTA {base}"))
        .execute(&pool)
        .await
        .unwrap();
        seed_promotion(&pool, base + 5, "published", "live", true).await;
        sqlx::query(
            "INSERT INTO promotion_channels (promotion_id, booking_channel_id) VALUES ($1, $2)",
        )
        .bind(base + 5)
        .bind(base + 10)
        .execute(&pool)
        .await
        .unwrap();

        let claim =
            service::claim_guest_promotion(&pool, base + 2, base + 5, claim_input(), None, None)
                .await;
        assert!(
            matches!(claim, Err(ApiError::Conflict(_))),
            "a channel-targeted campaign must reject the portal (direct) claim, got {claim:?}"
        );

        // The same predicate is enforced at voucher eligibility: a voucher
        // held against the OTA-targeted campaign is eligible on that channel
        // and ineligible on the direct channel.
        seed_voucher(
            &pool,
            base + 20,
            base + 5,
            base + 3,
            "available",
            "admin_issue",
        )
        .await;
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 100)",
        )
        .bind(base + 20)
        .bind(format!("CMP{base}"))
        .bind(format!("Cmp993 Room {base}"))
        .execute(&pool)
        .await
        .unwrap();

        let direct = GuestBookingRepository::direct_booking_channel(&pool)
            .await
            .expect("direct channel lookup must succeed");
        let query = |channel: Option<i64>| VoucherEligibilityQuery {
            guest_id: base + 3,
            room_type_id: base + 20,
            check_in: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            check_out: NaiveDate::from_ymd_opt(2026, 10, 3).unwrap(),
            nights: 2,
            subtotal: Decimal::new(200, 0),
            currency: "MYR",
            booking_channel_id: channel,
        };
        let on_direct =
            GuestBookingRepository::eligible_voucher(&pool, base + 20, query(direct)).await;
        assert!(
            matches!(on_direct, Err(ApiError::Conflict(_))),
            "an OTA-targeted voucher must be ineligible on the direct channel, got {on_direct:?}"
        );
        let on_ota =
            GuestBookingRepository::eligible_voucher(&pool, base + 20, query(Some(base + 10)))
                .await;
        assert!(
            on_ota.is_ok(),
            "the voucher must be eligible on its targeted channel, got {on_ota:?}"
        );
        let eligible_ids = GuestBookingRepository::eligible_voucher_ids(&pool, query(direct))
            .await
            .unwrap();
        assert!(
            !eligible_ids.contains(&(base + 20)),
            "the eligibility list must hide the voucher on the direct channel"
        );

        cleanup_fixtures(&pool, base).await;
    }

    /// The performance report counts real funnel/redemption/allocation rows:
    /// reversed redemptions are excluded from totals, per-night sums come from
    /// allocations, and the channel mix follows the redeemed bookings.
    #[tokio::test]
    async fn campaign_performance_counts_real_rows() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let base = 993_300;
        cleanup_fixtures(&pool, base).await;

        seed_promotion(&pool, base, "published", "live", true).await;
        for offset in 1..=3_i64 {
            seed_guest(&pool, base + offset).await;
        }
        sqlx::query(
            "INSERT INTO booking_channels (id, name, channel_type, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'ota', true)",
        )
        .bind(base + 10)
        .bind(format!("Cmp993 OTA {base}"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 100)",
        )
        .bind(base + 20)
        .bind(format!("CMP{base}"))
        .bind(format!("Cmp993 Room {base}"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)",
        )
        .bind(base + 20)
        .bind(format!("{base}R"))
        .bind(base + 20)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, total_amount, booking_channel_id) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, 100, 200, 200, $7)",
        )
        .bind(base)
        .bind(format!("BK{base}"))
        .bind(base + 1)
        .bind(base + 20)
        .bind(NaiveDate::from_ymd_opt(2026, 10, 1).unwrap())
        .bind(NaiveDate::from_ymd_opt(2026, 10, 3).unwrap())
        .bind(base + 10)
        .execute(&pool)
        .await
        .unwrap();

        // Funnel: 1 guest claim redeemed, 1 admin issue redeemed (later
        // reversed), 1 admin issue revoked.
        seed_voucher(&pool, base + 1, base, base + 1, "redeemed", "guest_claim").await;
        seed_voucher(&pool, base + 2, base, base + 2, "redeemed", "admin_issue").await;
        seed_voucher(&pool, base + 3, base, base + 3, "revoked", "admin_issue").await;

        // Applied redemption on the OTA booking + a reversed one on a second
        // booking channel-less booking.
        sqlx::query(
            "INSERT INTO voucher_redemptions (id, voucher_id, promotion_id, booking_id, guest_id, status, gross_subtotal, discount_type, discount_value, discount_amount, net_total) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, 'applied', 200, 'fixed_amount', 50, 50, 150)",
        )
        .bind(base)
        .bind(base + 1)
        .bind(base)
        .bind(base)
        .bind(base + 1)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO voucher_redemptions (id, voucher_id, promotion_id, booking_id, guest_id, status, gross_subtotal, discount_type, discount_value, discount_amount, net_total) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, 'reversed', 100, 'fixed_amount', 25, 25, 75)",
        )
        .bind(base + 1)
        .bind(base + 2)
        .bind(base)
        .bind(base)
        .bind(base + 2)
        .execute(&pool)
        .await
        .unwrap();

        // Two stay nights allocated against the applied redemption.
        for (offset, day) in [(0_i64, 1_i64), (1, 2)] {
            sqlx::query(
                "INSERT INTO voucher_redemption_allocations (id, redemption_id, booking_id, stay_date, gross_amount, discount_amount, net_amount) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 100, 25, 75)",
            )
            .bind(base + 50 + offset)
            .bind(base)
            .bind(base)
            .bind(NaiveDate::from_ymd_opt(2026, 10, day as u32).unwrap())
            .execute(&pool)
            .await
            .unwrap();
        }

        let performance = service::campaign_performance(&pool, base)
            .await
            .expect("campaign performance must decode");

        assert_eq!(performance.promotion_id, base);
        assert_eq!(performance.currency, "MYR");
        assert_eq!(performance.vouchers.total, 3);
        assert_eq!(performance.vouchers.redeemed, 2);
        assert_eq!(performance.vouchers.revoked, 1);
        assert_eq!(performance.vouchers.guest_claims, 1);
        assert_eq!(performance.vouchers.admin_issues, 2);

        // Reversed rows count separately and never enter the applied sums.
        assert_eq!(performance.redemptions.applied, 1);
        assert_eq!(performance.redemptions.reversed, 1);
        assert_eq!(performance.redemptions.gross_subtotal, 200.0);
        assert_eq!(performance.redemptions.discount_amount, 50.0);
        assert_eq!(performance.redemptions.net_total, 150.0);
        assert_eq!(performance.redemptions.bookings, 1);
        assert_eq!(performance.redemptions.guests, 1);
        let conversion = performance
            .redemptions
            .conversion_rate
            .expect("a campaign with vouchers reports a conversion rate");
        assert!((conversion - 1.0 / 3.0).abs() < 1e-9);

        assert_eq!(performance.per_night.nights, 2);
        assert_eq!(performance.per_night.gross_amount, 200.0);
        assert_eq!(performance.per_night.discount_amount, 50.0);
        assert_eq!(performance.per_night.net_amount, 150.0);

        assert_eq!(performance.channel_mix.len(), 1);
        let mix = &performance.channel_mix[0];
        assert_eq!(mix.channel_id, Some(base + 10));
        assert_eq!(mix.redemptions, 1);
        assert_eq!(mix.net_total, 150.0);

        cleanup_fixtures(&pool, base).await;
    }
}
