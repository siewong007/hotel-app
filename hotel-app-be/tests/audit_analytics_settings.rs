//! Integration tests for audit logging, analytics report queries, night
//! audit, system settings, global search, and booking channels.
//!
//! All six domains had zero integration coverage before this file (see
//! `.claude/reports/be-test-coverage-2026-07-26.md` Part A/E). The analytics
//! company-ledger-statement report in particular shipped a runtime decode
//! panic for four days because nothing ever fetched it end-to-end (lesson
//! 2026-07-26d in `.claude/rules/lessons.md`, root-caused to
//! `repositories/analytics.rs` around the `customer_ledgers` /
//! `customer_ledger_payments` reads inside `generate_company_ledger_statement`)
//! -- `analytics_company_ledger_statement_decodes_ledger_and_payment_timestamps`
//! below is a regression guard for exactly that path.
//!
//! Tests exercise the service/repository layer directly (not HTTP) against a
//! live PostgreSQL database, gracefully skipping when `DATABASE_URL` is
//! unset. Fixture id ranges (never touched by any other test file):
//!   - users:               990_0xx
//!   - bookings:            990_1xx
//!   - guests:              990_2xx
//!   - rooms:               990_3xx
//!   - room_types:          990_4xx
//!   - ledgers / misc:      990_5xx
//!
//! String-keyed fixtures (booking channels, system settings, audit log
//! resource types/actions) are prefixed `aud990`/`AUD990` instead.

