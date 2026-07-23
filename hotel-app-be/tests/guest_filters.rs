#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::GuestPaginationParams;
    use hotel_app_be::repositories::guest::GuestRepository;
    use hotel_app_be::repositories::search::SearchRepository;
    use hotel_app_be::utils::pagination::normalize_pagination;
    use sqlx::SqlitePool;

    async fn seed_guests(pool: &SqlitePool) {
        sqlx::query(
            r#"
            INSERT INTO guests
                (id, first_name, last_name, full_name, email, phone, ic_number, company_name, guest_type, tourism_type)
            VALUES
                (8101, 'Alice', 'Member', 'Alice Member', 'alice@example.com', '60111111111', 'A111', 'Acme', 'member', 'foreign'),
                (8102, 'Bob', 'Local', 'Bob Local', ' ', '60222222222', 'B222', 'Beta', 'non_member', 'local'),
                (8103, 'Cara', 'Tourist', 'Cara Tourist', 'cara@example.com', '60333333333', 'C333', 'Cobalt', 'non_member', 'foreign'),
                (8104, 'Dan', 'Member', 'Dan Member', 'dan@example.com', '60444444444', 'D444', NULL, 'member', 'local'),
                (8105, 'Erin', 'NoContact', 'Erin NoContact', ' ', ' ', 'E555', NULL, 'non_member', 'local'),
                (8106, 'Finn', 'NoIc', 'Finn NoIc', 'finn@example.com', '60666666666', ' ', NULL, 'non_member', 'local')
            "#,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    fn params() -> GuestPaginationParams {
        GuestPaginationParams {
            page: Some(1),
            page_size: Some(20),
            search: None,
            guest_type: None,
            tourism_type: None,
            missing_tourism: None,
            missing_info: None,
        }
    }

    async fn filtered_ids(pool: &SqlitePool, params: GuestPaginationParams) -> (i64, Vec<i64>) {
        let pagination = normalize_pagination(params.page, params.page_size, 100, 500);
        let (total, guests) = GuestRepository::find_paginated(pool, &params, pagination)
            .await
            .unwrap();
        let ids = guests.into_iter().map(|guest| guest.id).collect();
        (total, ids)
    }

    async fn seed_guest_account(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, guest_id, is_active, is_verified) \
             VALUES \
                (8201, 'guest2-user-uuid', 'guest2', 'guest2@example.com', 'Portal Guest', 'guest', 8101, 1, 1), \
                (8202, 'inactive-user-uuid', 'inactive-guest', 'inactive@example.com', 'Inactive Portal Guest', 'guest', 8102, 0, 1)",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn guest_list_filters_and_totals_apply_to_full_result_set() {
        let pool = super::common::setup_test_db().await;
        seed_guests(&pool).await;

        let mut member_params = params();
        member_params.guest_type = Some("member".to_string());
        assert_eq!(
            filtered_ids(&pool, member_params).await,
            (2, vec![8101, 8104])
        );

        let mut non_member_params = params();
        non_member_params.guest_type = Some("non_member".to_string());
        assert_eq!(
            filtered_ids(&pool, non_member_params).await,
            (4, vec![8102, 8103, 8105, 8106])
        );

        let mut tourist_params = params();
        tourist_params.tourism_type = Some("foreign".to_string());
        assert_eq!(
            filtered_ids(&pool, tourist_params).await,
            (2, vec![8101, 8103])
        );

        let mut missing_info_params = params();
        missing_info_params.missing_info = Some(true);
        assert_eq!(
            filtered_ids(&pool, missing_info_params).await,
            (2, vec![8105, 8106])
        );

        let mut searched_missing_params = params();
        searched_missing_params.search = Some("Finn".to_string());
        searched_missing_params.missing_info = Some(true);
        assert_eq!(
            filtered_ids(&pool, searched_missing_params).await,
            (1, vec![8106])
        );
    }

    #[tokio::test]
    async fn guest_searches_match_linked_account_username() {
        let pool = super::common::setup_test_db().await;
        seed_guests(&pool).await;
        seed_guest_account(&pool).await;

        let mut guest_list_params = params();
        guest_list_params.search = Some("guest2".to_string());
        assert_eq!(
            filtered_ids(&pool, guest_list_params).await,
            (1, vec![8101])
        );

        let pagination = normalize_pagination(Some(1), Some(20), 100, 500);
        let (_, guests) = GuestRepository::find_paginated(
            &pool,
            &GuestPaginationParams {
                search: Some("guest2".to_string()),
                ..params()
            },
            pagination,
        )
        .await
        .unwrap();
        assert_eq!(guests[0].account_username.as_deref(), Some("guest2"));
        assert_eq!(guests[0].account_is_active, Some(true));

        let (_, guests) = GuestRepository::find_paginated(
            &pool,
            &GuestPaginationParams {
                search: Some("Bob Local".to_string()),
                ..params()
            },
            pagination,
        )
        .await
        .unwrap();
        assert_eq!(
            guests[0].account_username.as_deref(),
            Some("inactive-guest")
        );
        assert_eq!(guests[0].account_is_active, Some(false));

        let hits = SearchRepository::search_guests(&pool, "%guest2%", 6)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, 8101);
    }

    #[tokio::test]
    async fn staff_can_transfer_an_active_portal_account_to_an_active_guest_only() {
        let pool = super::common::setup_test_db().await;
        seed_guests(&pool).await;
        seed_guest_account(&pool).await;
        sqlx::query(
            "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
             VALUES (8101, 'transfer-test-token', '2099-01-01 00:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let transfer = GuestRepository::transfer_portal_account(&pool, 8103, "guest2")
            .await
            .unwrap();
        assert_eq!(transfer.user_id, 8201);
        assert_eq!(transfer.previous_guest_id, Some(8101));

        let pagination = normalize_pagination(Some(1), Some(20), 100, 500);
        let (_, guests) = GuestRepository::find_paginated(
            &pool,
            &GuestPaginationParams {
                search: Some("guest2".to_string()),
                ..params()
            },
            pagination,
        )
        .await
        .unwrap();
        assert_eq!(guests[0].id, 8103);
        assert_eq!(guests[0].account_is_active, Some(true));
        let remaining_sessions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM guest_portal_sessions WHERE guest_id = 8101")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining_sessions, 0);

        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, guest_id, is_active, is_verified) \
             VALUES (8203, 'other-user-uuid', 'other-guest', 'other@example.com', 'Other Guest', 'guest', 8104, 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            GuestRepository::transfer_portal_account(&pool, 8103, "other-guest")
                .await
                .is_err()
        );

        sqlx::query("UPDATE guests SET is_active = 0 WHERE id = 8102")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            GuestRepository::transfer_portal_account(&pool, 8102, "guest2")
                .await
                .is_err()
        );
    }
}
