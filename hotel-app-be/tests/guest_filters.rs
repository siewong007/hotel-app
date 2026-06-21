#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::GuestPaginationParams;
    use hotel_app_be::repositories::guest::GuestRepository;
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
}
