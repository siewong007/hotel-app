//! Integration tests for maintenance ticket workflows (WP-5).
//!
//! SQLite-backed tests are gated so the default PostgreSQL build is not forced
//! to create a database.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::models::{
        CreateMaintenanceTicketRequest, ListMaintenanceTicketsQuery, UpdateMaintenanceTicketRequest,
    };
    use hotel_app_be::services::maintenance::{create_ticket, get_ticket, list_tickets, update_ticket};

    /// admin user id=1 is seeded by the SQLite migrations (001_initial_schema.sql).
    const USER_ID: i64 = 1;

    async fn seed_room(pool: &sqlx::SqlitePool, room_id: i64, room_number: &str) {
        sqlx::query(
            "INSERT INTO room_types (id, name, code, description, base_price, max_occupancy)
             VALUES (8901, 'Maintenance Test Type', 'MTT', 'Test room type', 100.0, 2)",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "INSERT INTO rooms
             (id, room_number, room_type_id, status, is_active, created_at, updated_at)
             VALUES (?1, ?2, 8901, 'available', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(room_id)
        .bind(room_number)
        .execute(pool)
        .await
        .unwrap();
    }

    fn minimal_create_request(room_id: Option<i64>) -> CreateMaintenanceTicketRequest {
        CreateMaintenanceTicketRequest {
            room_id,
            title: "Leaky faucet".to_string(),
            description: None,
            category: None,
            priority: None,
            assigned_to: None,
            estimated_cost: None,
            estimated_hours: None,
            scheduled_date: None,
            images: None,
        }
    }

    #[tokio::test]
    async fn create_ticket_assigns_sequential_ticket_number_and_defaults() {
        let pool = common::setup_test_db().await;
        seed_room(&pool, 8801, "M101").await;

        let first = create_ticket(&pool, USER_ID, minimal_create_request(Some(8801)))
            .await
            .expect("first ticket should be created");

        assert!(
            regex_like_match(&first.ticket_number),
            "unexpected ticket number: {}",
            first.ticket_number
        );
        assert!(first.ticket_number.ends_with("-0001"));
        assert_eq!(first.status, "open");
        assert_eq!(first.priority, "medium");
        assert_eq!(first.category, "other");

        let second = create_ticket(&pool, USER_ID, minimal_create_request(Some(8801)))
            .await
            .expect("second ticket should be created");

        assert!(second.ticket_number.ends_with("-0002"));
    }

    /// Matches `^MT-\d{6}-\d{4}$` without pulling in the `regex` crate.
    fn regex_like_match(value: &str) -> bool {
        let Some(rest) = value.strip_prefix("MT-") else {
            return false;
        };
        let Some((yyyymm, seq)) = rest.split_once('-') else {
            return false;
        };
        yyyymm.len() == 6
            && yyyymm.chars().all(|c| c.is_ascii_digit())
            && seq.len() == 4
            && seq.chars().all(|c| c.is_ascii_digit())
    }

    #[tokio::test]
    async fn list_tickets_filters_by_status_and_category() {
        let pool = common::setup_test_db().await;
        seed_room(&pool, 8802, "M102").await;

        let mut open_req = minimal_create_request(Some(8802));
        open_req.category = Some("plumbing".to_string());
        let open_ticket = create_ticket(&pool, USER_ID, open_req)
            .await
            .expect("plumbing ticket should be created");

        let mut electrical_req = minimal_create_request(Some(8802));
        electrical_req.category = Some("electrical".to_string());
        electrical_req.title = "Flickering lights".to_string();
        let electrical_ticket = create_ticket(&pool, USER_ID, electrical_req)
            .await
            .expect("electrical ticket should be created");

        // Move the electrical ticket to in_progress so status filtering has
        // something to distinguish.
        update_ticket(
            &pool,
            USER_ID,
            electrical_ticket.id,
            UpdateMaintenanceTicketRequest {
                title: None,
                description: None,
                category: None,
                priority: None,
                status: Some("in_progress".to_string()),
                assigned_to: None,
                estimated_cost: None,
                actual_cost: None,
                estimated_hours: None,
                actual_hours: None,
                scheduled_date: None,
                resolution_notes: None,
                images: None,
            },
        )
        .await
        .expect("status transition to in_progress should succeed");

        let by_status = list_tickets(
            &pool,
            ListMaintenanceTicketsQuery {
                status: Some("open".to_string()),
                room_id: None,
                assigned_to: None,
                category: None,
                priority: None,
                page: None,
                page_size: None,
            },
        )
        .await
        .expect("list by status should succeed");
        let status_ids: Vec<i64> = by_status.items.iter().map(|t| t.id).collect();
        assert!(status_ids.contains(&open_ticket.id));
        assert!(!status_ids.contains(&electrical_ticket.id));

        let by_category = list_tickets(
            &pool,
            ListMaintenanceTicketsQuery {
                status: None,
                room_id: None,
                assigned_to: None,
                category: Some("electrical".to_string()),
                priority: None,
                page: None,
                page_size: None,
            },
        )
        .await
        .expect("list by category should succeed");
        let category_ids: Vec<i64> = by_category.items.iter().map(|t| t.id).collect();
        assert!(category_ids.contains(&electrical_ticket.id));
        assert!(!category_ids.contains(&open_ticket.id));
    }

    #[tokio::test]
    async fn update_ticket_transitions_to_resolved_and_sets_resolved_at() {
        let pool = common::setup_test_db().await;
        seed_room(&pool, 8803, "M103").await;

        let ticket = create_ticket(&pool, USER_ID, minimal_create_request(Some(8803)))
            .await
            .expect("ticket should be created");
        assert!(ticket.resolved_at.is_none());

        let in_progress = update_ticket(
            &pool,
            USER_ID,
            ticket.id,
            UpdateMaintenanceTicketRequest {
                title: None,
                description: None,
                category: None,
                priority: None,
                status: Some("in_progress".to_string()),
                assigned_to: None,
                estimated_cost: None,
                actual_cost: None,
                estimated_hours: None,
                actual_hours: None,
                scheduled_date: None,
                resolution_notes: None,
                images: None,
            },
        )
        .await
        .expect("open -> in_progress should succeed");
        assert_eq!(in_progress.status, "in_progress");
        assert!(in_progress.started_at.is_some());
        assert!(in_progress.resolved_at.is_none());

        let resolved = update_ticket(
            &pool,
            USER_ID,
            ticket.id,
            UpdateMaintenanceTicketRequest {
                title: None,
                description: None,
                category: None,
                priority: None,
                status: Some("resolved".to_string()),
                assigned_to: None,
                estimated_cost: None,
                actual_cost: None,
                estimated_hours: None,
                actual_hours: None,
                scheduled_date: None,
                resolution_notes: None,
                images: None,
            },
        )
        .await
        .expect("in_progress -> resolved should succeed");
        assert_eq!(resolved.status, "resolved");
        assert!(resolved.resolved_at.is_some());
    }

    #[tokio::test]
    async fn update_ticket_rejects_illegal_status_transition() {
        let pool = common::setup_test_db().await;
        seed_room(&pool, 8804, "M104").await;

        let ticket = create_ticket(&pool, USER_ID, minimal_create_request(Some(8804)))
            .await
            .expect("ticket should be created");
        assert_eq!(ticket.status, "open");

        let result = update_ticket(
            &pool,
            USER_ID,
            ticket.id,
            UpdateMaintenanceTicketRequest {
                title: None,
                description: None,
                category: None,
                priority: None,
                status: Some("resolved".to_string()),
                assigned_to: None,
                estimated_cost: None,
                actual_cost: None,
                estimated_hours: None,
                actual_hours: None,
                scheduled_date: None,
                resolution_notes: None,
                images: None,
            },
        )
        .await;

        assert!(
            result.is_err(),
            "open -> resolved should be rejected, got: {result:?}"
        );
    }

    #[tokio::test]
    async fn get_ticket_returns_not_found_for_unknown_id() {
        let pool = common::setup_test_db().await;

        let result = get_ticket(&pool, 999_999).await;

        assert!(
            matches!(result, Err(hotel_app_be::core::error::ApiError::NotFound(_))),
            "expected NotFound, got: {result:?}"
        );
    }
}
