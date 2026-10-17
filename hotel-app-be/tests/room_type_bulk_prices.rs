//! Live-PostgreSQL coverage for the bulk room-type price update: preview,
//! guarded apply, audit row, one-level revert and the stale-revert refusal.
//! Skipped without `DATABASE_URL`. One test function because revert reads the
//! global "latest bulk change" audit head.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::modules::rooms::bulk_prices::{self as bp, BulkPriceRequest, PriceMethod};
use hotel_app_be::modules::rooms::queries as rq;
use rust_decimal::Decimal;
use sqlx::{PgPool, Row};

async fn make_type(pool: &PgPool, base: i64, weekday: Option<i64>, weekend: Option<i64>) -> i64 {
    let code = format!("TB{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    let name = format!("Bulk Price Test {code}");
    rq::insert_room_type(
        pool,
        rq::NewRoomType {
            name: &name,
            code: &code,
            description: &None,
            base_price: Decimal::from(base),
            weekday_rate: weekday.map(Decimal::from),
            weekend_rate: weekend.map(Decimal::from),
            max_occupancy: 2,
            bed_type: &None,
            bed_count: 1,
            allows_extra_bed: false,
            max_extra_beds: 0,
            extra_bed_charge: Decimal::ZERO,
            sort_order: 0,
        },
    )
    .await
    .expect("insert room type")
}

async fn prices(pool: &PgPool, id: i64) -> (Decimal, Option<Decimal>, Option<Decimal>) {
    let r =
        sqlx::query("SELECT base_price, weekday_rate, weekend_rate FROM room_types WHERE id=$1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    (r.get(0), r.get(1), r.get(2))
}

fn req(ids: &[i64], method: PriceMethod, value: f64) -> BulkPriceRequest {
    BulkPriceRequest {
        room_type_ids: ids.to_vec(),
        fields: vec![
            "base_price".into(),
            "weekday_rate".into(),
            "weekend_rate".into(),
        ],
        method,
        value,
        round_to: None,
        reason: Some("Integration test".into()),
        confirm_large_change: false,
    }
}

#[tokio::test]
async fn bulk_price_update_preview_audit_and_revert() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        eprintln!("Skipping bulk price test because DATABASE_URL is not set");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("connect");
    // audit_logs.user_id is a foreign key; reuse any existing user.
    let Some(uid) = sqlx::query_scalar::<_, i64>("SELECT id FROM users ORDER BY id LIMIT 1")
        .fetch_optional(&pool)
        .await
        .unwrap()
    else {
        eprintln!("Skipping bulk price test: no users in database");
        return;
    };
    let a = make_type(&pool, 100, Some(100), Some(110)).await;
    let b = make_type(&pool, 200, Some(200), None).await;
    let ids = [a, b];

    // Preview writes nothing.
    let p = bp::preview(&pool, &req(&ids, PriceMethod::Percent, 10.0))
        .await
        .unwrap();
    assert_eq!(p.changed_room_types, 2);
    assert_eq!(prices(&pool, a).await.0, Decimal::from(100));

    // Unknown id, missing reason and unconfirmed large change are refused and write nothing.
    assert!(matches!(
        bp::preview(&pool, &req(&[a, i64::MAX], PriceMethod::Percent, 5.0)).await,
        Err(ApiError::NotFound(_))
    ));
    let mut no_reason = req(&ids, PriceMethod::Percent, 10.0);
    no_reason.reason = None;
    assert!(bp::apply(&pool, uid, &no_reason).await.is_err());
    assert!(
        bp::apply(&pool, uid, &req(&ids, PriceMethod::Percent, 50.0))
            .await
            .is_err()
    );
    assert_eq!(prices(&pool, a).await.0, Decimal::from(100));

    // Apply +10%: weekend stays NULL for type b.
    let res = bp::apply(&pool, uid, &req(&ids, PriceMethod::Percent, 10.0))
        .await
        .unwrap();
    assert_eq!(
        prices(&pool, a).await,
        (
            Decimal::from(110),
            Some(Decimal::from(110)),
            Some(Decimal::from(121))
        )
    );
    assert_eq!(
        prices(&pool, b).await,
        (Decimal::from(220), Some(Decimal::from(220)), None)
    );

    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE action='room_prices_bulk_updated' AND details->>'batch_id'=$1 AND user_id=$2",
    )
    .bind(&res.batch_id)
    .bind(uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(n, 1);

    let last = bp::last_change(&pool).await.unwrap().unwrap();
    assert_eq!(last.batch_id, res.batch_id);
    assert!(last.can_revert);

    // A later manual price edit makes the revert unsafe -> Conflict, nothing changes.
    sqlx::query("UPDATE room_types SET base_price = 111 WHERE id=$1")
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
    let reason = Some("Undo test".to_string());
    assert!(matches!(
        bp::revert_last(&pool, uid, &reason).await,
        Err(ApiError::Conflict(_))
    ));
    assert_eq!(prices(&pool, b).await.0, Decimal::from(220));
    sqlx::query("UPDATE room_types SET base_price = 110 WHERE id=$1")
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();

    // Revert restores the old prices, then there is nothing left to revert.
    assert!(bp::revert_last(&pool, uid, &None).await.is_err());
    let rev = bp::revert_last(&pool, uid, &reason).await.unwrap();
    assert_eq!(rev.batch_id, res.batch_id);
    assert!(!rev.can_revert);
    assert_eq!(
        prices(&pool, a).await,
        (
            Decimal::from(100),
            Some(Decimal::from(100)),
            Some(Decimal::from(110))
        )
    );
    assert_eq!(
        prices(&pool, b).await,
        (Decimal::from(200), Some(Decimal::from(200)), None)
    );
    assert!(matches!(
        bp::revert_last(&pool, uid, &reason).await,
        Err(ApiError::Conflict(_))
    ));

    // Confirmed large change goes through.
    let mut big = req(&ids, PriceMethod::Percent, 50.0);
    big.confirm_large_change = true;
    bp::apply(&pool, uid, &big).await.unwrap();
    assert_eq!(prices(&pool, a).await.0, Decimal::from(150));

    sqlx::query("DELETE FROM room_types WHERE id = ANY($1)")
        .bind(&ids[..])
        .execute(&pool)
        .await
        .unwrap();
}
