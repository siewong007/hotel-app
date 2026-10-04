//! Guest support rings the staff bell in the same transaction as the write.
//!
//! Opening Contact hotel support, a later guest message, and a paid-cancellation
//! request each insert one `staff_notifications` row for `support:read`.
//! Repeating the same request does not insert another row. A staff reply does
//! not ring the bell, and nothing is queued to the guest's email.

use chrono::NaiveDate;
use hotel_app_be::modules::support::hub::SupportHub;
use hotel_app_be::modules::support::models::{
    CreateGuestSupportConversationRequest, GuestSupportMessageRequest, SupportMessageRequest,
};
use hotel_app_be::modules::support::service::{
    CancellationRequest, create_guest_conversation, open_cancellation_request, send_guest_message,
    send_staff_message,
};
use hotel_app_be::modules::system::repository as system_repository;
use sqlx::{PgPool, postgres::PgPoolOptions};

const GUEST_ID: i64 = 988_201;
const STAFF_ID: i64 = 988_202;
const ROOM_TYPE_ID: i64 = 988_301;
const ROOM_ID: i64 = 988_302;
const BOOKING_ID: i64 = 988_501;

async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping guest support notification test because DATABASE_URL is not set");
            return None;
        }
    };
    let guard = pg_serial_lock().lock_owned().await;
    let pool = PgPoolOptions::new()
        .max_connections(3)
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
        .expect("guest support notification test database must connect");
    Some((pool, guard))
}

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn seed(pool: &PgPool) {
    cleanup(pool).await;
    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'Support Bell Staff', 'staff', true, true)",
    )
    .bind(STAFF_ID)
    .bind(format!("gsb_staff_{STAFF_ID}"))
    .bind(format!("gsb-staff-{STAFF_ID}@hotel.local"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO user_roles (user_id, role_id) \
         SELECT $1, r.id FROM roles r WHERE r.name = 'receptionist' \
         ON CONFLICT DO NOTHING",
    )
    .bind(STAFF_ID)
    .execute(pool)
    .await
    .unwrap();
    hotel_app_be::core::rbac_cache::clear_all();

    sqlx::query(
        "INSERT INTO guests (id, nick_name, first_name, last_name, email, tourism_type) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Guest', 'Support', $3, 'local')",
    )
    .bind(GUEST_ID)
    .bind(format!("Gsb Guest {GUEST_ID}"))
    .bind(format!("gsb-guest-{GUEST_ID}@hotel.local"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy, keycard_deposit_amount, service_charge_percentage) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'GSB988', 'Support Bell Room', 100, 2, 0, 0)",
    )
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'GSB1', $2, 'available')",
    )
    .bind(ROOM_ID)
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status,
            tourism_tax_amount, extra_bed_charge
         ) OVERRIDING SYSTEM VALUE VALUES (
            $1, $2, $3, 'Guest Support', $4, $5,
            '2031-08-01', '2031-08-03', 1, 0,
            100, 200, 200, 'confirmed', 'paid', 0, 0
         )",
    )
    .bind(BOOKING_ID)
    .bind(format!("BK-GSB-{BOOKING_ID}"))
    .bind(GUEST_ID)
    .bind(format!("gsb-guest-{GUEST_ID}@hotel.local"))
    .bind(ROOM_ID)
    .execute(pool)
    .await
    .unwrap();
}

