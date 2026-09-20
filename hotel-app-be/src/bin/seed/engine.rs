//! Seed engine: one connection, one transaction — guard, prelude, wipe,
//! selected sections, sequence resync, counts, commit.
//!
//! The prelude mirrors what staging.sql established for psql: an advisory lock
//! so concurrent seed/patch runs serialize, the audit-mutation escape hatch
//! (the users delete fires `ON DELETE SET NULL` on append-only `audit_logs`),
//! the connection timezone pinned to `system_settings.timezone` so
//! `CURRENT_DATE` is the hotel business day, and the `staging_ref` temp table
//! every section reads its dates from.

use sqlx::Connection;
use sqlx::postgres::PgConnection;

use crate::sections;
use crate::wipe::WIPE_SQL;

pub type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

/// Per-table band counts produced after a run.
pub struct RunSummary {
    pub ref_date: chrono::NaiveDate,
    pub counts: Vec<(&'static str, i64)>,
}

/// Tables reported in the summary, in display order.
const COUNTED_TABLES: &[(&str, &str)] = &[
    ("users", "users"),
    ("room types", "room_types"),
    ("rooms", "rooms"),
    ("amenities", "amenities"),
    ("rate plans", "rate_plans"),
    ("guests", "guests"),
    ("companies", "companies"),
    ("bookings", "bookings"),
    ("booking guests", "booking_guests"),
    ("payments", "payments"),
    ("invoices", "invoices"),
    ("city ledger entries", "customer_ledgers"),
    ("housekeeping tasks", "housekeeping_tasks"),
    ("maintenance tickets", "maintenance_tickets"),
    ("night audit runs", "night_audit_runs"),
    ("promotions", "promotions"),
    ("vouchers", "vouchers"),
    ("email deliveries", "email_deliveries"),
    ("loyalty members", "loyalty_members"),
    ("staff notifications", "staff_notifications"),
    ("audit events", "audit_logs"),
];

async fn run_section(key: &str, tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    match key {
        "core" => sections::core::seed(tx).await,
        "rooms_state" => sections::rooms_state::seed(tx).await,
        "bookings_history" => sections::bookings_history::seed(tx).await,
        "bookings_ops" => sections::bookings_ops::seed(tx).await,
        "bookings_matrix" => sections::bookings_matrix::seed(tx).await,
        "anonymous" => sections::anonymous::seed(tx).await,
        "availability" => sections::availability::seed(tx).await,
        "finance" => sections::finance::seed(tx).await,
        "operations" => sections::operations::seed(tx).await,
        "night_audit" => sections::night_audit::seed(tx).await,
        "marketing" => sections::marketing::seed(tx).await,
        "loyalty" => sections::loyalty::seed(tx).await,
        "guest_access" => sections::guest_access::seed(tx).await,
        "auth_extra" => sections::auth_extra::seed(tx).await,
        "notifications" => sections::notifications::seed(tx).await,
        "webhook_fixtures" => sections::webhook_fixtures::seed(tx).await,
        "audit" => sections::audit::seed(tx).await,
        _ => unreachable!("registry only resolves known module keys: {key}"),
    }
}

/// Apply `module_keys` against `url`. Always wipes the seed band first so a
/// rerun yields identical state — never an append.
pub async fn run(
    url: &str,
    module_keys: &[&'static str],
    ref_date: Option<chrono::NaiveDate>,
) -> Result<RunSummary, anyhow::Error> {
    let mut conn = PgConnection::connect(url).await?;

    // Guard: this dataset requires a completed V1 installation (schema +
    // system bootstrap + patch catalog all come from `make db-baseline`).
    let installed: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM public.hotel_schema_revisions WHERE generation = 1 AND version = 1",
    )
    .fetch_optional(&mut conn)
    .await?;
    if installed.is_none() {
        anyhow::bail!("seed requires an initialized V1 database — run `make db-baseline` first");
    }

    let mut tx = conn.begin().await?;

    // Serialize with any concurrent seed/patch runner (same lock key staging
    // used, so a straggler psql run cannot interleave either).
    sqlx::raw_sql("SELECT pg_advisory_xact_lock(hashtext('hotel_app_dev_seed'))")
        .execute(&mut *tx)
        .await?;

    // The wipe deletes seed users, which fires users->audit_logs ON DELETE SET
    // NULL on an append-only table; the documented fixture escape hatch is
    // required (the integration suite uses it for the same reason).
    sqlx::raw_sql("SET LOCAL app.allow_audit_mutation = 'on'")
        .execute(&mut *tx)
        .await?;

    // Match core/db.rs: CURRENT_DATE is the hotel business day.
    let timezone: Option<String> =
        sqlx::query_scalar("SELECT value FROM public.system_settings WHERE key = 'timezone'")
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(tz) = timezone {
        sqlx::query("SELECT set_config('TimeZone', $1, true)")
            .bind(tz)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(date) = ref_date {
        sqlx::query("SELECT set_config('staging.ref_date', $1, true)")
            .bind(date.to_string())
            .execute(&mut *tx)
            .await?;
    }
    sqlx::raw_sql(
        "CREATE TEMP TABLE staging_ref ON COMMIT DROP AS \
         SELECT COALESCE(current_setting('staging.ref_date', true)::date, CURRENT_DATE) AS today",
    )
    .execute(&mut *tx)
    .await?;

    sqlx::raw_sql(WIPE_SQL).execute(&mut *tx).await?;

    for key in module_keys {
        run_section(key, &mut tx).await?;
    }

    sqlx::raw_sql(RESYNC_SQL).execute(&mut *tx).await?;

    let ref_date_used: chrono::NaiveDate = sqlx::query_scalar("SELECT today FROM staging_ref")
        .fetch_one(&mut *tx)
        .await?;

    let mut counts = Vec::with_capacity(COUNTED_TABLES.len());
    for (label, table) in COUNTED_TABLES {
        // `table` comes from the COUNTED_TABLES const whitelist, not user input.
        let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM public.{table} WHERE id BETWEEN 800000 AND 899999"
        )))
        .fetch_one(&mut *tx)
        .await?;
        counts.push((*label, count));
    }

    tx.commit().await?;
    Ok(RunSummary {
        ref_date: ref_date_used,
        counts,
    })
}

