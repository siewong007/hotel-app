//! Fixed-voucher re-split when a multi-room booking's rooms change
//! (`booking_groups::voucher_resplit` + guest add-room).
//! Opt-in through `DATABASE_URL`; fixtures are deleted afterwards.
use hotel_app_be::core::error::ApiError;
use hotel_app_be::modules::booking_groups::repository::BookingGroupRepository;
use hotel_app_be::modules::booking_groups::voucher_resplit::{ShareRelease, release_room_share_tx};
use hotel_app_be::modules::bookings::service::cancel_pending_booking_by_guest;
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};

fn d(value: &str) -> Decimal {
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
    user_id: i64,
    room_type_id: i64,
    promotion_id: i64,
    group_id: i64,
    rooms: Vec<i64>,
}

/// A group of `shares.len()` unpaid rooms (2 nights × 100) whose fixed
/// voucher was split as `shares`.
async fn fixture(pool: &PgPool, shares: &[&str]) -> Fx {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (first_name, last_name, nick_name, email, phone, ic_number) \
         VALUES ('Split', 'Guest', $1, $2, '+60123456789', 'A1234567') RETURNING id",
    )
    .bind(format!("Split {tag}"))
    .bind(format!("split-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let user_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, email, password_hash, full_name, user_type, guest_id, \
             is_active, is_verified) \
         VALUES ($1, $2, 'x', 'Split Guest', 'guest', $3, true, true) RETURNING id",
    )
    .bind(format!("split{tag}"))
    .bind(format!("split-user-{tag}@example.com"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("VS{tag}"))
    .bind(format!("Split Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let promotion_id: i64 = sqlx::query_scalar(
        "INSERT INTO promotions (slug, name, discount_type, discount_value, currency) \
         VALUES ($1, $2, 'fixed_amount', 60.00, 'MYR') RETURNING id",
    )
    .bind(format!("split-{tag}"))
    .bind(format!("Split {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let voucher_id: i64 = sqlx::query_scalar(
        "INSERT INTO vouchers (promotion_id, guest_id, code, source) \
         VALUES ($1, $2, $3, 'admin_issue') RETURNING id",
    )
    .bind(promotion_id)
    .bind(guest_id)
    .bind(format!("SPLIT{tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date, voucher_id) \
         VALUES ($1, $2, CURRENT_DATE + 20, CURRENT_DATE + 22, $3) RETURNING id",
    )
    .bind(format!("GVS{tag}"))
    .bind(guest_id)
    .bind(voucher_id)
    .fetch_one(pool)
    .await
    .unwrap();
    for n in 0..6 {
        sqlx::query(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true)",
        )
        .bind(format!("VS{n}{tag}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();
    }
    let room_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM rooms WHERE room_type_id = $1 ORDER BY id")
            .bind(room_type_id)
            .fetch_all(pool)
            .await
            .unwrap();
    let mut rooms = Vec::new();
    for (n, share) in shares.iter().enumerate() {
        let share = d(share);
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, discount_amount, total_amount, status, payment_status, currency, \
                 source, group_voucher_share) \
             VALUES ($1, $2, $3, CURRENT_DATE + 20, CURRENT_DATE + 22, 100.00, 200.00, $4, $5, \
                 'pending_payment', 'unpaid', 'MYR', 'website', $4) RETURNING id",
        )
        .bind(format!("BVS{n}{tag}"))
        .bind(guest_id)
        .bind(room_ids[n])
        .bind(share)
        .bind(d("200.00") - share)
        .fetch_one(pool)
        .await
        .unwrap();
        rooms.push(id);
    }
    let mut tx = pool.begin().await.unwrap();
    BookingGroupRepository::attach_tx(&mut tx, group_id, &rooms)
        .await
        .unwrap();
    BookingGroupRepository::refresh_totals_tx(&mut tx, group_id)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    Fx {
        tag,
        guest_id,
        user_id,
        room_type_id,
        promotion_id,
        group_id,
        rooms,
    }
}

async fn mark_paid(pool: &PgPool, booking_id: i64) {
    sqlx::query("UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = $1")
        .bind(booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO payments (uuid, booking_id, amount, currency, payment_method, status) \
         SELECT gen_random_uuid(), id, total_amount, 'MYR', 'bank_transfer', 'completed' \
         FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn share_and_total(pool: &PgPool, booking_id: i64) -> (Decimal, Decimal, Decimal) {
    sqlx::query_as(
        "SELECT group_voucher_share, COALESCE(discount_amount, 0), total_amount \
         FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn cleanup(pool: &PgPool, f: &Fx) {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM bookings WHERE guest_id = $1")
        .bind(f.guest_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for sql in [
        "DELETE FROM payments WHERE booking_id = ANY($1)",
        "DELETE FROM consent_records WHERE booking_id = ANY($1)",
        "DELETE FROM booking_history WHERE booking_id = ANY($1)",
        "DELETE FROM bookings WHERE id = ANY($1)",
    ] {
        let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(&ids)
            .execute(pool)
            .await;
    }
    for sql in [
        "DELETE FROM consent_records WHERE guest_id = $1",
        "DELETE FROM booking_groups WHERE guest_id = $1",
        "DELETE FROM vouchers WHERE guest_id = $1",
        "DELETE FROM users WHERE guest_id = $1",
        "DELETE FROM guests WHERE id = $1",
    ] {
        let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(f.guest_id)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM promotions WHERE id = $1")
        .bind(f.promotion_id)
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

/// Run `body`, always clean up, then re-raise any failure.
macro_rules! scenario {
    ($pool:ident, $f:ident, $body:block) => {{
        let result = async { $body }.await;
        cleanup(&$pool, &$f).await;
        result
    }};
}

// Points 1 + 7: an unpaid room's share moves to the other unpaid rooms in
// cents, summing exactly; the group refreshes.
#[tokio::test]
async fn unpaid_room_removed_resplits_exact_cents() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["33.33", "13.33", "13.34"]).await;
    scenario!(pool, f, {
        cancel_pending_booking_by_guest(&pool, f.user_id, f.rooms[0], None)
            .await
            .expect("cancel unpaid room");
        let (s1, d1, t1) = share_and_total(&pool, f.rooms[1]).await;
        let (s2, d2, t2) = share_and_total(&pool, f.rooms[2]).await;
        assert_eq!(s1 + s2, d("60.00"), "whole voucher still applied");
        assert_eq!((s1 - d("13.33")) + (s2 - d("13.34")), d("33.33"));
        assert!(s1.scale() <= 2 && s2.scale() <= 2);
        assert_eq!((d1, d2), (s1, s2));
        assert_eq!(t1 + t2, d("340.00"));
        let (rooms, discount): (i32, Decimal) =
            sqlx::query_as("SELECT room_count, discount_amount FROM booking_groups WHERE id = $1")
                .bind(f.group_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((rooms, discount), (2, d("60.00")));
        let (removed_share, _, _) = share_and_total(&pool, f.rooms[0]).await;
        assert_eq!(removed_share, Decimal::ZERO);
    });
}

// Point 1: a paid room's share is frozen — it receives nothing.
#[tokio::test]
async fn paid_room_share_is_frozen() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["20.00", "20.00", "20.00"]).await;
    scenario!(pool, f, {
        mark_paid(&pool, f.rooms[1]).await;
        cancel_pending_booking_by_guest(&pool, f.user_id, f.rooms[0], None)
            .await
            .expect("cancel unpaid room");
        assert_eq!(
            share_and_total(&pool, f.rooms[1]).await,
            (d("20.00"), d("20.00"), d("180.00")),
            "paid room never re-priced"
        );
        assert_eq!(
            share_and_total(&pool, f.rooms[2]).await,
            (d("40.00"), d("40.00"), d("160.00"))
        );
    });
}

// Point 2: a removed paid room's share is dropped; nobody pays more.
#[tokio::test]
async fn removed_paid_room_share_is_dropped() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["20.00", "20.00", "20.00"]).await;
    scenario!(pool, f, {
        mark_paid(&pool, f.rooms[0]).await;
        let mut tx = pool.begin().await.unwrap();
        BookingGroupRepository::lock_tx(&mut tx, f.group_id)
            .await
            .unwrap();
        let release = release_room_share_tx(&mut tx, f.rooms[0], None)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(release, ShareRelease::Dropped { share: d("20.00") });
        for id in &f.rooms[1..] {
            assert_eq!(
                share_and_total(&pool, *id).await,
                (d("20.00"), d("20.00"), d("180.00"))
            );
        }
    });
}

// Point 6: the moved share is capped at what the unpaid rooms still owe.
#[tokio::test]
async fn resplit_is_capped_so_no_room_goes_negative() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["50.00", "190.00", "20.00"]).await;
    scenario!(pool, f, {
        mark_paid(&pool, f.rooms[2]).await;
        let mut tx = pool.begin().await.unwrap();
        BookingGroupRepository::lock_tx(&mut tx, f.group_id)
            .await
            .unwrap();
        let release = release_room_share_tx(&mut tx, f.rooms[0], None)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(
            release,
            ShareRelease::Moved {
                share: d("50.00"),
                moves: vec![(f.rooms[1], d("10.00"))],
                dropped: d("40.00"),
            }
        );
        assert_eq!(
            share_and_total(&pool, f.rooms[1]).await,
            (d("200.00"), d("200.00"), d("0.00"))
        );
    });
}

// Point 4: once any room is checked in, rooms can't be removed online.
#[tokio::test]
async fn checked_in_room_blocks_removal() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["20.00", "20.00", "20.00"]).await;
    scenario!(pool, f, {
        sqlx::query(
            "UPDATE bookings SET status = 'checked_in', payment_status = 'paid' WHERE id = $1",
        )
        .bind(f.rooms[2])
        .execute(&pool)
        .await
        .unwrap();
        let error = cancel_pending_booking_by_guest(&pool, f.user_id, f.rooms[0], None)
            .await
            .expect_err("blocked");
        assert!(matches!(error, ApiError::GroupRoomCheckedIn), "{error:?}");
        assert_eq!(
            share_and_total(&pool, f.rooms[0]).await,
            (d("20.00"), d("20.00"), d("180.00"))
        );
    });
}

