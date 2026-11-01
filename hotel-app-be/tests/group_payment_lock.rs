//! Once any money has moved, a group is paid as one booking.
//!
//! A single room cannot take a booking payment. Staff collect one desk payment
//! for every unpaid room. Cancelling a paid group refunds those room charges
//! instead of voiding them, and a fully cancelled group can be brought back
//! together. Cancelling an unpaid group gives its voucher back; a paid cancel
//! keeps the voucher.
//! Opt-in through `DATABASE_URL`; rows are hard-deleted before asserting.
use hotel_app_be::modules::bookings::group_actions::{
    GroupAction, reactivate_group, run_group_action,
};
use hotel_app_be::modules::payments::models::RecordPaymentRequest;
use hotel_app_be::modules::payments::service as payments;
use sqlx::{PgPool, postgres::PgPoolOptions};

struct Fx {
    guest_id: i64,
    room_type_id: i64,
    group_id: i64,
    bookings: Vec<i64>,
    promotion_id: Option<i64>,
    voucher_id: Option<i64>,
}

async fn pool() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    if std::env::var("JWT_SECRET").is_err() {
        // SAFETY: set before any config read in this binary.
        unsafe { std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret") };
    }
    let _ = hotel_app_be::core::config::init_from_env();
    Some(
        PgPoolOptions::new()
            .max_connections(4)
            .after_connect(|conn, _| {
                Box::pin(async move {
                    sqlx::query("SET app.allow_audit_mutation = 'on'")
                        .execute(conn)
                        .await
                        .map(|_| ())
                })
            })
            .connect(&url)
            .await
            .expect("connect"),
    )
}

