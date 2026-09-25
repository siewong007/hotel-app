//! Integration tests for the typed Insights surface: overview KPI
//! consistency against the sources it consolidates, the report envelope
//! adapter, and the catalog's agreement with the legacy generator.
//!
//! Service layer (not HTTP), against a live PostgreSQL database.
//! Skips gracefully when `DATABASE_URL` is unset.

mod postgres_tests {
    use hotel_app_be::modules::insights::queries;
    use hotel_app_be::modules::insights::report_catalog;
    use hotel_app_be::modules::insights::service::{self, InsightsReportQuery};
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping insights test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(3)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    fn report_query(start: &str, end: &str) -> InsightsReportQuery {
        InsightsReportQuery {
            start_date: start.to_string(),
            end_date: end.to_string(),
            shift: None,
            drawer: None,
            company_name: None,
            booking_channel_id: None,
            booking_channel: None,
            platform_name: None,
            booking_status: None,
            posted_status: None,
            room_type: None,
        }
    }

    #[tokio::test]
    async fn overview_matches_its_sources() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };

        let overview = service::overview(&pool).await.expect("overview");

        // Buckets sum back to the active room count.
        let rooms = &overview.rooms;
        assert_eq!(
            rooms.total,
            rooms.occupied + rooms.reserved + rooms.available + rooms.cleaning + rooms.maintenance,
            "room buckets must partition active rooms"
        );

        // Occupancy rate is consistent with the buckets.
        if rooms.total > 0 {
            let expected = rooms.occupied as f64 / rooms.total as f64 * 100.0;
            assert!((overview.occupancy_rate - expected).abs() < 1e-6);
        }

        // Guests total matches the repository read.
        let guests = queries::guests_total(&pool).await.expect("guests_total");
        assert_eq!(overview.guests_total, guests);

        // Seven-day revenue strip has one point per day ending today.
        assert_eq!(overview.revenue_last_7_days.len(), 7);
        assert_eq!(
            overview.revenue_last_7_days.last().unwrap().date,
            overview.business_date
        );
        let today_rev = queries::revenue_for_date(&pool, overview.business_date)
            .await
            .expect("revenue_for_date");
        assert!((overview.revenue_today - today_rev).abs() < 1e-6);
    }

    #[tokio::test]
    async fn overview_rosters_match_booking_kpis() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };

        let overview = service::overview(&pool).await.expect("overview");

        // Roster lengths must reconcile with the booking KPI counters for
        // today. Arrivals share one predicate (`pending`/`confirmed` due in
        // today); departures deliberately differ — the roster is the pending
        // list (checked_in/auto_checked_in/late_checkout, matching the
        // daily-operations report) while the KPI also counts guests who
        // already left today (checked_out/completed) and not late_checkout.
        assert_eq!(
            overview.arrivals.len() as i64,
            overview.bookings.today_check_ins,
            "arrival roster must match today_check_ins"
        );
        let already_departed: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings \
             WHERE check_out_date = $1 AND status IN ('checked_out', 'completed')",
        )
        .bind(overview.business_date)
        .fetch_one(&pool)
        .await
        .expect("count bookings already departed today");
        let late_checkouts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings \
             WHERE check_out_date = $1 AND status = 'late_checkout'",
        )
        .bind(overview.business_date)
        .fetch_one(&pool)
        .await
        .expect("count late-checkout departures today");
        assert_eq!(
            overview.bookings.today_check_outs,
            overview.departures.len() as i64 + already_departed - late_checkouts,
            "today_check_outs must reconcile as roster + already-departed - late_checkout"
        );

        for row in &overview.arrivals {
            assert!(!row.guest_name.is_empty());
            assert!(!row.room_number.is_empty());
            assert!(!row.room_type.is_empty());
            assert!(row.nights > 0, "arrival {} nights", row.booking_number);
            assert!(row.balance >= 0.0, "arrival {} balance", row.booking_number);
        }
        for row in &overview.departures {
            assert!(!row.guest_name.is_empty());
            assert!(!row.room_number.is_empty());
            assert!(row.nights > 0, "departure {} nights", row.booking_number);
            assert!(
                row.balance >= 0.0,
                "departure {} balance",
                row.booking_number
            );
        }
    }

    #[tokio::test]
    async fn catalog_covers_legacy_generator_types() {
        // Every report type the legacy string-dispatched generator supports
        // must be in the catalog — otherwise `/insights/reports/{id}` 404s a
        // report `/reports/generate` accepts.
        for id in [
            "daily_operations",
            "occupancy",
            "rooms_sold",
            "room_performance",
            "revenue",
            "channel_net_revenue",
            "ota_commission",
            "ota_monthly_statement",
            "payment_status",
            "shift_report",
            "complimentary",
            "guest_statistics",
            "general_journal",
            "journal_by_type",
            "balance_sheet",
            "company_ledger_statement",
        ] {
            assert!(
                report_catalog::find(id).is_some(),
                "catalog missing report type {id}"
            );
        }
    }

    #[tokio::test]
    async fn envelope_wraps_occupancy_report() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let today = hotel_app_be::core::db::hotel_today(&pool)
            .await
            .expect("hotel_today");
        let start = (today - chrono::Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();
        let end = today.format("%Y-%m-%d").to_string();

        let envelope = service::report_envelope(
            &pool,
            0, // user id only feeds the audit row
            "occupancy",
            report_query(&start, &end),
        )
        .await
        .expect("occupancy envelope");

        assert_eq!(envelope.meta.report_id, "occupancy");
        assert_eq!(envelope.meta.date_basis, "stay");
        assert_eq!(
            envelope.meta.range_start.map(|d| d.to_string()).as_deref(),
            Some(start.as_str())
        );
        assert_eq!(
            envelope.meta.range_end.map(|d| d.to_string()).as_deref(),
            Some(end.as_str())
        );
        assert!(
            !envelope.kpis.is_empty(),
            "occupancy summary must become KPIs"
        );
        assert!(
            envelope.sections.iter().any(|s| s.key == "daily"),
            "occupancy daily rows must become a section"
        );
    }

    #[tokio::test]
    async fn envelope_rejects_unknown_report() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let result = service::report_envelope(
            &pool,
            0,
            "not_a_report",
            report_query("2024-01-01", "2024-01-02"),
        )
        .await;
        assert!(result.is_err());
    }
}