// Point 5: a concurrent change holding the group lock gets "try again".
#[tokio::test]
async fn busy_group_rejects_removal() {
    let Some(pool) = pool().await else { return };
    let f = fixture(&pool, &["20.00", "20.00"]).await;
    scenario!(pool, f, {
        let mut holder = pool.begin().await.unwrap();
        BookingGroupRepository::lock_tx(&mut holder, f.group_id)
            .await
            .unwrap();
        let error = cancel_pending_booking_by_guest(&pool, f.user_id, f.rooms[0], None)
            .await
            .expect_err("busy");
        holder.rollback().await.unwrap();
        assert!(matches!(error, ApiError::GroupBusy), "{error:?}");
        cancel_pending_booking_by_guest(&pool, f.user_id, f.rooms[0], None)
            .await
            .expect("works once the lock is free");
    });
}

mod add_room {
    use super::*;
    use hotel_app_be::modules::consent::models::{ConsentAcceptance, ConsentDocument};
    use hotel_app_be::modules::guest_booking::availability::AvailabilityHub;
    use hotel_app_be::modules::guest_booking::group::{
        self, AddGroupRoomRequest, GroupQuoteRequest, GroupRoomRequest,
    };

    fn granted(document: ConsentDocument) -> ConsentAcceptance {
        ConsentAcceptance {
            document,
            version: document.current_version().to_string(),
            granted: true,
            locale: "en".to_string(),
        }
    }

