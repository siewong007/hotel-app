//! A staff-approved group bank-transfer claim queues ONE payment confirmation
//! for the whole group instead of one per room. Opt-in through
//! `DATABASE_URL`; rows are committed by the services and hard-deleted after.
//! The recipient is an example.com address and nothing is sent: the email is
//! only queued in `email_deliveries`.
use hotel_app_be::modules::payments::service as payments;
use sqlx::{PgPool, postgres::PgPoolOptions};

struct Fixture {
    guest_id: i64,
    group_id: i64,
    group_number: String,
    bookings: Vec<i64>,
    room_type_id: i64,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 =
        sqlx::query_scalar("INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id")
            .bind(format!("Group Mail {tag}"))
            .bind(format!("group-mail-{tag}@example.com"))
            .fetch_one(pool)
            .await
            .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("GM{tag}"))
    .bind(format!("Mail Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_number = format!("GGM{tag}");
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, '2031-05-10', '2031-05-12') RETURNING id",
    )
    .bind(&group_number)
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut bookings = Vec::new();
    for (i, total) in ["120.00", "80.25"].iter().enumerate() {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("GM{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, '2031-05-10', '2031-05-12', 100.00, $4::numeric, $4::numeric, \
                 'pending_payment', 'unpaid', 'MYR', $5) RETURNING id",
        )
        .bind(format!("BGM{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(total)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        bookings.push(id);
    }
    Fixture {
        guest_id,
        group_id,
        group_number,
        bookings,
        room_type_id,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    let _ = sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    for sql in [
        "DELETE FROM payments WHERE booking_id = ANY($1)",
        "DELETE FROM booking_history WHERE booking_id = ANY($1)",
        "DELETE FROM bookings WHERE id = ANY($1)",
    ] {
        let _ = sqlx::query(sql).bind(&f.bookings).execute(pool).await;
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

#[tokio::test]
async fn approving_a_group_claim_queues_one_group_payment_email() {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        return;
    };
    // SAFETY: set before any config read in this binary (single test).
    unsafe {
        if std::env::var("JWT_SECRET").is_err() {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    let _ = hotel_app_be::core::config::init_from_env();
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET app.allow_audit_mutation = 'on'")
                    .execute(conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&database_url)
        .await
        .expect("connect");
    let actor: i64 = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("a staff user exists in the test database");

    let f = fixture(&pool).await;
    let claim = payments::create_group_bank_transfer_claim(&pool, f.guest_id, f.group_id)
        .await
        .expect("claim");
    assert_eq!(claim.payment_ids.len(), 2);
    payments::approve_payment(&pool, actor, claim.payment_ids[0])
        .await
        .expect("approve");

    let mails: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT idempotency_key, recipient_email, COALESCE(body_text, '') FROM email_deliveries \
         WHERE guest_id = $1 AND (idempotency_key LIKE 'payment-confirmed:%' \
            OR idempotency_key LIKE 'group-payment-confirmed:%')",
    )
    .bind(f.guest_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let result = std::panic::catch_unwind(|| {
        assert_eq!(mails.len(), 1, "exactly one confirmation: {mails:?}");
        let (key, recipient, body) = &mails[0];
        assert_eq!(
            key,
            &format!("group-payment-confirmed:{}", claim.group_payment_ref)
        );
        assert!(recipient.ends_with("@example.com"));
        assert!(
            body.contains(&f.group_number),
            "group number missing: {body}"
        );
        assert!(body.contains("200.25"), "group amount missing: {body}");
    });
    cleanup(&pool, &f).await;
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
