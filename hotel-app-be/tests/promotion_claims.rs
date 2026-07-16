//! SQLite coverage for the promotion voucher claim workflow.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::promotions::models::{
        ClaimPromotionInput, PromotionInput, PromotionListQuery,
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
            min_nights: Some(1),
            max_nights: None,
            min_subtotal: Some(0.0),
            claim_limit,
            per_guest_limit: Some(1),
            is_public: Some(true),
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
}