async fn admin_id(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT id FROM users WHERE username = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fixture(pool: &PgPool) -> Fx {
    let tag = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (nick_name, email, tourism_type) VALUES ($1, $2, 'local') RETURNING id",
    )
    .bind(format!("Group Lock {tag}"))
    .bind(format!("group-lock-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("GL{tag}"))
    .bind(format!("Lock Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, CURRENT_DATE + 20, CURRENT_DATE + 22) RETURNING id",
    )
    .bind(format!("GGL{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut bookings = Vec::new();
    for i in 0..2 {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("L{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, CURRENT_DATE + 20, CURRENT_DATE + 22, 100.00, 200.00, 200.00, \
                 'pending', 'unpaid', 'MYR', $4) RETURNING id",
        )
        .bind(format!("BGL{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        bookings.push(id);
    }
    Fx {
        guest_id,
        room_type_id,
        group_id,
        bookings,
        promotion_id: None,
        voucher_id: None,
    }
}

/// Two rooms of 200, each carrying a 30 share of one redeemed 60 voucher.
async fn attach_fixed_voucher(pool: &PgPool, f: &mut Fx) {
    let tag = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let promotion_id: i64 = sqlx::query_scalar(
        "INSERT INTO promotions (slug, name, discount_type, discount_value, currency) \
         VALUES ($1, $2, 'fixed_amount', 60.00, 'MYR') RETURNING id",
    )
    .bind(format!("glock-{tag}"))
    .bind(format!("Lock voucher {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let voucher_id: i64 = sqlx::query_scalar(
        "INSERT INTO vouchers (promotion_id, guest_id, code, source, status, redeemed_at) \
         VALUES ($1, $2, $3, 'admin_issue', 'redeemed', CURRENT_TIMESTAMP) RETURNING id",
    )
    .bind(promotion_id)
    .bind(f.guest_id)
    .bind(format!("GLV{tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE booking_groups SET voucher_id = $2 WHERE id = $1")
        .bind(f.group_id)
        .bind(voucher_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE bookings SET discount_amount = 30.00, group_voucher_share = 30.00, \
         total_amount = 170.00 WHERE id = ANY($1)",
    )
    .bind(&f.bookings)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO voucher_redemptions (voucher_id, promotion_id, booking_id, guest_id, \
         gross_subtotal, discount_type, discount_value, discount_amount, net_total) \
         VALUES ($1, $2, $3, $4, 400.00, 'fixed_amount', 60.00, 60.00, 340.00)",
    )
    .bind(voucher_id)
    .bind(promotion_id)
    .bind(f.bookings[0])
    .bind(f.guest_id)
    .execute(pool)
    .await
    .unwrap();
    f.promotion_id = Some(promotion_id);
    f.voucher_id = Some(voucher_id);
}

async fn cleanup(pool: &PgPool, f: &Fx) {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT c.table_name::text FROM information_schema.columns c \
         JOIN information_schema.tables t ON t.table_name = c.table_name \
            AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE' \
         WHERE c.table_schema = 'public' AND c.column_name = 'booking_id' \
            AND c.table_name <> 'bookings'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for _ in 0..3 {
        for t in &tables {
            let sql = format!("DELETE FROM {t} WHERE booking_id = ANY($1)");
            let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
                .bind(&f.bookings)
                .execute(pool)
                .await;
        }
    }
    let _ = sqlx::query(
        "DELETE FROM audit_logs WHERE resource_id = $1 AND resource_type = 'booking_group'",
    )
    .bind(f.group_id)
    .execute(pool)
    .await;
    let _ = sqlx::query("DELETE FROM bookings WHERE id = ANY($1)")
        .bind(&f.bookings)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM booking_groups WHERE id = $1")
        .bind(f.group_id)
        .execute(pool)
        .await;
    if let Some(voucher_id) = f.voucher_id {
        let _ = sqlx::query("DELETE FROM voucher_redemptions WHERE voucher_id = $1")
            .bind(voucher_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM vouchers WHERE id = $1")
            .bind(voucher_id)
            .execute(pool)
            .await;
    }
    if let Some(promotion_id) = f.promotion_id {
        let _ = sqlx::query("DELETE FROM promotions WHERE id = $1")
            .bind(promotion_id)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
}

#[tokio::test]
async fn one_room_of_a_group_cannot_be_paid_on_its_own() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool).await;
    let err = payments::record_payment(
        &pool,
        admin_id(&pool).await,
        RecordPaymentRequest {
            booking_id: f.bookings[0],
            amount: 200.0,
            payment_method: "cash".to_string(),
            payment_type: Some("booking".to_string()),
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: format!("lock-{}", f.bookings[0]),
        },
    )
    .await;
    cleanup(&pool, &f).await;
    let err = err.expect_err("a group room is not paid alone");
    assert!(
        err.to_string()
            .contains("Pay the whole group in one payment"),
        "{err}"
    );
}

#[tokio::test]
async fn desk_payment_collects_every_unpaid_room() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool).await;
    let paid = payments::record_group_desk_payment(
        &pool,
        admin_id(&pool).await,
        f.group_id,
        "cash",
        None,
        None,
    )
    .await;
    let statuses: Vec<String> =
        sqlx::query_scalar("SELECT payment_status FROM bookings WHERE id = ANY($1) ORDER BY id")
            .bind(&f.bookings)
            .fetch_all(&pool)
            .await
            .unwrap();
    let group_status: String =
        sqlx::query_scalar("SELECT payment_status FROM booking_groups WHERE id = $1")
            .bind(f.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let amount: rust_decimal::Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = ANY($1) AND status = 'completed'",
    )
    .bind(&f.bookings)
    .fetch_one(&pool)
    .await
    .unwrap();
    cleanup(&pool, &f).await;
    assert!(paid.is_ok(), "desk payment: {:?}", paid.err());
    assert_eq!(statuses, vec!["paid".to_string(), "paid".to_string()]);
    assert_eq!(group_status, "paid");
    assert_eq!(amount.to_string(), "400.00");
}

#[tokio::test]
async fn cancelling_a_paid_group_refunds_room_charges_and_the_group_can_return() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool).await;
    let user_id = admin_id(&pool).await;
    payments::record_group_desk_payment(&pool, user_id, f.group_id, "cash", None, None)
        .await
        .expect("pay the group first");
    run_group_action(
        &pool,
        user_id,
        f.bookings[0],
        GroupAction::Cancel,
        Some("Guest asked to cancel".to_string()),
    )
    .await
    .expect("cancel all");
    let booking_statuses: Vec<String> =
        sqlx::query_scalar("SELECT status FROM bookings WHERE id = ANY($1) ORDER BY id")
            .bind(&f.bookings)
            .fetch_all(&pool)
            .await
            .unwrap();
    let original: Vec<String> = sqlx::query_scalar(
        "SELECT status FROM payments WHERE booking_id = ANY($1) AND payment_type = 'booking' ORDER BY id",
    )
    .bind(&f.bookings)
    .fetch_all(&pool)
    .await
    .unwrap();
    let refunds: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments WHERE booking_id = ANY($1) AND payment_type = 'refund' AND status = 'refunded'",
    )
    .bind(&f.bookings)
    .fetch_one(&pool)
    .await
    .unwrap();
    reactivate_group(&pool, user_id, f.bookings[0])
        .await
        .expect("reactivate the whole group");
    let restored: Vec<String> =
        sqlx::query_scalar("SELECT status FROM bookings WHERE id = ANY($1) ORDER BY id")
            .bind(&f.bookings)
            .fetch_all(&pool)
            .await
            .unwrap();
    cleanup(&pool, &f).await;
    assert_eq!(
        booking_statuses,
        vec!["voided".to_string(), "voided".to_string()]
    );
    assert_eq!(
        original,
        vec!["refunded".to_string(), "refunded".to_string()]
    );
    assert_eq!(refunds, 2);
    assert_eq!(
        restored,
        vec!["confirmed".to_string(), "confirmed".to_string()]
    );
}

async fn money_rows(pool: &PgPool, bookings: &[i64]) -> Vec<(String, String, String)> {
    sqlx::query_as(
        "SELECT total_amount::text, COALESCE(group_voucher_share, 0)::text, \
         COALESCE(discount_amount, 0)::text \
         FROM bookings WHERE id = ANY($1) ORDER BY id",
    )
    .bind(bookings)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn cancelling_an_unpaid_group_returns_the_voucher() {
    let Some(pool) = pool().await else { return };
    let mut f = fixture(&pool).await;
    attach_fixed_voucher(&pool, &mut f).await;
    let user_id = admin_id(&pool).await;
    let cancelled = run_group_action(
        &pool,
        user_id,
        f.bookings[0],
        GroupAction::Cancel,
        Some("Guest asked to cancel".to_string()),
    )
    .await;
    let voucher_id = f.voucher_id.unwrap();
    let voucher_status: String = sqlx::query_scalar("SELECT status FROM vouchers WHERE id = $1")
        .bind(voucher_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let redemption: (String, Option<String>) = sqlx::query_as(
        "SELECT status, reversal_reason FROM voucher_redemptions WHERE voucher_id = $1",
    )
    .bind(voucher_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let money = money_rows(&pool, &f.bookings).await;
    cleanup(&pool, &f).await;
    assert!(
        cancelled.is_ok(),
        "cancel unpaid group: {:?}",
        cancelled.err()
    );
    assert_eq!(voucher_status, "available");
    assert_eq!(redemption.0, "reversed");
    assert_eq!(
        redemption.1.as_deref(),
        Some("Unpaid group booking cancelled")
    );
    assert_eq!(
        money,
        vec![
            ("200.00".to_string(), "0.00".to_string(), "0.00".to_string()),
            ("200.00".to_string(), "0.00".to_string(), "0.00".to_string()),
        ]
    );
}

#[tokio::test]
async fn cancelling_a_paid_group_keeps_the_voucher() {
    let Some(pool) = pool().await else { return };
    let mut f = fixture(&pool).await;
    attach_fixed_voucher(&pool, &mut f).await;
    let user_id = admin_id(&pool).await;
    payments::record_group_desk_payment(&pool, user_id, f.group_id, "cash", None, None)
        .await
        .expect("pay the group first");
    run_group_action(
        &pool,
        user_id,
        f.bookings[0],
        GroupAction::Cancel,
        Some("Guest asked to cancel".to_string()),
    )
    .await
    .expect("cancel the paid group");
    let voucher_id = f.voucher_id.unwrap();
    let voucher_status: String = sqlx::query_scalar("SELECT status FROM vouchers WHERE id = $1")
        .bind(voucher_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let redemption: String =
        sqlx::query_scalar("SELECT status FROM voucher_redemptions WHERE voucher_id = $1")
            .bind(voucher_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let money = money_rows(&pool, &f.bookings).await;
    cleanup(&pool, &f).await;
    assert_eq!(voucher_status, "redeemed");
    assert_eq!(redemption, "applied");
    assert_eq!(
        money,
        vec![
            (
                "170.00".to_string(),
                "30.00".to_string(),
                "30.00".to_string()
            ),
            (
                "170.00".to_string(),
                "30.00".to_string(),
                "30.00".to_string()
            ),
        ]
    );
}