mod postgres_tests {
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        AuditEvent, AuditLogQuery, BookingChannelInput, BookingChannelUpdate, ReportQuery,
        RunNightAuditRequest,
    };
    use hotel_app_be::modules::settings::models::SystemSettingUpdate;
    use hotel_app_be::modules::settings::repository::SettingsRepository;
    use hotel_app_be::modules::settings::service as settings_service;
    use hotel_app_be::repositories::analytics as analytics_repo;
    use hotel_app_be::repositories::audit::AuditRepository;
    use hotel_app_be::repositories::search::SearchRepository;
    use hotel_app_be::services::audit as audit_service;
    use hotel_app_be::services::audit::AuditLog;
    use hotel_app_be::services::booking_channels as booking_channels_service;
    use hotel_app_be::services::night_audit as night_audit_service;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping PostgreSQL audit/analytics/settings test because DATABASE_URL is not set"
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

    /// Extract a `rust_decimal::Decimal` out of a `serde_json::Value` produced
    /// by embedding a `Decimal` directly in a `serde_json::json!` call.
    /// Handles both plain-string and (arbitrary-precision) numeric
    /// representations so the assertion doesn't depend on which serde mode
    /// `rust_decimal`'s optional feature set resolves to in this workspace.
    fn json_decimal(value: &serde_json::Value) -> Decimal {
        match value {
            serde_json::Value::String(s) => {
                s.parse().unwrap_or_else(|e| panic!("'{s}' is not decimal-shaped: {e}"))
            }
            serde_json::Value::Number(n) => n
                .to_string()
                .parse()
                .unwrap_or_else(|e| panic!("'{n}' is not decimal-shaped: {e}")),
            other => panic!("expected a decimal-like JSON value, got {other:?}"),
        }
    }

    async fn upsert_actor(pool: &PgPool, user_id: i64, prefix: &str) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                username = EXCLUDED.username, \
                email = EXCLUDED.email, \
                full_name = EXCLUDED.full_name, \
                is_active = true, \
                is_verified = true",
        )
        .bind(user_id)
        .bind(format!("{prefix}_{user_id}"))
        .bind(format!("{prefix}-{user_id}@hotel.local"))
        .bind(format!("Aud990 Actor {user_id}"))
        .execute(pool)
        .await
        .expect("seeding the actor user must succeed");
    }

    async fn cleanup_ledger_fixture(pool: &PgPool, ledger_id: i64) {
        sqlx::query("DELETE FROM customer_ledger_payments WHERE ledger_id = $1")
            .bind(ledger_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM customer_ledgers WHERE id = $1")
            .bind(ledger_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn cleanup_booking_fixture(
        pool: &PgPool,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        room_type_id: i64,
    ) {
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        // The `trg_sync_room_status_booking` AFTER INSERT trigger writes a
        // room_status_change_log row for our fixture room (no ON DELETE
        // CASCADE on that FK) -- must be cleared before the room itself.
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_events WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
    }

    // -----------------------------------------------------------------
    // Regression: audit rows carrying a non-null `ip_address` must be
    // readable. `audit_logs.ip_address` is `inet`; the INSERT casts
    // (`$6::inet`) but both SELECTs used to read it back bare into
    // `Option<String>`, which sqlx cannot decode from INET without the
    // `ipnetwork` feature. Every row written so far had a NULL ip, so the
    // audit viewer worked -- until the PayPal webhook handler started
    // writing a real address, at which point the list and the CSV export
    // both 500 for good. Fixture ids use the `991_xxx` block.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn audit_rows_with_a_non_null_ip_address_are_readable() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 991_001;
        let resource_type = "aud991_inet_resource";

        async fn cleanup(pool: &PgPool, user_id: i64, resource_type: &str) {
            sqlx::query("DELETE FROM audit_logs WHERE resource_type = $1 AND user_id = $2")
                .bind(resource_type)
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
        }

        cleanup(&pool, user_id, resource_type).await;
        upsert_actor(&pool, user_id, "aud991_inet_actor").await;

        AuditLog::log_event(
            &pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "aud991_with_ip",
                resource_type,
                resource_id: Some(user_id),
                ip_address: Some("203.0.113.42".to_string()),
                user_agent: Some("regression-test/1.0".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("writing an audit row with an ip_address must succeed");

        let params = AuditLogQuery {
            user_id: Some(user_id),
            ..Default::default()
        };

        // The list path: this is what `GET /api/audit-logs` runs.
        let (total, rows) =
            AuditRepository::list_logs(&pool, &params, None, "created_at", "DESC", 50, 0)
                .await
                .expect("listing audit logs with a non-null inet row must not fail to decode");
        assert!(total >= 1, "the seeded row must be counted, got {total}");
        let row = rows
            .iter()
            .find(|r| r.action == "aud991_with_ip")
            .expect("the seeded row must come back from list_logs");
        assert_eq!(
            row.ip_address.as_deref(),
            Some("203.0.113.42"),
            "host() must render the inet as a bare address, unchanged in shape"
        );

        // The export path: same SELECT, separate function, same bug class.
        let exported = AuditRepository::list_logs_for_export(&pool, &params, None)
            .await
            .expect("exporting audit logs with a non-null inet row must not fail to decode");
        assert!(
            exported.iter().any(|r| r.action == "aud991_with_ip"),
            "the seeded row must appear in the CSV export query"
        );

        cleanup(&pool, user_id, resource_type).await;
    }

    // -----------------------------------------------------------------
    // 1. Audit logging: log_event persistence + action-only vs
    //    field-change classification + user/resource/date filtering.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn audit_log_event_persists_and_classifies_action_only_vs_field_change() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 990_001;
        let resource_type = "aud990_test_resource";

        async fn cleanup(pool: &PgPool, user_id: i64, resource_type: &str) {
            sqlx::query("DELETE FROM audit_logs WHERE resource_type = $1 AND user_id = $2")
                .bind(resource_type)
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
        }

        cleanup(&pool, user_id, resource_type).await;
        upsert_actor(&pool, user_id, "aud990_audit_actor").await;

        AuditLog::log_event(
            &pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "aud990_action_only",
                resource_type,
                resource_id: Some(user_id),
                details: None,
                ..Default::default()
            },
        )
        .await
        .expect("action-only log_event must not error");

        AuditLog::log_event(
            &pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "aud990_field_change",
                resource_type,
                resource_id: Some(user_id),
                details: Some(serde_json::json!({"old_value": "A", "new_value": "B"})),
                ..Default::default()
            },
        )
        .await
        .expect("field-change log_event must not error");

        let start_date = (Utc::now() - Duration::hours(1)).to_rfc3339();
        let end_date = (Utc::now() + Duration::hours(1)).to_rfc3339();

        let response = audit_service::get_audit_logs(
            &pool,
            AuditLogQuery {
                user_id: Some(user_id),
                action: None,
                resource_type: Some(resource_type.to_string()),
                category: None,
                start_date: Some(start_date),
                end_date: Some(end_date),
                search: None,
                page: None,
                page_size: None,
                sort_by: Some("id".to_string()),
                sort_order: Some("asc".to_string()),
            },
        )
        .await
        .expect("get_audit_logs must succeed");

        assert_eq!(
            response.data.len(),
            2,
            "expected exactly the two seeded rows scoped by user_id + resource_type + date range: {:?}",
            response.data
        );

        let action_only = response
            .data
            .iter()
            .find(|entry| entry.action == "aud990_action_only")
            .expect("action-only row must be present");
        assert!(!action_only.has_changes);
        assert_eq!(action_only.change_kind, "action_only");
        assert_eq!(action_only.category, "other");

        let field_change = response
            .data
            .iter()
            .find(|entry| entry.action == "aud990_field_change")
            .expect("field-change row must be present");
        assert!(field_change.has_changes);
        assert_eq!(field_change.change_kind, "field_change");

        cleanup(&pool, user_id, resource_type).await;
    }

    // -----------------------------------------------------------------
    // 2. Analytics REGRESSION guard: company_ledger_statement reads
    //    customer_ledgers / customer_ledger_payments timestamptz columns.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn analytics_company_ledger_statement_decodes_ledger_and_payment_timestamps() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let ledger_id: i64 = 990_501;
        let payment_id: i64 = 990_502;
        let company_name = "AUD990 Analytics Co";
        let invoice_number = "aud990-inv-501";
        // customer_ledgers.valid_status allows 'void' (not 'voided'); this row
        // must be EXCLUDED from both report shapes, or its 150.00 balance
        // corrupts every aggregate asserted below.
        let void_ledger_id: i64 = 990_503;
        let void_invoice_number = "aud990-inv-503-void";

        cleanup_ledger_fixture(&pool, ledger_id).await;
        cleanup_ledger_fixture(&pool, void_ledger_id).await;

        sqlx::query(
            "INSERT INTO customer_ledgers \
                (id, company_name, description, expense_type, amount, status, paid_amount, invoice_number) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (id) DO UPDATE SET \
                company_name = EXCLUDED.company_name, \
                description = EXCLUDED.description, \
                expense_type = EXCLUDED.expense_type, \
                amount = EXCLUDED.amount, \
                status = EXCLUDED.status, \
                paid_amount = EXCLUDED.paid_amount, \
                invoice_number = EXCLUDED.invoice_number",
        )
        .bind(ledger_id)
        .bind(company_name)
        .bind("aud990 analytics regression fixture")
        .bind("aud990_expense")
        .bind(Decimal::new(50_000, 2)) // 500.00
        .bind("partial")
        .bind(Decimal::new(20_000, 2)) // 200.00
        .bind(invoice_number)
        .execute(&pool)
        .await
        .expect("seeding customer_ledgers must succeed");

        sqlx::query(
            "INSERT INTO customer_ledger_payments (id, ledger_id, payment_amount, payment_method) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (id) DO UPDATE SET \
                ledger_id = EXCLUDED.ledger_id, \
                payment_amount = EXCLUDED.payment_amount, \
                payment_method = EXCLUDED.payment_method",
        )
        .bind(payment_id)
        .bind(ledger_id)
        .bind(Decimal::new(20_000, 2)) // 200.00
        .bind("cash")
        .execute(&pool)
        .await
        .expect("seeding customer_ledger_payments must succeed");

        sqlx::query(
            "INSERT INTO customer_ledgers \
                (id, company_name, description, expense_type, amount, status, paid_amount, \
                 invoice_number, void_at, void_reason) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, 'aud990 void fixture') \
             ON CONFLICT (id) DO UPDATE SET \
                company_name = EXCLUDED.company_name, \
                description = EXCLUDED.description, \
                expense_type = EXCLUDED.expense_type, \
                amount = EXCLUDED.amount, \
                status = EXCLUDED.status, \
                paid_amount = EXCLUDED.paid_amount, \
                invoice_number = EXCLUDED.invoice_number, \
                void_at = EXCLUDED.void_at, \
                void_reason = EXCLUDED.void_reason",
        )
        .bind(void_ledger_id)
        .bind(company_name)
        .bind("aud990 void ledger row -- must be excluded from statements")
        .bind("aud990_expense")
        .bind(Decimal::new(15_000, 2)) // 150.00 open balance if wrongly included
        .bind("void")
        .bind(Decimal::ZERO)
        .bind(void_invoice_number)
        .execute(&pool)
        .await
        .expect("seeding the void customer_ledgers row must succeed");

        // Hotel business day from the pool's session timezone, not server OS time.
        let today: String = sqlx::query_scalar("SELECT CURRENT_DATE::text")
            .fetch_one(&pool)
            .await
            .expect("today lookup must succeed");

        // `_start_date` is unused by this report branch and `company_name:
        // None` selects the "list all companies" shape.
        let list_report = analytics_repo::generate_report(
            &pool,
            ReportQuery {
                report_type: "company_ledger_statement".to_string(),
                start_date: today.clone(),
                end_date: today.clone(),
                shift: None,
                drawer: None,
                company_name: None,
                booking_channel_id: None,
                booking_channel: None,
                platform_name: None,
                booking_status: None,
                posted_status: None,
                room_type: None,
            },
        )
        .await
        .expect(
            "company_ledger_statement (company list) must decode without panicking -- \
             regression guard for lesson 2026-07-26d",
        );

        assert_eq!(list_report["type"].as_str(), Some("company_list"));
        let companies = list_report["companies"]
            .as_array()
            .expect("companies must be a JSON array");
        let my_company = companies
            .iter()
            .find(|c| c["company_name"].as_str() == Some(company_name))
            .expect("the seeded company must appear in the company list");
        assert_eq!(
            my_company["entry_count"].as_i64(),
            Some(1),
            "the status='void' row must be excluded from the company list \
             (filter must use 'void' -- 'voided' is not in valid_status and never matches)"
        );
        assert_eq!(json_decimal(&my_company["total_balance"]), Decimal::new(30_000, 2));

        let statement_report = analytics_repo::generate_report(
            &pool,
            ReportQuery {
                report_type: "company_ledger_statement".to_string(),
                start_date: today.clone(),
                end_date: today,
                shift: None,
                drawer: None,
                company_name: Some(company_name.to_string()),
                booking_channel_id: None,
                booking_channel: None,
                platform_name: None,
                booking_status: None,
                posted_status: None,
                room_type: None,
            },
        )
        .await
        .expect(
            "company_ledger_statement (single company) must decode customer_ledgers / \
             customer_ledger_payments TIMESTAMPTZ columns without panicking",
        );

        assert_eq!(statement_report["type"].as_str(), Some("company_statement"));
        assert_eq!(statement_report["company"]["name"].as_str(), Some(company_name));
        assert_eq!(json_decimal(&statement_report["balance_due"]), Decimal::new(30_000, 2));
        assert_eq!(
            json_decimal(&statement_report["totals"]["original_amount"]),
            Decimal::new(50_000, 2)
        );
        assert_eq!(
            json_decimal(&statement_report["totals"]["payments_received"]),
            Decimal::new(20_000, 2)
        );
        assert_eq!(
            json_decimal(&statement_report["totals"]["open_amount"]),
            Decimal::new(30_000, 2)
        );

        let transactions = statement_report["transactions"]
            .as_array()
            .expect("transactions must be a JSON array");
        assert_eq!(
            transactions.len(),
            1,
            "the status='void' ledger row must be excluded from the statement transactions"
        );
        assert_eq!(transactions[0]["invoice"].as_str(), Some(invoice_number));
        assert!(
            transactions
                .iter()
                .all(|t| t["invoice"].as_str() != Some(void_invoice_number)),
            "the void row's invoice must not appear in the company statement"
        );
        assert_eq!(
            json_decimal(&transactions[0]["original_amount"]),
            Decimal::new(50_000, 2)
        );

        assert_eq!(
            json_decimal(&statement_report["last_payment"]["amount"]),
            Decimal::new(20_000, 2)
        );
        assert!(
            statement_report["last_payment"]["date"].is_string(),
            "last_payment.date must decode customer_ledger_payments.payment_date (TIMESTAMPTZ) \
             successfully, got: {:?}",
            statement_report["last_payment"]["date"]
        );

        cleanup_ledger_fixture(&pool, ledger_id).await;
        cleanup_ledger_fixture(&pool, void_ledger_id).await;
    }

    // -----------------------------------------------------------------
    // 3. Analytics: revenue report aggregates a date-scoped seeded booking.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn analytics_revenue_report_aggregates_a_date_scoped_seeded_booking() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id: i64 = 990_201;
        let room_type_id: i64 = 990_401;
        let room_id: i64 = 990_301;
        let booking_id: i64 = 990_101;
        // Far enough in the future that no real dev-seeded data can share this
        // exact check_in_date, so the date-scoped aggregates below are exact.
        let check_in = NaiveDate::from_ymd_opt(2093, 8, 17).unwrap();
        let check_out = NaiveDate::from_ymd_opt(2093, 8, 19).unwrap();
        let total_amount = Decimal::new(27_550, 2); // 275.50
        let room_type_name = "AUD990 Room Type";

        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id).await;

        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 2) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind("AUD990RT")
        .bind(room_type_name)
        .bind(Decimal::new(15_000, 2))
        .execute(&pool)
        .await
        .expect("seeding room_types must succeed");

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id",
        )
        .bind(room_id)
        .bind(format!("AUD{room_id}"))
        .bind(room_type_id)
        .execute(&pool)
        .await
        .expect("seeding rooms must succeed");

        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Aud990', 'Guest') \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
        )
        .bind(guest_id)
        .bind("Aud990 Guest")
        .execute(&pool)
        .await
        .expect("seeding guests must succeed");

        sqlx::query(
            "INSERT INTO bookings ( \
                id, booking_number, guest_id, guest_name, room_id, \
                check_in_date, check_out_date, adults, children, \
                room_rate, subtotal, total_amount, status, payment_status \
             ) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 0, $8, $8, $8, 'confirmed', 'unpaid') \
             ON CONFLICT (id) DO UPDATE SET \
                check_in_date = EXCLUDED.check_in_date, \
                check_out_date = EXCLUDED.check_out_date, \
                total_amount = EXCLUDED.total_amount, \
                status = EXCLUDED.status, \
                payment_status = EXCLUDED.payment_status",
        )
        .bind(booking_id)
        .bind(format!("BK-AUD990-{booking_id}"))
        .bind(guest_id)
        .bind("Aud990 Guest")
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(total_amount)
        .execute(&pool)
        .await
        .expect("seeding bookings must succeed");

        let report = analytics_repo::generate_report(
            &pool,
            ReportQuery {
                report_type: "revenue".to_string(),
                start_date: check_in.to_string(),
                end_date: check_in.to_string(),
                shift: None,
                drawer: None,
                company_name: None,
                booking_channel_id: None,
                booking_channel: None,
                platform_name: None,
                booking_status: None,
                posted_status: None,
                room_type: None,
            },
        )
        .await
        .expect("revenue report must succeed");

        assert_eq!(report["total_revenue"].as_f64(), Some(275.50));

        let by_room_type = report["by_room_type"]
            .as_array()
            .expect("by_room_type must be a JSON array");
        assert_eq!(
            by_room_type.len(),
            1,
            "expected exactly the one seeded booking in this scoped window: {by_room_type:?}"
        );
        assert_eq!(by_room_type[0]["room_type"].as_str(), Some(room_type_name));
        assert_eq!(by_room_type[0]["bookings"].as_i64(), Some(1));
        assert_eq!(by_room_type[0]["revenue"].as_f64(), Some(275.50));

        let by_source = report["by_source"]
            .as_array()
            .expect("by_source must be a JSON array");
        assert_eq!(by_source.len(), 1);
        assert_eq!(by_source[0]["source"].as_str(), Some("direct"));
        assert_eq!(by_source[0]["revenue"].as_f64(), Some(275.50));

        let by_payment_status = report["by_payment_status"]
            .as_array()
            .expect("by_payment_status must be a JSON array");
        assert_eq!(by_payment_status.len(), 1);
        assert_eq!(by_payment_status[0]["payment_status"].as_str(), Some("unpaid"));
        assert_eq!(by_payment_status[0]["revenue"].as_f64(), Some(275.50));

        let daily = report["daily"].as_array().expect("daily must be a JSON array");
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0]["date"].as_str(), Some(check_in.to_string().as_str()));
        assert_eq!(daily[0]["revenue"].as_f64(), Some(275.50));

        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id).await;
    }

    // -----------------------------------------------------------------
    // 4. Night audit: run closes a business date; a non-forced rerun is
    //    rejected, a forced rerun cleanly resets and reposts.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn night_audit_run_rejects_rerun_without_force_and_force_reruns_cleanly() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 990_002;
        // Far enough in the future to guarantee no overlapping real bookings
        // and no pre-existing completed audit run for this date.
        let audit_date = NaiveDate::from_ymd_opt(2094, 2, 2).unwrap();

        async fn cleanup(pool: &PgPool, user_id: i64, audit_date: NaiveDate) {
            let _ = night_audit_service::reset_audit(pool, audit_date).await;
            sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'night_audit' AND user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
        }

        cleanup(&pool, user_id, audit_date).await;
        upsert_actor(&pool, user_id, "aud990_night_audit_actor").await;

        // run_night_audit() ends with a WHERE-less `UPDATE rooms SET
        // last_posted_status = status, last_posted_date = p_audit_date`, and
        // reset_audit() never undoes it — snapshot every room's last_posted_*
        // pair now so this test can restore the shared dev DB afterwards
        // instead of leaving the fictitious 2094 date stamped table-wide
        // (adversarial-review finding, 2026-07-26).
        let prior_room_postings: Vec<(i64, Option<String>, Option<NaiveDate>)> =
            sqlx::query_as("SELECT id, last_posted_status, last_posted_date FROM rooms")
                .fetch_all(&pool)
                .await
                .unwrap();

        let preview_before = night_audit_service::preview(&pool, audit_date)
            .await
            .expect("preview must succeed before any run exists for this date");
        assert!(preview_before.can_run);
        assert!(!preview_before.already_run);

        let first = night_audit_service::run(
            &pool,
            user_id,
            RunNightAuditRequest {
                audit_date: audit_date.to_string(),
                notes: Some("aud990 first run".to_string()),
                force: false,
            },
        )
        .await
        .expect("the first run for a fresh, unposted date must succeed");
        assert!(first.success);
        assert_eq!(first.audit_run.audit_date, audit_date);
        assert_eq!(first.audit_run.status, "completed");

        assert!(
            night_audit_service::is_audit_completed(&pool, audit_date).await,
            "the audit date must be marked completed after a successful run"
        );

        let second = night_audit_service::run(
            &pool,
            user_id,
            RunNightAuditRequest {
                audit_date: audit_date.to_string(),
                notes: None,
                force: false,
            },
        )
        .await;
        match second {
            Err(ApiError::BadRequest(message)) => {
                assert!(
                    message.to_lowercase().contains("already completed"),
                    "unexpected rejection message: {message}"
                );
            }
            other => panic!("expected a BadRequest rejection for a repeat non-forced run, got {other:?}"),
        }

        let third = night_audit_service::run(
            &pool,
            user_id,
            RunNightAuditRequest {
                audit_date: audit_date.to_string(),
                notes: Some("aud990 forced rerun".to_string()),
                force: true,
            },
        )
        .await
        .expect("a forced rerun must reset the prior run and repost cleanly");
        assert!(third.success);
        assert_eq!(third.audit_run.status, "completed");

        // Restore the pre-test last_posted_* values captured above.
        for (room_id, status, date) in prior_room_postings {
            sqlx::query(
                "UPDATE rooms SET last_posted_status = $1, last_posted_date = $2 WHERE id = $3",
            )
            .bind(status)
            .bind(date)
            .bind(room_id)
            .execute(&pool)
            .await
            .unwrap();
        }

        cleanup(&pool, user_id, audit_date).await;
    }

    // -----------------------------------------------------------------
    // 5. System settings: create a scratch key, update it through the
    //    service, read back, then remove the scratch key entirely.
    //    Deliberately never touches a real/pre-existing setting (esp. not
    //    `timezone`).
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn system_setting_round_trips_through_the_service_and_is_cleaned_up() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 990_003;
        let key = "aud990_test_setting";

        async fn cleanup(pool: &PgPool, user_id: i64, key: &str) {
            sqlx::query("DELETE FROM system_settings WHERE key = $1")
                .bind(key)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .unwrap();
        }

        cleanup(&pool, user_id, key).await;
        upsert_actor(&pool, user_id, "aud990_settings_actor").await;

        SettingsRepository::upsert(
            &pool,
            key,
            "original-value",
            Some("aud990 scratch setting -- safe to delete"),
            Some("aud990"),
        )
        .await
        .expect("creating the scratch setting must succeed");

        let updated = settings_service::update_system_setting(
            &pool,
            key,
            SystemSettingUpdate {
                value: "updated-value".to_string(),
            },
            user_id,
        )
        .await
        .expect("updating an existing setting through the service must succeed");
        assert_eq!(updated.key, key);
        assert_eq!(updated.value, "updated-value");

        let read_back = settings_service::get_setting_value(&pool, key)
            .await
            .expect("reading the setting back must succeed");
        assert_eq!(read_back, "updated-value");

        cleanup(&pool, user_id, key).await;

        let after_cleanup = SettingsRepository::find_by_key(&pool, key)
            .await
            .expect("find_by_key must not error for a missing key");
        assert!(after_cleanup.is_none(), "the scratch setting must not outlive the test");
    }

    // -----------------------------------------------------------------
    // 6. Global search: a seeded invoice is returned by the ledger search
    //    repository with the expected title/subtitle shape.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn global_search_ledgers_returns_seeded_invoice_hit() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let ledger_id: i64 = 990_511;
        let company_name = "AUD990 Search Co";
        let invoice_number = "aud990-inv-search-511";

        cleanup_ledger_fixture(&pool, ledger_id).await;

        sqlx::query(
            "INSERT INTO customer_ledgers (id, company_name, description, expense_type, amount, invoice_number) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (id) DO UPDATE SET \
                company_name = EXCLUDED.company_name, \
                description = EXCLUDED.description, \
                expense_type = EXCLUDED.expense_type, \
                amount = EXCLUDED.amount, \
                invoice_number = EXCLUDED.invoice_number",
        )
        .bind(ledger_id)
        .bind(company_name)
        .bind("aud990 search fixture")
        .bind("aud990_expense")
        .bind(Decimal::new(10_000, 2))
        .bind(invoice_number)
        .execute(&pool)
        .await
        .expect("seeding the search ledger fixture must succeed");

        let pattern = format!("%{invoice_number}%");
        let hits = SearchRepository::search_ledgers(&pool, &pattern, 10)
            .await
            .expect("search_ledgers must succeed");

        let hit = hits
            .iter()
            .find(|hit| hit.id == ledger_id)
            .unwrap_or_else(|| panic!("the seeded ledger must appear in the search results: {hits:?}"));
        assert_eq!(hit.title, invoice_number);
        assert!(
            hit.subtitle.contains(company_name),
            "subtitle should mention the company name, got: {}",
            hit.subtitle
        );
        assert!(hit.route.contains(&ledger_id.to_string()));

        cleanup_ledger_fixture(&pool, ledger_id).await;
    }

    // -----------------------------------------------------------------
    // 7. Booking channels: create / update / deactivate round trip.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn booking_channel_create_update_deactivate_round_trip() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let name = "AUD990 Test Channel";

        async fn cleanup(pool: &PgPool, name: &str) {
            sqlx::query("DELETE FROM booking_channels WHERE name = $1")
                .bind(name)
                .execute(pool)
                .await
                .unwrap();
        }

        cleanup(&pool, name).await;

        let created = booking_channels_service::create(
            &pool,
            BookingChannelInput {
                name: name.to_string(),
                channel_type: Some("ota".to_string()),
                default_commission_type: Some("percentage".to_string()),
                default_commission_value: Some(Decimal::new(1_000, 2)), // 10.00%
                default_commission_scope: Some("per_booking".to_string()),
                is_active: Some(true),
            },
        )
        .await
        .expect("creating a booking channel must succeed");
        assert_eq!(created.name, name);
        assert_eq!(created.channel_type, "ota");
        assert_eq!(created.default_commission_value, Decimal::new(1_000, 2));
        assert!(created.is_active);

        let updated = booking_channels_service::update(
            &pool,
            created.id,
            BookingChannelUpdate {
                name: None,
                channel_type: None,
                default_commission_type: None,
                default_commission_value: Some(Decimal::new(1_500, 2)), // 15.00%
                default_commission_scope: None,
                is_active: None,
            },
        )
        .await
        .expect("updating the booking channel must succeed");
        assert_eq!(updated.default_commission_value, Decimal::new(1_500, 2));
        assert_eq!(
            updated.channel_type, "ota",
            "fields left unspecified in the update must be preserved from the current row"
        );

        let deactivated = booking_channels_service::deactivate(&pool, created.id)
            .await
            .expect("deactivating the booking channel must succeed");
        assert!(!deactivated.is_active);
        assert_eq!(
            deactivated.default_commission_value,
            Decimal::new(1_500, 2),
            "deactivate must only flip is_active, not reset other fields"
        );

        cleanup(&pool, name).await;
    }
}