/// Identity-sequence resync after OVERRIDING SYSTEM VALUE inserts (ported from
/// staging.sql §90). Sequences live below the band, so max(seq, 800000) is safe.
const RESYNC_SQL: &str = r#"
SELECT pg_catalog.setval('public.users_id_seq', GREATEST((SELECT MAX(id) FROM public.users), 800000), true);
SELECT pg_catalog.setval('public.teams_id_seq', GREATEST((SELECT MAX(id) FROM public.teams), 800000), true);
SELECT pg_catalog.setval('public.room_types_id_seq', GREATEST((SELECT MAX(id) FROM public.room_types), 800000), true);
SELECT pg_catalog.setval('public.rooms_id_seq', GREATEST((SELECT MAX(id) FROM public.rooms), 800000), true);
SELECT pg_catalog.setval('public.rate_plans_id_seq', GREATEST((SELECT MAX(id) FROM public.rate_plans), 800000), true);
SELECT pg_catalog.setval('public.room_rates_id_seq', GREATEST((SELECT MAX(id) FROM public.room_rates), 800000), true);
SELECT pg_catalog.setval('public.guests_id_seq', GREATEST((SELECT MAX(id) FROM public.guests), 800000), true);
SELECT pg_catalog.setval('public.companies_id_seq', GREATEST((SELECT MAX(id) FROM public.companies), 800000), true);
SELECT pg_catalog.setval('public.corporate_account_contacts_id_seq', GREATEST((SELECT MAX(id) FROM public.corporate_account_contacts), 800000), true);
SELECT pg_catalog.setval('public.bookings_id_seq', GREATEST((SELECT MAX(id) FROM public.bookings), 800000), true);
SELECT pg_catalog.setval('public.booking_guests_id_seq', GREATEST((SELECT MAX(id) FROM public.booking_guests), 800000), true);
SELECT pg_catalog.setval('public.services_id_seq', GREATEST((SELECT MAX(id) FROM public.services), 800000), true);
SELECT pg_catalog.setval('public.payments_id_seq', GREATEST((SELECT MAX(id) FROM public.payments), 800000), true);
SELECT pg_catalog.setval('public.invoices_id_seq', GREATEST((SELECT MAX(id) FROM public.invoices), 800000), true);
SELECT pg_catalog.setval('public.customer_ledgers_id_seq', GREATEST((SELECT MAX(id) FROM public.customer_ledgers), 800000), true);
SELECT pg_catalog.setval('public.customer_ledger_payments_id_seq', GREATEST((SELECT MAX(id) FROM public.customer_ledger_payments), 800000), true);
SELECT pg_catalog.setval('public.promotions_id_seq', GREATEST((SELECT MAX(id) FROM public.promotions), 800000), true);
SELECT pg_catalog.setval('public.vouchers_id_seq', GREATEST((SELECT MAX(id) FROM public.vouchers), 800000), true);
SELECT pg_catalog.setval('public.voucher_redemptions_id_seq', GREATEST((SELECT MAX(id) FROM public.voucher_redemptions), 800000), true);
SELECT pg_catalog.setval('public.voucher_redemption_allocations_id_seq', GREATEST((SELECT MAX(id) FROM public.voucher_redemption_allocations), 800000), true);
SELECT pg_catalog.setval('public.housekeeping_tasks_id_seq', GREATEST((SELECT MAX(id) FROM public.housekeeping_tasks), 800000), true);
SELECT pg_catalog.setval('public.maintenance_tickets_id_seq', GREATEST((SELECT MAX(id) FROM public.maintenance_tickets), 800000), true);
SELECT pg_catalog.setval('public.room_events_id_seq', GREATEST((SELECT MAX(id) FROM public.room_events), 800000), true);
SELECT pg_catalog.setval('public.night_audit_runs_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_runs), 800000), true);
SELECT pg_catalog.setval('public.night_audit_details_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_details), 800000), true);
SELECT pg_catalog.setval('public.night_audit_posted_nights_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_posted_nights), 800000), true);
SELECT pg_catalog.setval('public.email_templates_id_seq', GREATEST((SELECT MAX(id) FROM public.email_templates), 800000), true);
SELECT pg_catalog.setval('public.email_campaigns_id_seq', GREATEST((SELECT MAX(id) FROM public.email_campaigns), 800000), true);
SELECT pg_catalog.setval('public.email_deliveries_id_seq', GREATEST((SELECT MAX(id) FROM public.email_deliveries), 800000), true);
SELECT pg_catalog.setval('public.email_suppressions_id_seq', GREATEST((SELECT MAX(id) FROM public.email_suppressions), 800000), true);
SELECT pg_catalog.setval('public.loyalty_members_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_members), 800000), true);
SELECT pg_catalog.setval('public.loyalty_accounts_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_accounts), 800000), true);
SELECT pg_catalog.setval('public.loyalty_memberships_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_memberships), 800000), true);
SELECT pg_catalog.setval('public.loyalty_transactions_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_transactions), 800000), true);
SELECT pg_catalog.setval('public.loyalty_rewards_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_rewards), 800000), true);
SELECT pg_catalog.setval('public.loyalty_redemptions_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_redemptions), 800000), true);
SELECT pg_catalog.setval('public.guest_complimentary_credits_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_complimentary_credits), 800000), true);
SELECT pg_catalog.setval('public.guest_portal_sessions_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_portal_sessions), 800000), true);
SELECT pg_catalog.setval('public.payment_retry_capabilities_id_seq', GREATEST((SELECT MAX(id) FROM public.payment_retry_capabilities), 800000), true);
SELECT pg_catalog.setval('public.room_changes_id_seq', GREATEST((SELECT MAX(id) FROM public.room_changes), 800000), true);
SELECT pg_catalog.setval('public.guest_notes_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_notes), 800000), true);
SELECT pg_catalog.setval('public.guest_documents_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_documents), 800000), true);
SELECT pg_catalog.setval('public.guest_reviews_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_reviews), 800000), true);
SELECT pg_catalog.setval('public.guest_segments_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_segments), 800000), true);
SELECT pg_catalog.setval('public.user_guests_id_seq', GREATEST((SELECT MAX(id) FROM public.user_guests), 800000), true);
SELECT pg_catalog.setval('public.notification_subscriptions_id_seq', GREATEST((SELECT MAX(id) FROM public.notification_subscriptions), 800000), true);
SELECT pg_catalog.setval('public.notification_consent_events_id_seq', GREATEST((SELECT MAX(id) FROM public.notification_consent_events), 800000), true);
SELECT pg_catalog.setval('public.consent_records_id_seq', GREATEST((SELECT MAX(id) FROM public.consent_records), 800000), true);
SELECT pg_catalog.setval('public.staff_notifications_id_seq', GREATEST((SELECT MAX(id) FROM public.staff_notifications), 800000), true);
SELECT pg_catalog.setval('public.amenities_id_seq', GREATEST((SELECT MAX(id) FROM public.amenities), 800000), true);
SELECT pg_catalog.setval('public.audit_logs_id_seq1', GREATEST((SELECT MAX(id) FROM public.audit_logs), 800000), true);
SELECT pg_catalog.setval('public.self_checkin_events_id_seq', GREATEST((SELECT MAX(id) FROM public.self_checkin_events), 800000), true);
SELECT pg_catalog.setval('public.support_conversations_id_seq', GREATEST((SELECT MAX(id) FROM public.support_conversations), 800000), true);
SELECT pg_catalog.setval('public.support_messages_id_seq', GREATEST((SELECT MAX(id) FROM public.support_messages), 800000), true);
SELECT pg_catalog.setval('public.support_events_id_seq', GREATEST((SELECT MAX(id) FROM public.support_events), 800000), true);
"#;
