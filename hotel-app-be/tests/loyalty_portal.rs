//! Focused coverage for the loyalty program portal domain.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::constants::{GuestType, TourismType};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::GuestInput;
    use hotel_app_be::modules::loyalty::models::{
        LoyaltyMemberQuery, LoyaltyRulesInput, ManualAdjustmentInput, RedeemRewardInput,
        RejectRedemptionInput,
    };
    use hotel_app_be::modules::loyalty::service;
    use hotel_app_be::services::guests as guest_service;

    async fn seed_guest_user(pool: &sqlx::SqlitePool, guest_id: i64, user_id: i64, email: &str) {
        sqlx::query(
            r#"
            INSERT INTO guests (id, first_name, last_name, full_name, email, phone, guest_type, tourism_type)
            VALUES (?1, 'Loyal', 'Guest', 'Loyal Guest', ?2, '60123456789', 'member', 'local')
            "#,
        )
        .bind(guest_id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO users (id, uuid, username, email, password_hash, full_name, user_type, guest_id, is_active, is_verified)
            VALUES (?1, ?2, ?3, ?4, 'hash', 'Loyal Guest', 'guest', ?5, 1, 1)
            "#,
        )
        .bind(user_id)
        .bind(format!("00000000-0000-0000-0000-{user_id:012}"))
        .bind(format!("loyal{user_id}"))
        .bind(email)
        .bind(guest_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_checked_out_payment(
        pool: &sqlx::SqlitePool,
        booking_id: i64,
        guest_id: i64,
        amount: f64,
    ) -> i64 {
        // Bookings reference a room (FK enforced under SQLite); seed a minimal
        // room + room type once per database.
        sqlx::query(
            "INSERT OR IGNORE INTO room_types (id, name, code, base_price) VALUES (1, 'Standard', 'STD', 100)",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO rooms (id, room_number, room_type_id, status) VALUES (1, '101', 1, 'available')",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO bookings (
                id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                status, rate_per_night, total_amount, payment_status
            )
            VALUES (?1, ?2, ?3, 1, '2026-01-01', '2026-01-04', 'checked_out', ?4, ?4, 'paid')
            "#,
        )
        .bind(booking_id)
        .bind(format!("LOY-{booking_id}"))
        .bind(guest_id)
        .bind(amount)
        .execute(pool)
        .await
        .unwrap();

        let payment_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO payments (booking_id, guest_id, amount, payment_method, payment_type, status, processed_by)
            VALUES (?1, ?2, ?3, 'cash', 'booking', 'completed', 1)
            RETURNING id
            "#,
        )
        .bind(booking_id)
        .bind(guest_id)
        .bind(amount)
        .fetch_one(pool)
        .await
        .unwrap();
        payment_id
    }

    #[tokio::test]
    async fn enrollment_creates_member_and_blocks_duplicate_enrollment() {
        let pool = common::setup_test_db().await;
        seed_guest_user(&pool, 9901, 9901, "loyal1@example.com").await;

        let enrolled = service::enroll(&pool, 9901).await.unwrap();
        assert_eq!(enrolled.member.member_number, "LP00009901");
        assert_eq!(enrolled.member.status, "active");
        assert_eq!(enrolled.member.available_points, 0);

        let me = service::me(&pool, 9901).await.unwrap();
        assert!(me.enrolled);
        assert_eq!(me.member.unwrap().member_number, "LP00009901");

        let err = service::enroll(&pool, 9901).await.unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[tokio::test]
    async fn member_guest_creation_syncs_to_loyalty_admin_members() {
        let pool = common::setup_test_db().await;

        let guest = guest_service::create_guest(
            &pool,
            1,
            GuestInput {
                first_name: "Dashboard".to_string(),
                last_name: "Member".to_string(),
                email: Some("dashboard-member@example.com".to_string()),
                phone: Some("60123456780".to_string()),
                ic_number: Some("DM-001".to_string()),
                nationality: None,
                address_line1: None,
                city: None,
                state_province: None,
                postal_code: None,
                country: None,
                guest_type: Some(GuestType::Member),
                tourism_type: Some(TourismType::Local),
                discount_percentage: Some(10),
                company_name: None,
            },
        )
        .await
        .unwrap();

        let members = service::admin_members(
            &pool,
            LoyaltyMemberQuery {
                search: Some("Dashboard Member".to_string()),
                status: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].guest_id, guest.id);
        assert_eq!(members[0].member_number, format!("LP{:08}", guest.id));
        assert_eq!(members[0].status, "active");
    }

    #[tokio::test]
    async fn manual_adjustment_requires_reason_and_updates_ledger_balance() {
        let pool = common::setup_test_db().await;
        seed_guest_user(&pool, 9902, 9902, "loyal2@example.com").await;
        let member = service::enroll(&pool, 9902).await.unwrap().member;

        let bad = service::manual_adjustment(
            &pool,
            1,
            member.id,
            ManualAdjustmentInput {
                points_delta: 100,
                reason: "bad".to_string(),
                allow_negative_balance: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(bad, ApiError::BadRequest(_)));

        let adjustment = service::manual_adjustment(
            &pool,
            1,
            member.id,
            ManualAdjustmentInput {
                points_delta: 250,
                reason: "Welcome bonus adjustment".to_string(),
                allow_negative_balance: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(adjustment.transaction_type, "adjusted");
        assert_eq!(adjustment.balance_after, 250);

        let detail = service::admin_member_detail(&pool, member.id)
            .await
            .unwrap();
        assert_eq!(detail.member.available_points, 250);
    }

    #[tokio::test]
    async fn earning_points_is_idempotent_and_recalculates_tier_progress() {
        let pool = common::setup_test_db().await;
        seed_guest_user(&pool, 9903, 9903, "loyal3@example.com").await;
        let member = service::enroll(&pool, 9903).await.unwrap().member;
        let payment_id = seed_checked_out_payment(&pool, 9930, 9903, 6000.0).await;

        let first = service::award_eligible_booking_points(&pool, 9930, Some(payment_id), Some(1))
            .await
            .unwrap();
        assert_eq!(first[0].points_awarded, 6000);
        assert!(first[0].skipped_reason.is_none());

        let second = service::award_eligible_booking_points(&pool, 9930, Some(payment_id), Some(1))
            .await
            .unwrap();
        assert_eq!(second[0].points_awarded, 0);
        assert!(
            second[0]
                .skipped_reason
                .as_deref()
                .unwrap()
                .contains("already awarded")
        );

        let detail = service::admin_member_detail(&pool, member.id)
            .await
            .unwrap();
        assert_eq!(detail.member.available_points, 6000);
        assert_eq!(detail.member.tier_name, "Gold");
        assert!(detail.tier_progress.current_value >= 6000.0);
    }

    #[tokio::test]
    async fn redemption_blocks_insufficient_balance_and_rejection_restores_points() {
        let pool = common::setup_test_db().await;
        seed_guest_user(&pool, 9904, 9904, "loyal4@example.com").await;
        let member = service::enroll(&pool, 9904).await.unwrap().member;

        let reward_id: i64 =
            sqlx::query_scalar("SELECT id FROM loyalty_rewards WHERE name = 'Late checkout'")
                .fetch_one(&pool)
                .await
                .unwrap();

        let insufficient = service::redeem_reward(
            &pool,
            9904,
            reward_id,
            RedeemRewardInput {
                booking_id: None,
                notes: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(insufficient, ApiError::BadRequest(_)));

        service::manual_adjustment(
            &pool,
            1,
            member.id,
            ManualAdjustmentInput {
                points_delta: 1000,
                reason: "Compensation credit".to_string(),
                allow_negative_balance: None,
            },
        )
        .await
        .unwrap();

        let redemption = service::redeem_reward(
            &pool,
            9904,
            reward_id,
            RedeemRewardInput {
                booking_id: None,
                notes: Some("late checkout please".to_string()),
            },
        )
        .await
        .unwrap();
        assert_eq!(redemption.status, "pending");

        let rejected = service::reject_redemption(
            &pool,
            1,
            redemption.id,
            RejectRedemptionInput {
                reason: "No late checkout availability".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(rejected.status, "rejected");

        let detail = service::admin_member_detail(&pool, member.id)
            .await
            .unwrap();
        assert_eq!(detail.member.available_points, 1000);
    }

    #[tokio::test]
    async fn reversal_of_booking_awards_is_idempotent() {
        let pool = common::setup_test_db().await;
        seed_guest_user(&pool, 9905, 9905, "loyal5@example.com").await;
        let member = service::enroll(&pool, 9905).await.unwrap().member;
        let payment_id = seed_checked_out_payment(&pool, 9950, 9905, 1200.0).await;
        service::award_eligible_booking_points(&pool, 9950, Some(payment_id), Some(1))
            .await
            .unwrap();

        let first = service::reverse_booking_points(&pool, 9950, Some(1), "Booking voided")
            .await
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].transaction_type, "reversed");

        let second = service::reverse_booking_points(&pool, 9950, Some(1), "Booking voided")
            .await
            .unwrap();
        assert!(second.is_empty());

        let detail = service::admin_member_detail(&pool, member.id)
            .await
            .unwrap();
        assert_eq!(detail.member.available_points, 0);
    }

    #[tokio::test]
    async fn rules_can_switch_tier_metric_to_nights() {
        let pool = common::setup_test_db().await;
        let updated = service::update_rules(
            &pool,
            LoyaltyRulesInput {
                points_per_currency_unit: 1.0,
                tier_qualification_metric: "nights".to_string(),
                point_expiry_months: Some(24),
                redemption_approval_required: true,
                earning_enabled: true,
                min_eligible_amount: 0.0,
            },
        )
        .await
        .unwrap();

        assert_eq!(updated.tier_qualification_metric, "nights");
    }
}
