//! SQLite coverage for the promotion voucher claim workflow.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::loyalty::models::ManualAdjustmentInput;
    use hotel_app_be::modules::loyalty::service as loyalty_service;
    use hotel_app_be::modules::promotions::models::{
        ClaimPromotionInput, PromotionInput, PromotionListQuery, VoucherRevokeInput,
    };
    use hotel_app_be::modules::promotions::service;

    async fn seed_guest(pool: &sqlx::SqlitePool, guest_id: i64, email: &str) {
        sqlx::query(
            r#"
            INSERT INTO guests (id, first_name, last_name, full_name, email, phone)
            VALUES (?1, 'Promotion', 'Guest', 'Promotion Guest', ?2, '60123456789')
            "#,
        )
        .bind(guest_id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
    }

    fn query() -> PromotionListQuery {
        PromotionListQuery {
            page: None,
            page_size: None,
            status: None,
            search: None,
        }
    }

    fn promotion_input(
        slug: &str,
        claim_limit: Option<i64>,
        promotion_kind: &str,
    ) -> PromotionInput {
        PromotionInput {
            slug: slug.to_string(),
            name: "Summer savings voucher".to_string(),
            description: Some("A guest-claimable summer stay discount.".to_string()),
            terms: Some("Valid for an eligible future hotel stay.".to_string()),
            promotion_kind: promotion_kind.to_string(),
            discount_type: "percentage".to_string(),
            discount_value: 15.0,
            max_discount_amount: Some(50.0),
            currency: Some("USD".to_string()),
            claim_starts_at: None,
            claim_ends_at: None,
            stay_starts_on: None,
            stay_ends_on: None,
            min_nights: None,
            max_nights: None,
            min_subtotal: Some(0.0),
            claim_limit,
            per_guest_limit: Some(1),
            is_public: Some(true),
            is_cancellable: None,
            room_type_ids: None,
            expected_version: None,
        }
    }

    async fn create_published_voucher_promotion(
        pool: &sqlx::SqlitePool,
        slug: &str,
        claim_limit: Option<i64>,
    ) -> hotel_app_be::modules::promotions::models::Promotion {
        let draft = service::create_admin_promotion(
            pool,
            1,
            promotion_input(slug, claim_limit, "voucher"),
            None,
            None,
        )
        .await
        .unwrap();

        service::publish_admin_promotion(pool, 1, draft.id, Some(draft.version), None, None)
            .await
            .unwrap()
    }

    async fn create_published_deal_promotion(
        pool: &sqlx::SqlitePool,
        slug: &str,
    ) -> hotel_app_be::modules::promotions::models::Promotion {
        let draft = service::create_admin_promotion(
            pool,
            1,
            promotion_input(slug, None, "deal"),
            None,
            None,
        )
        .await
        .unwrap();

        service::publish_admin_promotion(pool, 1, draft.id, Some(draft.version), None, None)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn admin_lifecycle_publishes_a_valid_campaign_and_rejects_unenforceable_limits() {
        let pool = common::setup_test_db().await;

        let mut invalid_input = promotion_input("invalid-per-guest-limit", Some(3), "voucher");
        invalid_input.per_guest_limit = Some(2);
        let invalid_error = service::create_admin_promotion(&pool, 1, invalid_input, None, None)
            .await
            .unwrap_err();
        assert!(matches!(
            invalid_error,
            ApiError::BadRequest(message)
                if message == "Per-guest limit is currently limited to one voucher per promotion"
        ));
        assert_eq!(
            service::list_admin_promotions(&pool, query())
                .await
                .unwrap()
                .total,
            1
        );

        let draft = service::create_admin_promotion(
            &pool,
            1,
            promotion_input("admin-published-voucher", Some(3), "voucher"),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(draft.status, "draft");
        assert_eq!(draft.promotion_kind, "voucher");
        assert_eq!(draft.claim_limit, Some(3));
        assert_eq!(draft.claimed_count, 0);
        assert_eq!(draft.version, 1);

        let published =
            service::publish_admin_promotion(&pool, 1, draft.id, Some(draft.version), None, None)
                .await
                .unwrap();
        assert_eq!(published.status, "published");
        assert_eq!(published.version, draft.version + 1);

        let public = service::list_public_promotions(&pool, query())
            .await
            .unwrap();
        assert!(public.items.iter().any(|item| item.id == published.id));
    }

    #[tokio::test]
    async fn guest_activation_welcome_voucher_is_idempotent_and_deluxe_only() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99699, "welcome-voucher@example.com").await;

        let first = service::issue_welcome_deluxe_voucher(&pool, 99699)
            .await
            .unwrap();
        let second = service::issue_welcome_deluxe_voucher(&pool, 99699)
            .await
            .unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(first.status, "available");
        assert_eq!(first.promotion_slug, "welcome-deluxe-10");

        let promotion = service::get_admin_promotion(&pool, first.promotion_id)
            .await
            .unwrap();
        assert_eq!(promotion.discount_type, "percentage");
        assert_eq!(promotion.discount_value, 10.0);
        assert!(!promotion.is_public);
        assert_eq!(promotion.room_type_ids.len(), 1);

        let room_type_code: String =
            sqlx::query_scalar("SELECT code FROM room_types WHERE id = ?1")
                .bind(promotion.room_type_ids[0])
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(room_type_code, "DLX");
    }

    #[tokio::test]
    async fn guest_claim_is_idempotent_and_wallet_reveals_only_its_owner_code() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99701, "promotion-owner@example.com").await;
        let promotion =
            create_published_voucher_promotion(&pool, "summer-owner-voucher", Some(2)).await;
        assert_eq!(promotion.status, "published");

        let before_claim = service::list_guest_promotions(&pool, 99701, query())
            .await
            .unwrap();
        let visible = before_claim
            .items
            .iter()
            .find(|item| item.promotion.id == promotion.id)
            .expect("published public voucher promotion should be visible to the guest");
        assert!(visible.can_claim);
        assert!(!visible.has_voucher);

        let first = service::claim_guest_promotion(
            &pool,
            99701,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-claim-owner-a".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();
        let raw_code = first
            .code
            .clone()
            .expect("guest claim response includes code");
        assert_eq!(first.guest_id, 99701);
        assert_eq!(first.status, "available");
        assert_eq!(first.source, "guest_claim");
        assert_eq!(
            first.code_masked,
            format!("••••{}", &raw_code[raw_code.len() - 4..])
        );

        let replay = service::claim_guest_promotion(
            &pool,
            99701,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-claim-owner-b".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(replay.id, first.id);
        assert_eq!(replay.code.as_deref(), Some(raw_code.as_str()));

        let after_claim = service::list_guest_promotions(&pool, 99701, query())
            .await
            .unwrap();
        let claimed = after_claim
            .items
            .iter()
            .find(|item| item.promotion.id == promotion.id)
            .expect("promotion remains visible while it has claim capacity");
        assert!(!claimed.can_claim);
        assert!(claimed.has_voucher);

        let wallet = service::list_guest_vouchers(&pool, 99701, query())
            .await
            .unwrap();
        assert_eq!(wallet.total, 1);
        assert_eq!(wallet.items[0].id, first.id);
        assert_eq!(wallet.items[0].code.as_deref(), Some(raw_code.as_str()));

        let staff_vouchers = service::list_admin_vouchers(&pool, query()).await.unwrap();
        let staff_view = staff_vouchers
            .items
            .iter()
            .find(|voucher| voucher.id == first.id)
            .expect("staff list contains the claimed voucher");
        assert_eq!(staff_view.code, None);
        assert_eq!(staff_view.code_masked, first.code_masked);

        let refreshed = service::get_admin_promotion(&pool, promotion.id)
            .await
            .unwrap();
        assert_eq!(refreshed.claimed_count, 1);
    }

    #[tokio::test]
    async fn claim_limit_blocks_new_guests_without_breaking_replay_for_the_owner() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99711, "promotion-limit-owner@example.com").await;
        seed_guest(&pool, 99712, "promotion-limit-other@example.com").await;
        let promotion =
            create_published_voucher_promotion(&pool, "one-claim-voucher", Some(1)).await;

        let claim_result = service::claim_guest_promotion(
            &pool,
            99711,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-limit-owner-a".to_string()),
            },
            None,
            None,
        )
        .await;
        if let Err(error) = &claim_result {
            let raw_state: (String, Option<i64>, i64) = sqlx::query_as(
                "SELECT status, claim_limit, claimed_count FROM promotions WHERE id = ?1",
            )
            .bind(promotion.id)
            .fetch_one(&pool)
            .await
            .unwrap();
            panic!("deal claim failed with {error:?}; raw promotion state: {raw_state:?}");
        }
        let claimed = claim_result.unwrap();

        // A client retry after the final capacity was reserved must still return
        // the owner's existing entitlement rather than treating it as a new claim.
        let replay = service::claim_guest_promotion(
            &pool,
            99711,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-limit-owner-b".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(replay.id, claimed.id);

        let other_guest_error = service::claim_guest_promotion(
            &pool,
            99712,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-limit-other-a".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(other_guest_error, ApiError::Conflict(_)));

        let refreshed = service::get_admin_promotion(&pool, promotion.id)
            .await
            .unwrap();
        assert_eq!(refreshed.claimed_count, 1);

        let other_wallet = service::list_guest_vouchers(&pool, 99712, query())
            .await
            .unwrap();
        assert_eq!(other_wallet.total, 0);
    }

    #[tokio::test]
    async fn revoked_voucher_remains_visible_to_its_guest_but_staff_never_receives_its_code() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99716, "promotion-revocation-owner@example.com").await;
        let promotion =
            create_published_voucher_promotion(&pool, "revocable-voucher", Some(2)).await;

        let claimed = service::claim_guest_promotion(
            &pool,
            99716,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-revocation-claim".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();
        let raw_code = claimed.code.clone().expect("guest claims receive a code");

        let revoked = service::revoke_admin_voucher(
            &pool,
            1,
            claimed.id,
            VoucherRevokeInput {
                reason: Some("Campaign withdrawn".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(revoked.status, "revoked");
        assert_eq!(revoked.code, None);
        assert_eq!(revoked.code_masked, claimed.code_masked);
        assert!(revoked.revoked_at.is_some());

        let wallet = service::list_guest_vouchers(&pool, 99716, query())
            .await
            .unwrap();
        let guest_view = wallet
            .items
            .iter()
            .find(|voucher| voucher.id == claimed.id)
            .expect("revoked voucher remains in its owner’s history");
        assert_eq!(guest_view.status, "revoked");
        assert_eq!(guest_view.code.as_deref(), Some(raw_code.as_str()));
        assert_eq!(guest_view.code_masked, claimed.code_masked);
        assert!(guest_view.revoked_at.is_some());

        let staff = service::list_admin_vouchers(&pool, query()).await.unwrap();
        let staff_view = staff
            .items
            .iter()
            .find(|voucher| voucher.id == claimed.id)
            .expect("staff can see voucher state without receiving the raw code");
        assert_eq!(staff_view.status, "revoked");
        assert_eq!(staff_view.code, None);
        assert_eq!(staff_view.code_masked, claimed.code_masked);

        let stored: (String, Option<i64>, Option<String>) = sqlx::query_as(
            "SELECT status, revoked_by, revocation_reason FROM vouchers WHERE id = ?1",
        )
        .bind(claimed.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.0, "revoked");
        assert_eq!(stored.1, Some(1));
        assert_eq!(stored.2.as_deref(), Some("Campaign withdrawn"));

        let repeated_revoke = service::revoke_admin_voucher(
            &pool,
            1,
            claimed.id,
            VoucherRevokeInput { reason: None },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(repeated_revoke, ApiError::Conflict(_)));
    }

    #[tokio::test]
    async fn deal_campaigns_are_claimed_as_guest_bound_vouchers() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99721, "promotion-deal-owner@example.com").await;
        let promotion = create_published_deal_promotion(&pool, "summer-deal-voucher").await;

        // An omitted claim limit is unlimited; retain this assertion because a
        // NULL-to-zero mapping here would silently turn every deal into a
        // zero-capacity campaign.
        let stored_limit: Option<i64> =
            sqlx::query_scalar("SELECT claim_limit FROM promotions WHERE id = ?1")
                .bind(promotion.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_limit, None);
        assert_eq!(promotion.claim_limit, None);
        assert_eq!(promotion.claimed_count, 0);

        let catalogue = service::list_guest_promotions(&pool, 99721, query())
            .await
            .unwrap();
        let listed_deal = catalogue
            .items
            .iter()
            .find(|item| item.promotion.id == promotion.id)
            .expect("published deal campaign should be visible to the guest");
        assert!(listed_deal.can_claim);
        assert!(!listed_deal.has_voucher);

        let claimed = service::claim_guest_promotion(
            &pool,
            99721,
            promotion.id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-deal-claim-a".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(claimed.promotion_id, promotion.id);
        assert_eq!(claimed.guest_id, 99721);
        assert_eq!(claimed.source, "guest_claim");
        assert!(claimed.code.is_some());
    }

    #[tokio::test]
    async fn july_loyalty_promotion_claim_uses_supported_voucher_source() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 99722, "promotion-loyalty-owner@example.com").await;
        let member = loyalty_service::ensure_member_for_guest(&pool, 99722)
            .await
            .unwrap();
        loyalty_service::manual_adjustment(
            &pool,
            1,
            member.id,
            ManualAdjustmentInput {
                points_delta: 2_000,
                reason: "July loyalty voucher test balance".to_string(),
                allow_negative_balance: None,
            },
        )
        .await
        .unwrap();

        let promotion_id: i64 =
            sqlx::query_scalar("SELECT id FROM promotions WHERE slug = 'july-deluxe-20-loyalty'")
                .fetch_one(&pool)
                .await
                .unwrap();

        let claimed = service::claim_guest_promotion(
            &pool,
            99722,
            promotion_id,
            ClaimPromotionInput {
                client_request_id: Some("promotion-loyalty-claim".to_string()),
            },
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(claimed.promotion_id, promotion_id);
        assert_eq!(claimed.guest_id, 99722);
        assert_eq!(claimed.source, "guest_claim");
        assert!(claimed.code.is_some());
    }
}