async fn cleanup(pool: &PgPool) {
    let numbers: Vec<String> = sqlx::query_scalar(
        "SELECT conversation_number FROM support_conversations WHERE guest_id = $1",
    )
    .bind(GUEST_ID)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for number in &numbers {
        sqlx::query("DELETE FROM staff_notifications WHERE subject = $1 OR subject LIKE $2")
            .bind(number)
            .bind(format!("{number}:%"))
            .execute(pool)
            .await
            .ok();
    }
    let conversation_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM support_conversations WHERE guest_id = $1")
            .bind(GUEST_ID)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    if !conversation_ids.is_empty() {
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'support_conversation' AND resource_id = ANY($1)",
        )
        .bind(&conversation_ids)
        .execute(pool)
        .await
        .ok();
    }
    sqlx::query("DELETE FROM support_conversations WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
        .bind(BOOKING_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM bookings WHERE id = $1")
        .bind(BOOKING_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(ROOM_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(ROOM_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
        .bind(STAFF_ID)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(STAFF_ID)
        .execute(pool)
        .await
        .ok();
}

async fn bell_count(pool: &PgPool, kind: &str, subject: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM staff_notifications WHERE kind = $1 AND subject = $2")
        .bind(kind)
        .bind(subject)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn conversation_number(pool: &PgPool, conversation_id: i64) -> String {
    sqlx::query_scalar("SELECT conversation_number FROM support_conversations WHERE id = $1")
        .bind(conversation_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn guest_support_rings_the_staff_bell_once_per_request() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };
    seed(&pool).await;
    let hub = SupportHub::default();

    let created = create_guest_conversation(
        &pool,
        &hub,
        GUEST_ID,
        CreateGuestSupportConversationRequest {
            category: "other".to_string(),
            message: "The air conditioning is loud".to_string(),
            booking_id: Some(BOOKING_ID),
            client_request_id: "gsb-open-1".to_string(),
        },
        None,
        None,
    )
    .await
    .expect("guest opens contact hotel support");
    let conversation_id = created.conversation.id;
    let number = conversation_number(&pool, conversation_id).await;
    assert_eq!(
        bell_count(&pool, "guest_support_conversation", &number).await,
        1,
        "opening support inserts one conversation bell"
    );
    assert_eq!(
        bell_count(
            &pool,
            "guest_support_message",
            &format!("{number}:gsb-open-1")
        )
        .await,
        0,
        "the opening message is the same request, not a second bell"
    );

    let audience: String = sqlx::query_scalar(
        "SELECT audience_permission FROM staff_notifications \
         WHERE kind = 'guest_support_conversation' AND subject = $1",
    )
    .bind(&number)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audience, "support:read");

    let again = create_guest_conversation(
        &pool,
        &hub,
        GUEST_ID,
        CreateGuestSupportConversationRequest {
            category: "other".to_string(),
            message: "The air conditioning is loud".to_string(),
            booking_id: Some(BOOKING_ID),
            client_request_id: "gsb-open-1".to_string(),
        },
        None,
        None,
    )
    .await
    .expect("repeat of the same open request");
    assert_eq!(again.conversation.id, conversation_id);
    assert_eq!(
        bell_count(&pool, "guest_support_conversation", &number).await,
        1,
        "repeating the open request must not insert a second bell"
    );

    let messaged = send_guest_message(
        &pool,
        &hub,
        GUEST_ID,
        conversation_id,
        GuestSupportMessageRequest {
            message: "It is still loud this morning".to_string(),
            client_message_id: Some("gsb-msg-1".to_string()),
            expected_version: Some(created.conversation.version),
        },
        None,
        None,
    )
    .await
    .expect("guest sends a follow-up");
    let message_subject = format!("{number}:gsb-msg-1");
    assert_eq!(
        bell_count(&pool, "guest_support_message", &message_subject).await,
        1
    );
    assert_eq!(
        bell_count(&pool, "guest_support_conversation", &number).await,
        1,
        "a follow-up does not add another conversation bell"
    );

    send_guest_message(
        &pool,
        &hub,
        GUEST_ID,
        conversation_id,
        GuestSupportMessageRequest {
            message: "It is still loud this morning".to_string(),
            client_message_id: Some("gsb-msg-1".to_string()),
            expected_version: Some(messaged.conversation.version),
        },
        None,
        None,
    )
    .await
    .expect("repeat of the same guest message");
    assert_eq!(
        bell_count(&pool, "guest_support_message", &message_subject).await,
        1,
        "repeating the same guest message must not insert a second bell"
    );

    let before_staff = bell_rows(&pool, &number).await;
    send_staff_message(
        &pool,
        &hub,
        STAFF_ID,
        conversation_id,
        SupportMessageRequest {
            message: "We will send engineering up".to_string(),
            client_message_id: Some("gsb-staff-1".to_string()),
            expected_version: Some(messaged.conversation.version),
        },
        None,
        None,
    )
    .await
    .expect("staff reply");
    assert_eq!(
        bell_rows(&pool, &number).await,
        before_staff,
        "a staff reply must not ring the bell"
    );

    let visible =
        system_repository::list_notifications(&pool, STAFF_ID, &["support:read".to_string()], 50)
            .await
            .unwrap();
    assert!(
        visible
            .iter()
            .any(|n| n.subject.as_deref() == Some(number.as_str())),
        "support:read sees the conversation bell"
    );
    assert!(
        visible
            .iter()
            .any(|n| n.subject.as_deref() == Some(message_subject.as_str()))
    );
    let via_manage =
        system_repository::list_notifications(&pool, STAFF_ID, &["support:manage".to_string()], 50)
            .await
            .unwrap();
    assert!(
        via_manage
            .iter()
            .any(|n| n.subject.as_deref() == Some(number.as_str())),
        "support:manage implies support:read for the bell"
    );
    let hidden = system_repository::list_notifications(
        &pool,
        STAFF_ID,
        &["housekeeping:read".to_string()],
        50,
    )
    .await
    .unwrap();
    assert!(!hidden.iter().any(|n| {
        n.subject.as_deref() == Some(number.as_str())
            || n.subject.as_deref() == Some(message_subject.as_str())
    }));

    let (cancel_id, cancel_number) = open_cancellation_request(
        &pool,
        &hub,
        CancellationRequest {
            guest_id: GUEST_ID,
            booking_id: BOOKING_ID,
            booking_number: &format!("BK-GSB-{BOOKING_ID}"),
            check_in_date: NaiveDate::from_ymd_opt(2031, 8, 1).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2031, 8, 3).unwrap(),
            reason: Some("Change of plans".to_string()),
            ip_address: None,
            user_agent: None,
        },
    )
    .await
    .expect("paid cancellation opens a support conversation");
    assert_ne!(cancel_id, conversation_id);
    assert_eq!(
        bell_count(&pool, "guest_support_conversation", &cancel_number).await,
        1
    );
    let cancel_title: String = sqlx::query_scalar(
        "SELECT title FROM staff_notifications \
         WHERE kind = 'guest_support_conversation' AND subject = $1",
    )
    .bind(&cancel_number)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cancel_title, "Cancellation request");

    let (again_id, again_number) = open_cancellation_request(
        &pool,
        &hub,
        CancellationRequest {
            guest_id: GUEST_ID,
            booking_id: BOOKING_ID,
            booking_number: &format!("BK-GSB-{BOOKING_ID}"),
            check_in_date: NaiveDate::from_ymd_opt(2031, 8, 1).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2031, 8, 3).unwrap(),
            reason: Some("Change of plans".to_string()),
            ip_address: None,
            user_agent: None,
        },
    )
    .await
    .expect("repeat cancellation returns the open request");
    assert_eq!(again_id, cancel_id);
    assert_eq!(again_number, cancel_number);
    assert_eq!(
        bell_count(&pool, "guest_support_conversation", &cancel_number).await,
        1,
        "a repeat cancellation must not insert a second bell"
    );

    let emails: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries WHERE guest_id = $1")
            .bind(GUEST_ID)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(emails, 0, "guest support must not email the guest");

    cleanup(&pool).await;
}

async fn bell_rows(pool: &PgPool, conversation_number: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM staff_notifications \
         WHERE subject = $1 OR subject LIKE $2",
    )
    .bind(conversation_number)
    .bind(format!("{conversation_number}:%"))
    .fetch_one(pool)
    .await
    .unwrap()
}
