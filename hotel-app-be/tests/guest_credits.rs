#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::core::rbac_cache;
    use hotel_app_be::services::{bookings, guests};
    use serde_json::Value;
    use sqlx::SqlitePool;

    const STAFF_USER_ID: i64 = 771_001;
    const GUEST_USER_ID: i64 = 771_002;
    const AUTHORIZED_STAFF_USER_ID: i64 = 771_003;
    const BOOKING_ONLY_STAFF_USER_ID: i64 = 771_004;
    const UNLINKED_GUEST_USER_ID: i64 = 771_005;
    const LINKED_GUEST_ID: i64 = 771_101;
    const UNLINKED_GUEST_ID: i64 = 771_102;
    const ROOM_TYPE_ID: i64 = 771_201;

    async fn seed_credit_scope(pool: &SqlitePool) {
        sqlx::query(
            "INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission)
             VALUES ('guests:read', 'guests', 'read', 'Read guests', 1),
                    ('bookings:create', 'bookings', 'create', 'Create bookings', 1)",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT OR IGNORE INTO roles (name, display_name, description, is_system_role, priority)
             VALUES ('guest_credit_reader_test', 'Guest Credit Reader Test', 'Test role', 0, 10),
                    ('guest_credit_booker_test', 'Guest Credit Booker Test', 'Test role', 0, 10),
                    ('guest_credit_booking_only_test', 'Guest Credit Booking Only Test', 'Test role', 0, 10)",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id
             FROM roles r
             CROSS JOIN permissions p
             WHERE (r.name = 'guest_credit_reader_test' AND p.name = 'guests:read')
                OR (r.name = 'guest_credit_booker_test' AND p.name IN ('guests:read', 'bookings:create'))
                OR (r.name = 'guest_credit_booking_only_test' AND p.name = 'bookings:create')",
        )
        .execute(pool)
        .await
        .unwrap();

        for (id, uuid, username, email, full_name, user_type) in [
            (
                AUTHORIZED_STAFF_USER_ID,
                "authorized-staff-credit-scope-test",
                "authorized_staff_credit_scope_test",
                "authorized-staff-credit-scope-test@hotel.local",
                "Authorized Staff Credit Scope Test",
                "staff",
            ),
            (
                BOOKING_ONLY_STAFF_USER_ID,
                "booking-only-staff-credit-scope-test",
                "booking_only_staff_credit_scope_test",
                "booking-only-staff-credit-scope-test@hotel.local",
                "Booking Only Staff Credit Scope Test",
                "staff",
            ),
            (
                UNLINKED_GUEST_USER_ID,
                "unlinked-guest-credit-scope-test",
                "unlinked_guest_credit_scope_test",
                "unlinked-guest-credit-scope-test@hotel.local",
                "Unlinked Guest Credit Scope Test",
                "guest",
            ),
        ] {
            sqlx::query(
                "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1)",
            )
            .bind(id)
            .bind(uuid)
            .bind(username)
            .bind(email)
            .bind(full_name)
            .bind(user_type)
            .execute(pool)
            .await
            .unwrap();
        }

        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1)",
        )
        .bind(STAFF_USER_ID)
        .bind("staff-credit-scope-test")
        .bind("staff_credit_scope_test")
        .bind("staff-credit-scope-test@hotel.local")
        .bind("Staff Credit Scope Test")
        .bind("staff")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id)
             SELECT ?1, id FROM roles WHERE name = 'guest_credit_booker_test'",
        )
        .bind(AUTHORIZED_STAFF_USER_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id)
             SELECT ?1, id FROM roles WHERE name = 'guest_credit_booking_only_test'",
        )
        .bind(BOOKING_ONLY_STAFF_USER_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1)",
        )
        .bind(GUEST_USER_ID)
        .bind("guest-credit-scope-test")
        .bind("guest_credit_scope_test")
        .bind("guest-credit-scope-test@hotel.local")
        .bind("Guest Credit Scope Test")
        .bind("guest")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id)
             SELECT ?1, id FROM roles WHERE name = 'guest_credit_reader_test'",
        )
        .bind(STAFF_USER_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO room_types (id, name, code, base_price)
             VALUES (?1, 'Credit Scope Room', 'CSR', 100.0)",
        )
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email)
             VALUES (?1, 'Linked', 'Credit', 'Linked Credit', 'linked-credit@hotel.local')",
        )
        .bind(LINKED_GUEST_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email)
             VALUES (?1, 'Unlinked', 'Credit', 'Unlinked Credit', 'unlinked-credit@hotel.local')",
        )
        .bind(UNLINKED_GUEST_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO user_guests (user_id, guest_id, relationship_type)
             VALUES (?1, ?2, 'self')",
        )
        .bind(GUEST_USER_ID)
        .bind(LINKED_GUEST_ID)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available)
             VALUES (?1, ?2, 2), (?3, ?2, 3)",
        )
        .bind(LINKED_GUEST_ID)
        .bind(ROOM_TYPE_ID)
        .bind(UNLINKED_GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
    }

    fn result_ids(rows: &[Value]) -> Vec<i64> {
        let mut ids: Vec<i64> = rows.iter().filter_map(|row| row["id"].as_i64()).collect();
        ids.sort_unstable();
        ids
    }

    #[tokio::test]
    async fn my_guests_with_credits_expands_scope_for_guest_readers() {
        let pool = super::common::setup_test_db().await;
        seed_credit_scope(&pool).await;
        rbac_cache::invalidate_all();

        let guest_rows = guests::my_guests_with_credits(&pool, GUEST_USER_ID)
            .await
            .unwrap();
        assert_eq!(result_ids(&guest_rows), vec![LINKED_GUEST_ID]);

        let staff_rows = guests::my_guests_with_credits(&pool, STAFF_USER_ID)
            .await
            .unwrap();
        assert_eq!(
            result_ids(&staff_rows),
            vec![LINKED_GUEST_ID, UNLINKED_GUEST_ID]
        );
        assert!(
            staff_rows
                .iter()
                .all(|row| row["total_complimentary_credits"].as_i64().unwrap_or(0) > 0)
        );
    }

    #[tokio::test]
    async fn complimentary_booking_access_supports_linked_guests_and_authorized_staff() {
        let pool = super::common::setup_test_db().await;
        seed_credit_scope(&pool).await;
        rbac_cache::invalidate_all();

        assert!(
            bookings::can_book_with_credits_for_guest(&pool, GUEST_USER_ID, LINKED_GUEST_ID)
                .await
                .unwrap()
        );
        assert!(
            bookings::can_book_with_credits_for_guest(
                &pool,
                AUTHORIZED_STAFF_USER_ID,
                UNLINKED_GUEST_ID,
            )
            .await
            .unwrap()
        );

        assert!(
            !bookings::can_book_with_credits_for_guest(&pool, GUEST_USER_ID, UNLINKED_GUEST_ID,)
                .await
                .unwrap()
        );
        assert!(
            !bookings::can_book_with_credits_for_guest(
                &pool,
                UNLINKED_GUEST_USER_ID,
                UNLINKED_GUEST_ID,
            )
            .await
            .unwrap()
        );
        assert!(
            !bookings::can_book_with_credits_for_guest(&pool, STAFF_USER_ID, UNLINKED_GUEST_ID,)
                .await
                .unwrap()
        );
        assert!(
            !bookings::can_book_with_credits_for_guest(
                &pool,
                BOOKING_ONLY_STAFF_USER_ID,
                UNLINKED_GUEST_ID,
            )
            .await
            .unwrap()
        );
    }
}
