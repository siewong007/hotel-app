//! What one payment for a multi-room booking covers, and how its claim is
//! rejected. Every unpaid room is charged its full billable total (room
//! charge + tourism tax + extra beds), so an approved claim leaves each room
//! `paid`, never `partial`; and an overdue receipt request on one room
//! rejects the whole claim, so a group is never left part-claimed.
//! Opt-in through `DATABASE_URL`; rows are hard-deleted before asserting.
use hotel_app_be::modules::booking_groups::repository::BookingGroupRepository;
use hotel_app_be::modules::payments::service as payments;
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};

fn dec(value: &str) -> Decimal {
    value.parse().unwrap()
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
            .connect(&url)
            .await
            .expect("connect"),
    )
}

struct Fx {
    tag: String,
    guest_id: i64,
    room_type_id: i64,
    group_id: i64,
    rooms: Vec<i64>,
}

/// Two rooms awaiting payment for 2 nights: room 1 is 200.00 + 20.00 tourism
/// tax + 60.00 for an extra bed, room 2 is 200.00 + 20.00 tourism tax.
async fn fixture(pool: &PgPool) -> Fx {
    // Random, not clock-based: two tests in this binary start in the same
    // microsecond on macOS.
    let tag = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let guest_id: i64 =
        // Foreign: the bookings trigger derives tourism tax from tourism_type.
        sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email, tourism_type) VALUES ($1, $2, 'foreign') RETURNING id",
        )
            .bind(format!("Group Pay {tag}"))
            .bind(format!("group-pay-{tag}@example.com"))
            .fetch_one(pool)
            .await
            .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("GP{tag}"))
    .bind(format!("Group Pay Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, CURRENT_DATE + 25, CURRENT_DATE + 27) RETURNING id",
    )
    .bind(format!("GGP{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut rooms = Vec::new();
    for (i, (beds, extra_bed)) in [(1, "60.00"), (0, "0")].iter().enumerate() {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("GP{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, source, \
                 is_tourist, tourism_tax_amount, extra_bed_count, extra_bed_charge, booking_group_id) \
             VALUES ($1, $2, $3, CURRENT_DATE + 25, CURRENT_DATE + 27, 100.00, 200.00, 200.00, \
                 'pending_payment', 'unpaid', 'MYR', 'website', true, 20.00, $4, $5::numeric, $6) \
             RETURNING id",
        )
        .bind(format!("BGP{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(beds)
        .bind(extra_bed)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        rooms.push(id);
    }
    let mut tx = pool.begin().await.unwrap();
    BookingGroupRepository::refresh_totals_tx(&mut tx, group_id)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    Fx {
        tag,
        guest_id,
        room_type_id,
        group_id,
        rooms,
    }
}

async fn cleanup(pool: &PgPool, f: &Fx) {
    let _ = sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM staff_notifications WHERE subject = $1")
        .bind(format!("GGP{}", f.tag))
        .execute(pool)
        .await;
    for sql in [
        "DELETE FROM payment_receipt_requests WHERE payment_id IN \
         (SELECT id FROM payments WHERE booking_id = ANY($1))",
        "DELETE FROM payments WHERE booking_id = ANY($1)",
        "DELETE FROM booking_history WHERE booking_id = ANY($1)",
        "DELETE FROM bookings WHERE id = ANY($1)",
    ] {
        let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(&f.rooms)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM booking_groups WHERE id = $1")
        .bind(f.group_id)
        .execute(pool)
        .await;
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

async fn admin_id(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT id FROM users WHERE username = 'admin'")
        .fetch_one(pool)
        .await
        .expect("seeded admin")
}

async fn room_states(pool: &PgPool, f: &Fx) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT status, COALESCE(payment_status, 'unpaid') FROM bookings \
         WHERE id = ANY($1) ORDER BY id",
    )
    .bind(&f.rooms)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// The claim asks for what the guest was shown (500.00 = 280.00 + 220.00),
/// and once staff approve it every room and the group are `paid`.
#[tokio::test]
async fn group_claim_charges_tourism_tax_and_extra_beds() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool).await;
    let admin = admin_id(&pool).await;

    let claim = payments::create_group_bank_transfer_claim(&pool, f.guest_id, f.group_id).await;
    let (claimed, per_room) = match &claim {
        Ok(claim) => {
            let per_room: Vec<Decimal> = sqlx::query_scalar(
                "SELECT amount FROM payments WHERE id = ANY($1) ORDER BY booking_id",
            )
            .bind(&claim.payment_ids)
            .fetch_all(&pool)
            .await
            .unwrap();
            (Some(claim.amount), per_room)
        }
        Err(_) => (None, Vec::new()),
    };
    let approved = match &claim {
        Ok(claim) => Some(
            payments::approve_payment(&pool, admin, claim.payment_ids[0])
                .await
                .map(|_| ()),
        ),
        Err(_) => None,
    };
    let rooms = room_states(&pool, &f).await;
    let group: String =
        sqlx::query_scalar("SELECT payment_status FROM booking_groups WHERE id = $1")
            .bind(f.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    cleanup(&pool, &f).await;

    assert!(claim.is_ok(), "claim: {:?}", claim.err());
    assert_eq!(
        claimed,
        Some(dec("500.00")),
        "room + tourism tax + extra beds"
    );
    assert_eq!(per_room, vec![dec("280.00"), dec("220.00")]);
    assert!(matches!(approved, Some(Ok(()))), "approve: {approved:?}");
    assert_eq!(
        rooms,
        vec![
            ("confirmed".to_string(), "paid".to_string()),
            ("confirmed".to_string(), "paid".to_string()),
        ],
        "an approved group claim settles every room in full"
    );
    assert_eq!(group, "paid");
}

/// Staff asked for a receipt on one room's half of a group claim and nothing
/// arrived: the expiry sweep rejects the claim for both rooms together.
#[tokio::test]
async fn overdue_receipt_request_rejects_the_whole_group_claim() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool).await;
    let admin = admin_id(&pool).await;

    let claim = payments::create_group_bank_transfer_claim(&pool, f.guest_id, f.group_id)
        .await
        .map_err(|error| format!("{error:?}"));
    let swept = match &claim {
        Ok(claim) => {
            sqlx::query(
                "INSERT INTO payment_receipt_requests (payment_id, requested_by, request_message, \
                     requested_at) \
                 VALUES ($1, $2, 'Please upload the transfer slip', \
                     CURRENT_TIMESTAMP - INTERVAL '36 hours')",
            )
            .bind(claim.payment_ids[0])
            .bind(admin)
            .execute(&pool)
            .await
            .unwrap();
            Some(
                payments::reject_expired_receipt_requests(&pool)
                    .await
                    .map_err(|error| format!("{error:?}")),
            )
        }
        Err(_) => None,
    };
    let payment_statuses: Vec<String> = match &claim {
        Ok(claim) => sqlx::query_scalar(
            "SELECT status::text FROM payments WHERE id = ANY($1) ORDER BY booking_id",
        )
        .bind(&claim.payment_ids)
        .fetch_all(&pool)
        .await
        .unwrap(),
        Err(_) => Vec::new(),
    };
    let rooms = room_states(&pool, &f).await;
    cleanup(&pool, &f).await;

    assert!(claim.is_ok(), "claim: {claim:?}");
    assert!(matches!(swept, Some(Ok(_))), "sweep: {swept:?}");
    assert_eq!(
        payment_statuses,
        ["void", "void"],
        "both rooms' claims are rejected, not just the one with the request"
    );
    assert_eq!(
        rooms,
        vec![
            ("pending_payment".to_string(), "unpaid".to_string()),
            ("pending_payment".to_string(), "unpaid".to_string()),
        ],
        "both rooms go back to awaiting payment together"
    );
}