    async fn request(pool: &PgPool, f: &Fx, n: u8) -> AddGroupRoomRequest {
        let (check_in, check_out): (chrono::NaiveDate, chrono::NaiveDate) = sqlx::query_as(
            "SELECT check_in_date, check_out_date FROM booking_groups WHERE id = $1",
        )
        .bind(f.group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let room = GroupRoomRequest {
            room_type_id: f.room_type_id,
            adults: Some(1),
            children: Some(0),
            extra_beds: None,
        };
        let quote = group::quote_group(
            pool,
            Some(f.guest_id),
            &GroupQuoteRequest {
                check_in_date: check_in.to_string(),
                check_out_date: check_out.to_string(),
                rooms: vec![room.clone()],
                tourism_type: None,
                discounts: Default::default(),
            },
        )
        .await
        .expect("quote");
        AddGroupRoomRequest {
            client_request_id: format!("add-{}-{n}", f.tag),
            room,
            expected_total: quote.total_amount,
            smoking_preference: None,
            consents: vec![
                granted(ConsentDocument::TermsOfService),
                granted(ConsentDocument::PrivacyNotice),
            ],
        }
    }

    // Point 3, as the owner amended it on 2026-11-01 (a group is never left
    // part-paid, so rooms can only be added while nothing is paid): the new
    // room is unpaid, at list price, takes no voucher share, and the next
    // group payment covers it together with the other rooms.
    #[tokio::test]
    async fn added_room_takes_no_share_and_joins_the_group_payment() {
        let Some(pool) = pool().await else { return };
        let f = fixture(&pool, &["30.00", "30.00"]).await;
        scenario!(pool, f, {
            let hub = AvailabilityHub::default();
            let req = request(&pool, &f, 1).await;
            let expected = req.expected_total;
            let confirmation =
                group::add_room_for_guest(&pool, &hub, f.guest_id, f.group_id, req, None, None)
                    .await
                    .expect("add room");
            assert_eq!(confirmation.room_count, 3);
            let added: i64 = sqlx::query_scalar(
                "SELECT id FROM bookings WHERE booking_group_id = $1 AND id <> ALL($2)",
            )
            .bind(f.group_id)
            .bind(&f.rooms)
            .fetch_one(&pool)
            .await
            .unwrap();
            let (share, discount, total) = share_and_total(&pool, added).await;
            assert_eq!((share, discount), (Decimal::ZERO, Decimal::ZERO));
            assert_eq!(total, d("200.00"), "list price, no voucher");
            let payment_status: String =
                sqlx::query_scalar("SELECT payment_status FROM bookings WHERE id = $1")
                    .bind(added)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(payment_status, "unpaid");
            // The existing rooms keep their shares.
            for id in &f.rooms {
                assert_eq!(
                    share_and_total(&pool, *id).await,
                    (d("30.00"), d("30.00"), d("170.00"))
                );
            }
            // Replay is idempotent.
            let again = group::add_room_for_guest(
                &pool,
                &hub,
                f.guest_id,
                f.group_id,
                request(&pool, &f, 1).await,
                None,
                None,
            )
            .await
            .expect("replay");
            assert_eq!(again.room_count, 3);
            // One group payment covers all three rooms: 2 × 170.00 plus the
            // new room's quoted total.
            let claim = hotel_app_be::modules::payments::service::create_group_bank_transfer_claim(
                &pool, f.guest_id, f.group_id,
            )
            .await
            .expect("claim");
            assert_eq!(claim.payment_ids.len(), 3);
            assert_eq!(claim.amount, d("340.00") + expected);
        });
    }

    // "Once paid, it's locked in": a transfer claim under review, or a
    // completed payment on any room, refuses the add and writes nothing.
    #[tokio::test]
    async fn adding_is_refused_once_money_has_moved() {
        let Some(pool) = pool().await else { return };
        let hub = AvailabilityHub::default();

        let f = fixture(&pool, &["30.00", "30.00"]).await;
        scenario!(pool, f, {
            hotel_app_be::modules::payments::service::create_group_bank_transfer_claim(
                &pool, f.guest_id, f.group_id,
            )
            .await
            .expect("claim");
            let under_review = group::add_room_for_guest(
                &pool,
                &hub,
                f.guest_id,
                f.group_id,
                request(&pool, &f, 1).await,
                None,
                None,
            )
            .await
            .expect_err("claim under review");
            assert!(
                matches!(under_review, ApiError::GroupPaid),
                "{under_review:?}"
            );
            let rooms: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1")
                    .bind(f.group_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(rooms, 2, "nothing added");
        });

        let f = fixture(&pool, &["30.00", "30.00"]).await;
        scenario!(pool, f, {
            mark_paid(&pool, f.rooms[0]).await;
            let paid = group::add_room_for_guest(
                &pool,
                &hub,
                f.guest_id,
                f.group_id,
                request(&pool, &f, 2).await,
                None,
                None,
            )
            .await
            .expect_err("paid");
            assert!(matches!(paid, ApiError::GroupPaid), "{paid:?}");
            let rooms: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1")
                    .bind(f.group_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(rooms, 2, "nothing added");
        });
    }

    // Points 4 + 5 for adding.
    #[tokio::test]
    async fn adding_is_blocked_when_checked_in_or_busy() {
        let Some(pool) = pool().await else { return };
        let f = fixture(&pool, &["30.00", "30.00"]).await;
        scenario!(pool, f, {
            let hub = AvailabilityHub::default();
            let mut holder = pool.begin().await.unwrap();
            BookingGroupRepository::lock_tx(&mut holder, f.group_id)
                .await
                .unwrap();
            let busy = group::add_room_for_guest(
                &pool,
                &hub,
                f.guest_id,
                f.group_id,
                request(&pool, &f, 1).await,
                None,
                None,
            )
            .await
            .expect_err("busy");
            holder.rollback().await.unwrap();
            assert!(matches!(busy, ApiError::GroupBusy), "{busy:?}");

            sqlx::query(
                "UPDATE bookings SET status = 'checked_in', payment_status = 'paid' WHERE id = $1",
            )
            .bind(f.rooms[1])
            .execute(&pool)
            .await
            .unwrap();
            let arrived = group::add_room_for_guest(
                &pool,
                &hub,
                f.guest_id,
                f.group_id,
                request(&pool, &f, 2).await,
                None,
                None,
            )
            .await
            .expect_err("checked in");
            assert!(
                matches!(arrived, ApiError::GroupRoomCheckedIn),
                "{arrived:?}"
            );
            let live: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1")
                    .bind(f.group_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(live, 2, "nothing added");
        });
    }
}
