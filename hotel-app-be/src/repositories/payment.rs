//! Payment repository for database operations

use crate::constants::PaymentStatus;
use crate::core::db::{DbPool, DbRow, DbTransaction, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    Invoice, InvoiceBookingDetails, PaidOnlineBookingRoomAssignment, Payment, PaymentBookingStay,
    PaymentEntryRow, PaymentReceiptFile, PaymentRequest, PaymentRoomPricing, PaymentSummary,
    PaymentWorkflowSummaryRow, PendingPaymentEntry, RecordPaymentRequest, UpdatePaymentRequest,
};
use rust_decimal::Decimal;
use sqlx::Row;

pub struct PaymentRepository;

#[derive(sqlx::FromRow)]
struct GeneratedInvoiceBookingDetailsRow {
    booking_id: i64,
    guest_id: i64,
    customer_name: String,
    customer_email: Option<String>,
    customer_phone: Option<String>,
    check_in: chrono::NaiveDateTime,
    check_out: chrono::NaiveDateTime,
    room_id: i64,
    room_number: String,
    room_type: String,
}

impl PaymentRepository {
    pub async fn paid_online_booking_room_assignment(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Option<PaidOnlineBookingRoomAssignment>, ApiError> {
        sqlx::query_as(crate::sql_query!(
            postgres: r#"
                SELECT b.id AS booking_id, b.booking_number, b.guest_id,
                       COALESCE(NULLIF(g.full_name, ''), 'Guest') AS guest_name,
                       g.email AS guest_email, r.room_number,
                       rt.name AS room_type_name, b.check_in_date, b.check_out_date
                FROM bookings b
                JOIN guests g ON g.id = b.guest_id
                JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id
                WHERE b.id = $1
                  AND b.portal_request_id IS NOT NULL
                  AND b.payment_status = 'paid'
                  AND g.email IS NOT NULL AND TRIM(g.email) <> ''
                  AND EXISTS (
                      SELECT 1 FROM payments p
                      WHERE p.booking_id = b.id AND p.status = 'completed'
                        AND p.payment_method IN ('card', 'duitnow', 'online_banking')
                  )
            "#,
            sqlite: r#"
                SELECT b.id AS booking_id, b.booking_number, b.guest_id,
                       COALESCE(NULLIF(g.full_name, ''), 'Guest') AS guest_name,
                       g.email AS guest_email, r.room_number,
                       rt.name AS room_type_name, b.check_in_date, b.check_out_date
                FROM bookings b
                JOIN guests g ON g.id = b.guest_id
                JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id
                WHERE b.id = ?1
                  AND b.portal_request_id IS NOT NULL
                  AND b.payment_status = 'paid'
                  AND g.email IS NOT NULL AND TRIM(g.email) <> ''
                  AND EXISTS (
                      SELECT 1 FROM payments p
                      WHERE p.booking_id = b.id AND p.status = 'completed'
                        AND p.payment_method IN ('card', 'duitnow', 'online_banking')
                  )
            "#
        ))
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn recompute_booking_payment_status(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let sql = r#"
            UPDATE bookings AS b
            SET payment_status = CASE
                WHEN b.status = 'voided' THEN 'void'
                WHEN COALESCE(b.is_complimentary, 0) = 1 THEN COALESCE(b.payment_status, 'paid')
                WHEN b.total_amount <= 0 THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0)
                     >= b.total_amount THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0
                    THEN 'partial'
                ELSE 'unpaid'
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE b.id = ?1
        "#;
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let sql = r#"
            UPDATE bookings AS b
            SET payment_status = CASE
                WHEN b.status = 'voided' THEN 'void'
                WHEN COALESCE(b.is_complimentary, false) THEN COALESCE(b.payment_status, 'paid')
                WHEN b.total_amount <= 0 THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0)
                     >= b.total_amount THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0
                    THEN 'partial'
                ELSE 'unpaid'
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE b.id = $1
        "#;

        sqlx::query(sql)
            .bind(booking_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(())
    }

    pub async fn recompute_booking_payment_status_tx(
        tx: &mut DbTransaction<'_>,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let sql = r#"
            UPDATE bookings AS b
            SET payment_status = CASE
                WHEN b.status = 'voided' THEN 'void'
                WHEN COALESCE(b.is_complimentary, 0) = 1 THEN COALESCE(b.payment_status, 'paid')
                WHEN b.total_amount <= 0 THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0)
                     >= b.total_amount THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0
                    THEN 'partial'
                ELSE 'unpaid'
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE b.id = ?1
        "#;
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let sql = r#"
            UPDATE bookings AS b
            SET payment_status = CASE
                WHEN b.status = 'voided' THEN 'void'
                WHEN COALESCE(b.is_complimentary, false) THEN COALESCE(b.payment_status, 'paid')
                WHEN b.total_amount <= 0 THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0)
                     >= b.total_amount THEN 'paid'
                WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
                        WHERE p.booking_id = b.id
                          AND p.status = 'completed'
                          AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0
                    THEN 'partial'
                ELSE 'unpaid'
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE b.id = $1
        "#;

        sqlx::query(sql)
            .bind(booking_id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;

        Ok(())
    }

    pub async fn payment_booking_stay(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<PaymentBookingStay, ApiError> {
        let (room_id, check_in, check_out) = sqlx::query_as(
            "SELECT room_id, check_in_date, check_out_date FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(PaymentBookingStay {
            room_id,
            check_in,
            check_out,
        })
    }

    pub async fn room_pricing(pool: &DbPool, room_id: i64) -> Result<PaymentRoomPricing, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
            FROM rooms r
            JOIN room_types rt ON r.room_type_id = rt.id
            WHERE r.id = $1
            "#,
        )
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(PaymentRoomPricing {
            base_price: row_mappers::get_decimal(&row, "base_price"),
            keycard_deposit: row_mappers::get_decimal(&row, "keycard_deposit_amount"),
            service_charge_percentage: row_mappers::get_decimal(&row, "service_charge_percentage"),
        })
    }

    pub async fn create_completed_payment(
        pool: &DbPool,
        user_id: i64,
        request: &PaymentRequest,
        summary: &PaymentSummary,
        payment_gateway: Option<&str>,
    ) -> Result<Payment, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        // Reject a second completed payment for the booking. The real column is
        // `status` (there is no `payment_status` column); placeholders are
        // cfg-gated for each engine.
        let existing_sql = crate::sql_query!(
            postgres: "SELECT id FROM payments WHERE booking_id = $1 AND status = $2 LIMIT 1",
            sqlite: "SELECT id FROM payments WHERE booking_id = ?1 AND status = ?2 LIMIT 1"
        );
        let existing_payment: Option<i64> = sqlx::query_scalar(existing_sql)
            .bind(request.booking_id)
            .bind(PaymentStatus::Completed.to_string())
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        if existing_payment.is_some() {
            return Err(ApiError::BadRequest(
                "A completed payment already exists for this booking".to_string(),
            ));
        }

        // The `payments` table stores a single `amount`; the summary breakdown
        // (subtotal/service_charge/tax/keycard) has no columns to persist to, so
        // only the total is stored. Column sets diverge per engine (mirroring
        // `insert_payment`/`insert_pending_payment_tx`): postgres carries the
        // card + gateway columns and uses `transaction_id`/`notes`/`created_by`;
        // sqlite has none of the card/gateway columns and uses
        // `reference_number`/`description`/`processed_by`.
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let (id, created_at): (i64, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
            r#"
            INSERT INTO payments (
                booking_id, amount, payment_method, payment_type, status,
                reference_number, description, processed_by
            )
            VALUES (?1, ?2, ?3, 'booking', 'completed', ?4, ?5, ?6)
            RETURNING id, created_at
            "#,
        )
        .bind(request.booking_id)
        .bind(decimal_to_db(summary.total_amount))
        .bind(request.payment_method.to_string())
        .bind(&request.transaction_reference)
        .bind(&request.notes)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let (id, created_at): (i64, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
            r#"
            INSERT INTO payments (
                uuid, booking_id, amount, payment_method, payment_type, status,
                transaction_id, card_last_four, card_brand, payment_gateway, notes, created_by
            )
            VALUES (gen_uuidv7(), $1, $2, $3, 'booking', 'completed', $4, $5, $6, $7, $8, $9)
            RETURNING id, created_at
            "#,
        )
        .bind(request.booking_id)
        .bind(decimal_to_db(summary.total_amount))
        .bind(request.payment_method.to_string())
        .bind(&request.transaction_reference)
        .bind(&request.card_last_four)
        .bind(&request.card_brand)
        .bind(payment_gateway)
        .bind(&request.notes)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        // Build the response directly from known inputs. The breakdown fields
        // (subtotal/service_charge/tax/keycard) and bank_name/account_reference
        // are surfaced from the request/summary even though the DB has nowhere to
        // persist them — they were never actually stored by this path.
        Ok(Payment {
            id,
            booking_id: request.booking_id,
            user_id: Some(user_id),
            payment_method: request.payment_method.to_string(),
            payment_status: PaymentStatus::Completed.to_string(),
            subtotal: summary.subtotal,
            service_charge: summary.service_charge,
            tax_amount: summary.tax_amount,
            keycard_deposit: summary.keycard_deposit,
            total_amount: summary.total_amount,
            transaction_reference: request.transaction_reference.clone(),
            payment_gateway: payment_gateway.map(|s| s.to_string()),
            card_last_four: request.card_last_four.clone(),
            card_brand: request.card_brand.clone(),
            bank_name: request.bank_name.clone(),
            account_reference: request.account_reference.clone(),
            notes: request.notes.clone(),
            created_at,
        })
    }

    pub async fn record_payment(
        tx: &mut sqlx::Transaction<'_, crate::core::db::DbDatabase>,
        user_id: i64,
        request: &RecordPaymentRequest,
        amount: Decimal,
        payment_type: &str,
        created_at_override: Option<&str>,
    ) -> Result<PaymentEntryRow, ApiError> {
        if let Some(ref txn_ref) = request.transaction_reference
            && !txn_ref.is_empty()
        {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let duplicate_sql = r#"
                SELECT id, booking_id, CAST(amount AS TEXT) AS total_amount, payment_method, payment_type,
                       status AS payment_status, reference_number AS transaction_reference, description AS notes,
                       substr(created_at, 1, 10) AS payment_date, created_at
                FROM payments
                WHERE reference_number = ?1
                LIMIT 1
                "#;
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let duplicate_sql = r#"
                SELECT id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                       status AS payment_status, transaction_id AS transaction_reference, notes,
                       created_at::date::text AS payment_date, created_at
                FROM payments
                WHERE transaction_id = $1
                LIMIT 1
                "#;

            let duplicate = sqlx::query_as::<_, PaymentEntryRow>(duplicate_sql)
                .bind(txn_ref)
                .fetch_optional(&mut **tx)
                .await
                .map_err(ApiError::from)?;

            if let Some(row) = duplicate {
                return Ok(row);
            }
        }

        let row = Self::insert_payment(
            &mut **tx,
            user_id,
            request,
            amount,
            payment_type,
            created_at_override,
        )
        .await?;

        Ok(row)
    }

    pub async fn insert_payment<'e, E>(
        executor: E,
        user_id: i64,
        request: &RecordPaymentRequest,
        amount: Decimal,
        payment_type: &str,
        created_at_override: Option<&str>,
    ) -> Result<PaymentEntryRow, ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let sql = if created_at_override.is_some() {
            r#"
            INSERT INTO payments (
                booking_id, amount, payment_method, payment_type, status,
                reference_number, description, processed_by, created_at
            )
            VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8)
            RETURNING id, booking_id, CAST(amount AS TEXT) AS total_amount, payment_method, payment_type,
                      status AS payment_status, reference_number AS transaction_reference, description AS notes,
                      substr(created_at, 1, 10) AS payment_date, created_at
            "#
        } else {
            r#"
            INSERT INTO payments (
                booking_id, amount, payment_method, payment_type, status,
                reference_number, description, processed_by
            )
            VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7)
            RETURNING id, booking_id, CAST(amount AS TEXT) AS total_amount, payment_method, payment_type,
                      status AS payment_status, reference_number AS transaction_reference, description AS notes,
                      substr(created_at, 1, 10) AS payment_date, created_at
            "#
        };
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let sql = if created_at_override.is_some() {
            r#"
            INSERT INTO payments (
                uuid, booking_id, amount, payment_method, payment_type,
                status, transaction_id, notes, created_by, created_at
            )
            VALUES (gen_uuidv7(), $1, $2, $3, $4, 'completed', $5, $6, $7, $8::timestamptz)
            RETURNING id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                      status AS payment_status, transaction_id AS transaction_reference, notes,
                      created_at::date::text AS payment_date, created_at
            "#
        } else {
            r#"
            INSERT INTO payments (
                uuid, booking_id, amount, payment_method, payment_type,
                status, transaction_id, notes, created_by, created_at
            )
            VALUES (gen_uuidv7(), $1, $2, $3, $4, 'completed', $5, $6, $7, CURRENT_TIMESTAMP)
            RETURNING id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                      status AS payment_status, transaction_id AS transaction_reference, notes,
                      created_at::date::text AS payment_date, created_at
            "#
        };

        let mut query = sqlx::query_as::<_, PaymentEntryRow>(sql)
            .bind(request.booking_id)
            .bind(decimal_to_db(amount))
            .bind(&request.payment_method)
            .bind(payment_type)
            .bind(&request.transaction_reference)
            .bind(&request.notes)
            .bind(user_id);

        if let Some(date) = created_at_override {
            query = query.bind(date);
        }

        query.fetch_one(executor).await.map_err(ApiError::from)
    }

    pub async fn list_payment_entries(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Vec<PaymentEntryRow>, ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let list_sql = r#"
            SELECT id, booking_id, CAST(amount AS TEXT) AS total_amount, payment_method, payment_type,
                   status AS payment_status, reference_number AS transaction_reference, description AS notes,
                   substr(created_at, 1, 10) AS payment_date, created_at
            FROM payments
            WHERE booking_id = ?1
            ORDER BY created_at ASC
            "#;
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let list_sql = r#"
            SELECT id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                   status AS payment_status, transaction_id AS transaction_reference, notes,
                   created_at::date::text AS payment_date, created_at
            FROM payments
            WHERE booking_id = $1
            ORDER BY created_at ASC
            "#;

        sqlx::query_as::<_, PaymentEntryRow>(list_sql)
            .bind(booking_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }

    /// Insert a `pending` payment row for a guest-initiated bank-transfer claim
    /// or a pre-capture PayPal record. Returns the new payment id.
    ///
    /// The two schemas diverge: PostgreSQL carries gateway columns
    /// (`payment_gateway`, `gateway_payment_intent_id`) and `created_by`; SQLite
    /// has neither, so it reuses `reference_number` for the gateway order id and
    /// `payment_number` (a generated uuid) for its unique key, and records the
    /// initiating `guest_id`. Both persist `payment_type='booking'` and
    /// `status='pending'`.
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_pending_payment_tx(
        tx: &mut DbTransaction<'_>,
        booking_id: i64,
        guest_id: i64,
        amount: Decimal,
        currency: &str,
        payment_method: &str,
        payment_gateway: Option<&str>,
        gateway_order_id: Option<&str>,
        description: Option<&str>,
        created_by: Option<i64>,
    ) -> Result<i64, ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            let _ = (currency, payment_gateway, created_by);
            sqlx::query_scalar::<_, i64>(
                r#"
                INSERT INTO payments (
                    payment_number, booking_id, guest_id, amount, payment_method,
                    payment_type, reference_number, description, status
                )
                VALUES (?1, ?2, ?3, ?4, ?5, 'booking', ?6, ?7, 'pending')
                RETURNING id
                "#,
            )
            .bind(crate::core::db::generate_uuid())
            .bind(booking_id)
            .bind(guest_id)
            .bind(decimal_to_db(amount))
            .bind(payment_method)
            .bind(gateway_order_id)
            .bind(description)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)
        }
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        {
            let _ = guest_id;
            sqlx::query_scalar::<_, i64>(
                r#"
                INSERT INTO payments (
                    uuid, booking_id, amount, currency, payment_method, payment_type,
                    payment_gateway, gateway_payment_intent_id, status, notes, created_by
                )
                VALUES (gen_uuidv7(), $1, $2, $3, $4, 'booking', $5, $6, 'pending', $7, $8)
                RETURNING id
                "#,
            )
            .bind(booking_id)
            .bind(decimal_to_db(amount))
            .bind(currency)
            .bind(payment_method)
            .bind(payment_gateway)
            .bind(gateway_order_id)
            .bind(description)
            .bind(created_by)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)
        }
    }

    /// Attach a PayPal order id to a previously inserted pending payment.
    /// PostgreSQL stores it in `gateway_payment_intent_id`; SQLite reuses
    /// `reference_number`.
    pub async fn set_payment_gateway_order(
        pool: &DbPool,
        payment_id: i64,
        order_id: &str,
    ) -> Result<(), ApiError> {
        let sql = crate::sql_query!(
            postgres: "UPDATE payments SET gateway_payment_intent_id = $2 WHERE id = $1",
            sqlite: "UPDATE payments SET reference_number = ?2 WHERE id = ?1"
        );
        sqlx::query(sql)
            .bind(payment_id)
            .bind(order_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    /// Compare-and-swap a payment to `completed`, stamping `processed_at` /
    /// `processed_by`. Guarded by `status IN ('pending','processing')` so a
    /// concurrent approval collapses to `Ok(None)` (no row) instead of
    /// double-completing. Returns the payment id when it actually transitioned.
    pub async fn mark_payment_completed_tx(
        tx: &mut DbTransaction<'_>,
        payment_id: i64,
        processed_by: Option<i64>,
    ) -> Result<Option<i64>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                UPDATE payments
                SET status = 'completed', processed_at = CURRENT_TIMESTAMP, processed_by = $2
                WHERE id = $1 AND status IN ('pending', 'processing')
                RETURNING id
            "#,
            sqlite: r#"
                UPDATE payments
                SET status = 'completed', processed_at = datetime('now'), processed_by = ?2
                WHERE id = ?1 AND status IN ('pending', 'processing')
                RETURNING id
            "#
        );
        sqlx::query_scalar::<_, i64>(sql)
            .bind(payment_id)
            .bind(processed_by)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)
    }

    /// Compare-and-swap a `pending` payment to `void`, recording the rejection
    /// reason. PostgreSQL stores it in `failure_reason` (+ `processed_by`);
    /// SQLite in `void_reason` (+ `voided_by`/`voided_at`). Returns the id when
    /// it transitioned.
    pub async fn mark_payment_rejected_tx(
        tx: &mut DbTransaction<'_>,
        payment_id: i64,
        rejected_by: Option<i64>,
        reason: &str,
    ) -> Result<Option<i64>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                UPDATE payments
                SET status = 'void', failure_reason = $2,
                    processed_at = CURRENT_TIMESTAMP, processed_by = $3
                WHERE id = $1 AND status = 'pending'
                RETURNING id
            "#,
            sqlite: r#"
                UPDATE payments
                SET status = 'void', void_reason = ?2,
                    voided_at = datetime('now'), voided_by = ?3
                WHERE id = ?1 AND status = 'pending'
                RETURNING id
            "#
        );
        sqlx::query_scalar::<_, i64>(sql)
            .bind(payment_id)
            .bind(reason)
            .bind(rejected_by)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)
    }

    /// Compare-and-swap a payment to `failed`, recording the failure reason.
    /// Used when a gateway capture reports figures that do not match the stored
    /// pending payment (amount/currency mismatch). PostgreSQL stores the reason
    /// in `failure_reason`; SQLite reuses `void_reason`. Guarded by
    /// `status IN ('pending','processing')`. Returns the id when it transitioned.
    pub async fn mark_payment_failed_tx(
        tx: &mut DbTransaction<'_>,
        payment_id: i64,
        reason: &str,
    ) -> Result<Option<i64>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                UPDATE payments
                SET status = 'failed', failure_reason = $2,
                    processed_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND status IN ('pending', 'processing')
                RETURNING id
            "#,
            sqlite: r#"
                UPDATE payments
                SET status = 'failed', void_reason = ?2,
                    voided_at = datetime('now')
                WHERE id = ?1 AND status IN ('pending', 'processing')
                RETURNING id
            "#
        );
        sqlx::query_scalar::<_, i64>(sql)
            .bind(payment_id)
            .bind(reason)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)
    }

    /// True when the booking already has a `booking`-type payment that is
    /// `pending`, `processing`, or `completed`. Used to reject duplicate guest
    /// payment attempts (a second bank-transfer claim / PayPal order) before a
    /// new pending row is inserted, so staff cannot approve two full-amount
    /// payments for one booking.
    pub async fn has_active_or_completed_booking_payment(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<bool, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT EXISTS(
                    SELECT 1 FROM payments
                    WHERE booking_id = $1
                      AND payment_type = 'booking'
                      AND status IN ('pending', 'processing', 'completed')
                )
            "#,
            sqlite: r#"
                SELECT EXISTS(
                    SELECT 1 FROM payments
                    WHERE booking_id = ?1
                      AND payment_type = 'booking'
                      AND status IN ('pending', 'processing', 'completed')
                )
            "#
        );
        sqlx::query_scalar::<_, bool>(sql)
            .bind(booking_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    /// Defense-in-depth for the completion path: true when the booking already
    /// has a `completed` `booking`-type payment OTHER than `exclude_payment_id`.
    /// Checked inside the completion transaction so a race that slipped past the
    /// pre-insert guard cannot double-complete a booking.
    pub async fn has_other_completed_booking_payment_tx(
        tx: &mut DbTransaction<'_>,
        booking_id: i64,
        exclude_payment_id: i64,
    ) -> Result<bool, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT EXISTS(
                    SELECT 1 FROM payments
                    WHERE booking_id = $1
                      AND payment_type = 'booking'
                      AND status = 'completed'
                      AND id <> $2
                )
            "#,
            sqlite: r#"
                SELECT EXISTS(
                    SELECT 1 FROM payments
                    WHERE booking_id = ?1
                      AND payment_type = 'booking'
                      AND status = 'completed'
                      AND id <> ?2
                )
            "#
        );
        sqlx::query_scalar::<_, bool>(sql)
            .bind(booking_id)
            .bind(exclude_payment_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)
    }

    /// Fetch a single payment enriched with booking + guest context, for the
    /// staff review action. Returns `None` if the id does not exist.
    pub async fn get_payment_for_review(
        pool: &DbPool,
        payment_id: i64,
    ) -> Result<Option<PendingPaymentEntry>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id AS guest_id,
                       g.full_name AS guest_name, p.amount::text AS amount,
                       p.payment_method, p.status,
                       p.gateway_payment_intent_id AS reference, p.notes AS notes,
                       p.created_at::text AS created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       p.processed_at::text AS processed_at, reviewer.full_name AS processed_by_name,
                       p.failure_reason AS decision_reason
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id
                LEFT JOIN users reviewer ON reviewer.id = p.processed_by
                WHERE p.id = $1
            "#,
            sqlite: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id AS guest_id,
                       g.full_name AS guest_name, CAST(p.amount AS TEXT) AS amount,
                       p.payment_method, p.status,
                       p.reference_number AS reference, p.description AS notes,
                       p.created_at AS created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       COALESCE(p.processed_at, p.voided_at) AS processed_at, reviewer.full_name AS processed_by_name,
                       p.void_reason AS decision_reason
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id
                LEFT JOIN users reviewer ON reviewer.id = COALESCE(p.processed_by, p.voided_by)
                WHERE p.id = ?1
            "#
        );
        sqlx::query_as::<_, PendingPaymentEntry>(sql)
            .bind(payment_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)
    }

    /// Paginated list of pending payments for the staff approval queue, plus the
    /// total count for pagination controls (most-recent first).
    pub async fn list_pending_payments(
        pool: &DbPool,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PendingPaymentEntry>, i64), ApiError> {
        let list_sql = crate::sql_query!(
            postgres: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id AS guest_id,
                       g.full_name AS guest_name, p.amount::text AS amount,
                       p.payment_method, p.status,
                       p.gateway_payment_intent_id AS reference, p.notes AS notes,
                       p.created_at::text AS created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       p.processed_at::text AS processed_at, reviewer.full_name AS processed_by_name,
                       p.failure_reason AS decision_reason
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id
                LEFT JOIN users reviewer ON reviewer.id = p.processed_by
                WHERE p.status = 'pending'
                ORDER BY p.created_at DESC
                LIMIT $1 OFFSET $2
            "#,
            sqlite: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id AS guest_id,
                       g.full_name AS guest_name, CAST(p.amount AS TEXT) AS amount,
                       p.payment_method, p.status,
                       p.reference_number AS reference, p.description AS notes,
                       p.created_at AS created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       COALESCE(p.processed_at, p.voided_at) AS processed_at, reviewer.full_name AS processed_by_name,
                       p.void_reason AS decision_reason
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id
                LEFT JOIN users reviewer ON reviewer.id = COALESCE(p.processed_by, p.voided_by)
                WHERE p.status = 'pending'
                ORDER BY p.created_at DESC
                LIMIT ?1 OFFSET ?2
            "#
        );

        let items = sqlx::query_as::<_, PendingPaymentEntry>(list_sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        let total =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM payments WHERE status = 'pending'")
                .fetch_one(pool)
                .await
                .map_err(ApiError::from)?;

        Ok((items, total))
    }

    /// Completed and rejected guest payment claims, newest decision first.
    pub async fn list_payment_approval_history(
        pool: &DbPool,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PendingPaymentEntry>, i64), ApiError> {
        let list_sql = crate::sql_query!(
            postgres: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id, g.full_name AS guest_name,
                       p.amount::text AS amount, p.payment_method, p.status,
                       p.gateway_payment_intent_id AS reference, p.notes, p.created_at::text AS created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       p.processed_at::text AS processed_at, reviewer.full_name AS processed_by_name, p.failure_reason AS decision_reason
                FROM payments p JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN users reviewer ON reviewer.id = p.processed_by
                WHERE p.payment_method IN ('bank_transfer', 'paypal') AND p.status IN ('completed', 'void')
                ORDER BY p.processed_at DESC NULLS LAST, p.created_at DESC LIMIT $1 OFFSET $2
            "#,
            sqlite: r#"
                SELECT p.id, p.booking_id, b.booking_number, b.guest_id, g.full_name AS guest_name,
                       CAST(p.amount AS TEXT) AS amount, p.payment_method, p.status,
                       p.reference_number AS reference, p.description AS notes, p.created_at,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id) AS receipt_requested,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.uploaded_at IS NOT NULL) AS receipt_uploaded,
                       EXISTS(SELECT 1 FROM payment_receipt_requests pr WHERE pr.payment_id = p.id AND pr.receipt_path IS NOT NULL) AS receipt_file_available,
                       COALESCE(p.processed_at, p.voided_at) AS processed_at, reviewer.full_name AS processed_by_name, p.void_reason AS decision_reason
                FROM payments p JOIN bookings b ON b.id = p.booking_id
                LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN users reviewer ON reviewer.id = COALESCE(p.processed_by, p.voided_by)
                WHERE p.payment_method IN ('bank_transfer', 'paypal') AND p.status IN ('completed', 'void')
                ORDER BY COALESCE(p.processed_at, p.voided_at) DESC, p.created_at DESC LIMIT ?1 OFFSET ?2
            "#
        );
        let items = sqlx::query_as::<_, PendingPaymentEntry>(list_sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        let total_sql = "SELECT COUNT(*) FROM payments WHERE payment_method IN ('bank_transfer', 'paypal') AND status IN ('completed', 'void')";
        let total = sqlx::query_scalar::<_, i64>(total_sql)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((items, total))
    }

    pub async fn save_receipt_file(
        pool: &DbPool,
        payment_id: i64,
        path: &str,
        content_type: &str,
    ) -> Result<(), ApiError> {
        let sql = crate::sql_query!(
            postgres: "INSERT INTO payment_receipt_requests (payment_id, uploaded_at, receipt_path, receipt_content_type) VALUES ($1, CURRENT_TIMESTAMP, $2, $3) ON CONFLICT (payment_id) DO UPDATE SET uploaded_at = CURRENT_TIMESTAMP, receipt_path = EXCLUDED.receipt_path, receipt_content_type = EXCLUDED.receipt_content_type",
            sqlite: "INSERT INTO payment_receipt_requests (payment_id, uploaded_at, receipt_path, receipt_content_type) VALUES (?1, datetime('now'), ?2, ?3) ON CONFLICT (payment_id) DO UPDATE SET uploaded_at = datetime('now'), receipt_path = excluded.receipt_path, receipt_content_type = excluded.receipt_content_type"
        );
        sqlx::query(sql)
            .bind(payment_id)
            .bind(path)
            .bind(content_type)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn receipt_file(
        pool: &DbPool,
        payment_id: i64,
    ) -> Result<Option<PaymentReceiptFile>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT receipt_path, receipt_content_type FROM payment_receipt_requests WHERE payment_id = $1 AND receipt_path IS NOT NULL",
            sqlite: "SELECT receipt_path, receipt_content_type FROM payment_receipt_requests WHERE payment_id = ?1 AND receipt_path IS NOT NULL"
        );
        let row = sqlx::query_as::<_, (String, String)>(sql)
            .bind(payment_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.map(|(path, content_type)| PaymentReceiptFile { path, content_type }))
    }

    /// Create or refresh a receipt request for a pending bank-transfer claim.
    pub async fn request_receipt(
        pool: &DbPool,
        payment_id: i64,
        requested_by: i64,
        message: Option<&str>,
    ) -> Result<(), ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                INSERT INTO payment_receipt_requests (payment_id, requested_by, request_message)
                VALUES ($1, $2, $3)
                ON CONFLICT (payment_id) DO UPDATE SET
                    requested_by = EXCLUDED.requested_by,
                    request_message = EXCLUDED.request_message,
                    requested_at = CURRENT_TIMESTAMP
            "#,
            sqlite: r#"
                INSERT INTO payment_receipt_requests (payment_id, requested_by, request_message)
                VALUES (?1, ?2, ?3)
                ON CONFLICT (payment_id) DO UPDATE SET
                    requested_by = excluded.requested_by,
                    request_message = excluded.request_message,
                    requested_at = datetime('now')
            "#
        );
        sqlx::query(sql)
            .bind(payment_id)
            .bind(requested_by)
            .bind(message)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    /// Pending bank-transfer claims whose requested receipt was not uploaded
    /// within the allowed 24-hour review window.
    pub async fn expired_receipt_request_payment_ids(pool: &DbPool) -> Result<Vec<i64>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT p.id FROM payments p JOIN payment_receipt_requests pr ON pr.payment_id = p.id WHERE p.status = 'pending' AND p.payment_method = 'bank_transfer' AND pr.uploaded_at IS NULL AND pr.requested_at <= CURRENT_TIMESTAMP - INTERVAL '1 day'",
            sqlite: "SELECT p.id FROM payments p JOIN payment_receipt_requests pr ON pr.payment_id = p.id WHERE p.status = 'pending' AND p.payment_method = 'bank_transfer' AND pr.uploaded_at IS NULL AND datetime(pr.requested_at) <= datetime('now', '-1 day')"
        );
        sqlx::query_scalar(sql)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn workflow_summary_row<'e, E>(
        executor: E,
        booking_id: i64,
    ) -> Result<Option<PaymentWorkflowSummaryRow>, ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let summary_sql = r#"
            SELECT
                b.id AS booking_id,
                b.status AS booking_status,
                COALESCE(b.payment_status, 'unpaid') AS payment_status,
                b.total_amount,
                COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount,
                COALESCE(b.extra_bed_charge, 0) AS extra_bed_charge,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id AND p.status = 'completed'
                      AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id
                      AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id AND p.status = 'completed'
                      AND COALESCE(p.payment_type, 'booking') = 'deposit'), 0) AS deposit_collected,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id
                      AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS deposit_refunded,
                EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'failed') AS has_failed_payment
            FROM bookings b
            WHERE b.id = ?1
        "#;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let summary_sql = r#"
            SELECT
                b.id AS booking_id,
                b.status AS booking_status,
                COALESCE(b.payment_status, 'unpaid') AS payment_status,
                b.total_amount,
                COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount,
                COALESCE(b.extra_bed_charge, 0) AS extra_bed_charge,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id AND p.status = 'completed'
                      AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id
                      AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id AND p.status = 'completed'
                      AND COALESCE(p.payment_type, 'booking') = 'deposit'), 0) AS deposit_collected,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id
                      AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS deposit_refunded,
                EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'failed') AS has_failed_payment
            FROM bookings b
            WHERE b.id = $1
        "#;

        let row = sqlx::query(summary_sql)
            .bind(booking_id)
            .fetch_optional(executor)
            .await
            .map_err(ApiError::from)?;

        Ok(row.map(|row| map_workflow_summary_row(&row)))
    }

    pub async fn refund_deposit(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        payment_method: &str,
        deposit_amount: Decimal,
    ) -> Result<PaymentEntryRow, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        let existing_refund: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM payments WHERE booking_id = $1 AND payment_type = 'refund' AND notes = 'Keycard deposit refund' LIMIT 1"
        )
        .bind(booking_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        if existing_refund.is_some() {
            return Err(ApiError::BadRequest("Deposit already refunded".to_string()));
        }

        let row = sqlx::query_as::<_, PaymentEntryRow>(
            r#"
            INSERT INTO payments (
                uuid, booking_id, amount, payment_method, payment_type,
                status, notes, created_by
            )
            VALUES (gen_uuidv7(), $1, $2, $3, 'refund', 'refunded', 'Keycard deposit refund', $4)
            RETURNING id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                      status AS payment_status, NULL::text AS transaction_reference, notes,
                      created_at::date::text AS payment_date, created_at
            "#,
        )
        .bind(booking_id)
        .bind(decimal_to_db(deposit_amount))
        .bind(payment_method)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(row)
    }

    /// Revert a previously-recorded keycard deposit refund for a booking.
    ///
    /// Deletes the refund payment row created by [`refund_deposit`] so the
    /// deposit shows as not-yet-refunded again, drops out of the night-audit
    /// journal, and can be re-refunded if it was issued by mistake. Returns the
    /// id of the deleted refund payment. Errors if no such refund exists.
    pub async fn revert_deposit_refund(pool: &DbPool, booking_id: i64) -> Result<i64, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        // The note/description column differs between databases, but the
        // marker text is identical to what `refund_deposit` writes.
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let select_sql = "SELECT id FROM payments WHERE booking_id = ?1 AND payment_type = 'refund' AND description = 'Keycard deposit refund' ORDER BY id DESC LIMIT 1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let select_sql = "SELECT id FROM payments WHERE booking_id = $1 AND payment_type = 'refund' AND notes = 'Keycard deposit refund' ORDER BY id DESC LIMIT 1";

        let refund_id: Option<i64> = sqlx::query_scalar(select_sql)
            .bind(booking_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        let refund_id = match refund_id {
            Some(id) => id,
            None => {
                return Err(ApiError::BadRequest(
                    "No deposit refund to revert".to_string(),
                ));
            }
        };

        sqlx::query("DELETE FROM payments WHERE id = $1")
            .bind(refund_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(refund_id)
    }

    /// Find payment by booking ID
    pub async fn find_by_booking_id(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Option<Payment>, ApiError> {
        let row = sqlx::query(
            "SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(row.as_ref().map(row_mappers::row_to_payment))
    }

    pub async fn create_generated_invoice(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        invoice_number: &str,
    ) -> Result<Invoice, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        // Idempotency: return the existing invoice (enriched with stay/room
        // detail) if one already exists for this booking.
        if let Some(existing) = Self::enriched_invoice_by_booking_id(&mut *tx, booking_id).await? {
            return Ok(existing);
        }

        let booking_details: GeneratedInvoiceBookingDetailsRow = sqlx::query_as(
            r#"
            SELECT b.id AS booking_id, b.guest_id, g.full_name AS customer_name,
                   g.email AS customer_email, g.phone AS customer_phone,
                   b.check_in_date AS check_in, b.check_out_date AS check_out,
                   r.id AS room_id, r.room_number, rt.name AS room_type
            FROM bookings b
            JOIN guests g ON b.guest_id = g.id
            JOIN rooms r ON b.room_id = r.id
            JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.id = $1
            "#,
        )
        .bind(booking_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let GeneratedInvoiceBookingDetailsRow {
            booking_id: _booking_id,
            guest_id,
            customer_name,
            customer_email,
            customer_phone: _customer_phone,
            check_in,
            check_out,
            room_id,
            room_number,
            room_type,
        } = booking_details;

        // Whether a completed payment already exists — decides the invoice's
        // `status`/`paid_amount`. Uses the real `status` column, cfg-gated.
        let paid_sql = crate::sql_query!(
            postgres: "SELECT EXISTS(SELECT 1 FROM payments WHERE booking_id = $1 AND status = 'completed')",
            sqlite: "SELECT EXISTS(SELECT 1 FROM payments WHERE booking_id = ?1 AND status = 'completed')"
        );
        let has_completed_payment: bool = sqlx::query_scalar(paid_sql)
            .bind(booking_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        let pricing_row = sqlx::query(
            r#"
                SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
                FROM rooms r
                JOIN room_types rt ON r.room_type_id = rt.id
                WHERE r.id = $1
                "#,
        )
        .bind(room_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;
        let base_price = row_mappers::get_decimal(&pricing_row, "base_price");
        let keycard_deposit = row_mappers::get_decimal(&pricing_row, "keycard_deposit_amount");
        let service_charge_pct =
            row_mappers::get_decimal(&pricing_row, "service_charge_percentage");

        let nights = (check_out.date() - check_in.date()).num_days() as i32;
        let subtotal = base_price * Decimal::from(nights);
        let service_charge = (subtotal * service_charge_pct) / Decimal::from(100);
        let tax_amount = Decimal::ZERO;
        let total = subtotal + service_charge + tax_amount + keycard_deposit;
        let paid_amount = if has_completed_payment {
            total
        } else {
            Decimal::ZERO
        };
        let status = if has_completed_payment {
            "paid"
        } else {
            "draft"
        };

        let line_items = serde_json::json!([
            {
                "description": format!("Room {} ({}) - {} night(s)", room_number, room_type, nights),
                "quantity": nights,
                "unit_price": base_price,
                "total": subtotal
            },
            {
                "description": format!("Service Charge ({}%)", service_charge_pct),
                "quantity": 1,
                "unit_price": service_charge,
                "total": service_charge
            },
            {
                "description": "Keycard Deposit (Refundable)",
                "quantity": 1,
                "unit_price": keycard_deposit,
                "total": keycard_deposit
            }
        ]);

        // Insert against the REAL invoices columns, cfg-gated like
        // `insert_checkout_invoice`. postgres carries billing_name/email +
        // line_items + room/service charge columns; sqlite's table has none of
        // those. check_in/check_out/room/nights are NOT stored (no columns) — they
        // are attached to the returned struct from `booking_details` instead.
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let (id, created_at): (i64, chrono::DateTime<chrono::Utc>) = {
            let _ = &line_items; // sqlite invoices has no line_items column
            sqlx::query_as(
                r#"
                INSERT INTO invoices (
                    invoice_number, booking_id, guest_id, invoice_type,
                    subtotal, tax_amount, discount_amount, total_amount, paid_amount,
                    status, notes, created_by
                )
                VALUES (?1, ?2, ?3, 'booking', ?4, ?5, 0, ?6, ?7, ?8, NULL, ?9)
                RETURNING id, created_at
                "#,
            )
            .bind(invoice_number)
            .bind(booking_id)
            .bind(guest_id)
            .bind(decimal_to_db(subtotal))
            .bind(decimal_to_db(tax_amount))
            .bind(decimal_to_db(total))
            .bind(decimal_to_db(paid_amount))
            .bind(status)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(ApiError::from)?
        };
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let uuid_val = uuid::Uuid::nil();

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let (id, uuid_val, created_at): (i64, uuid::Uuid, chrono::DateTime<chrono::Utc>) =
            sqlx::query_as(
                r#"
                INSERT INTO invoices (
                    invoice_number, booking_id, bill_to_guest_id, billing_name, billing_email,
                    subtotal, tax_amount, discount_amount, total_amount, paid_amount,
                    currency, line_items, status, invoice_type, room_charges, service_charges,
                    created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, 'booking', $13, $14, $15)
                RETURNING id, uuid, created_at
                "#,
            )
            .bind(invoice_number)
            .bind(booking_id)
            .bind(guest_id)
            .bind(&customer_name)
            .bind(&customer_email)
            .bind(decimal_to_db(subtotal))
            .bind(decimal_to_db(tax_amount))
            .bind(decimal_to_db(total))
            .bind(decimal_to_db(paid_amount))
            .bind("MYR")
            .bind(&line_items)
            .bind(status)
            .bind(decimal_to_db(subtotal))
            .bind(decimal_to_db(service_charge))
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        // `balance_due` is a generated column in postgres (can't be inserted);
        // compute it here so the returned struct is consistent on both engines.
        Ok(Invoice {
            id,
            uuid: uuid_val,
            invoice_number: invoice_number.to_string(),
            booking_id,
            user_id: Some(user_id),
            billing_name: customer_name,
            billing_address: None,
            billing_email: customer_email,
            invoice_date: None,
            issue_date: chrono::Utc::now().date_naive(),
            due_date: None,
            check_in_date: Some(check_in.date()),
            check_out_date: Some(check_out.date()),
            number_of_nights: Some(nights),
            room_number: Some(room_number),
            room_type: Some(room_type),
            subtotal,
            tax_amount,
            discount_amount: Decimal::ZERO,
            total_amount: total,
            paid_amount,
            balance_due: total - paid_amount,
            currency: "MYR".to_string(),
            status: status.to_string(),
            notes: None,
            created_at,
            updated_at: created_at,
        })
    }

    /// Read an invoice by booking id, enriched with stay/room detail joined from
    /// `bookings`/`rooms`/`room_types` (the `invoices` table itself stores no
    /// check_in/check_out/room_number/room_type). LEFT JOINs so the invoice still
    /// returns when a joined row is absent. Returns the most recent invoice.
    async fn enriched_invoice_by_booking_id<'e, E>(
        executor: E,
        booking_id: i64,
    ) -> Result<Option<Invoice>, ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT i.*, i.created_by AS user_id,
                       b.check_in_date::date AS check_in_date,
                       b.check_out_date::date AS check_out_date,
                       (b.check_out_date::date - b.check_in_date::date) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.booking_id = $1
                ORDER BY i.id DESC
                LIMIT 1
            "#,
            sqlite: r#"
                SELECT i.*, i.created_by AS user_id,
                       date(b.check_in_date) AS check_in_date,
                       date(b.check_out_date) AS check_out_date,
                       CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.booking_id = ?1
                ORDER BY i.id DESC
                LIMIT 1
            "#
        );
        let row = sqlx::query(sql)
            .bind(booking_id)
            .fetch_optional(executor)
            .await
            .map_err(ApiError::from)?;

        Ok(row.as_ref().map(row_mappers::row_to_invoice))
    }

    pub async fn find_invoice_by_booking_id(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Option<Invoice>, ApiError> {
        Self::enriched_invoice_by_booking_id(pool, booking_id).await
    }

    pub async fn find_user_invoices(pool: &DbPool, user_id: i64) -> Result<Vec<Invoice>, ApiError> {
        // Ownership is tracked via `created_by` (no `user_id` column). Stay/room
        // detail is joined at read time (LEFT JOIN — absent joins degrade to NULL).
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT i.*, i.created_by AS user_id,
                       b.check_in_date::date AS check_in_date,
                       b.check_out_date::date AS check_out_date,
                       (b.check_out_date::date - b.check_in_date::date) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.created_by = $1
                ORDER BY i.id DESC
            "#,
            sqlite: r#"
                SELECT i.*, i.created_by AS user_id,
                       date(b.check_in_date) AS check_in_date,
                       date(b.check_out_date) AS check_out_date,
                       CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.created_by = ?1
                ORDER BY i.id DESC
            "#
        );
        let rows = sqlx::query(sql)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(rows.iter().map(row_mappers::row_to_invoice).collect())
    }

    pub async fn update_payment(
        pool: &DbPool,
        payment_id: i64,
        request: &UpdatePaymentRequest,
    ) -> Result<PaymentEntryRow, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let existing_sql = "SELECT id FROM payments WHERE id = ?1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let existing_sql = "SELECT id FROM payments WHERE id = $1";

        let existing: Option<i64> = sqlx::query_scalar(existing_sql)
            .bind(payment_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        if existing.is_none() {
            return Err(ApiError::NotFound("Payment not found".to_string()));
        }

        let mut updates = Vec::new();
        let mut param_index = 1;

        if request.amount.is_some() {
            param_index += 1;
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            updates.push(format!("amount = ?{}", param_index));
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            updates.push(format!("amount = ${}", param_index));
        }
        if request.payment_method.is_some() {
            param_index += 1;
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            updates.push(format!("payment_method = ?{}", param_index));
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            updates.push(format!("payment_method = ${}", param_index));
        }
        if request.transaction_reference.is_some() {
            param_index += 1;
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            updates.push(format!("reference_number = ?{}", param_index));
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            updates.push(format!("transaction_id = ${}", param_index));
        }
        if request.notes.is_some() {
            param_index += 1;
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            updates.push(format!("description = ?{}", param_index));
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            updates.push(format!("notes = ${}", param_index));
        }
        if request.payment_date.is_some() {
            param_index += 1;
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            updates.push(format!("created_at = ?{}", param_index));
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            updates.push(format!("created_at = ${}::timestamptz", param_index));
        }

        if updates.is_empty() {
            return Err(ApiError::BadRequest("No fields to update".to_string()));
        }

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let query = format!(
            "UPDATE payments SET {} WHERE id = ?1 RETURNING id, booking_id, CAST(amount AS TEXT) AS total_amount, payment_method, payment_type, status AS payment_status, reference_number AS transaction_reference, description AS notes, substr(created_at, 1, 10) AS payment_date, created_at",
            updates.join(", ")
        );
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let query = format!(
            "UPDATE payments SET {} WHERE id = $1 RETURNING id, booking_id, amount::text AS total_amount, payment_method, payment_type, status AS payment_status, transaction_id AS transaction_reference, notes, created_at::date::text AS payment_date, created_at",
            updates.join(", ")
        );

        let mut query_builder = sqlx::query_as::<_, PaymentEntryRow>(&query).bind(payment_id);

        if let Some(amount) = request.amount {
            let amount_decimal = Decimal::from_f64_retain(amount)
                .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
            query_builder = query_builder.bind(decimal_to_db(amount_decimal));
        }
        if let Some(ref method) = request.payment_method {
            query_builder = query_builder.bind(method);
        }
        if let Some(ref reference) = request.transaction_reference {
            query_builder = query_builder.bind(reference);
        }
        if let Some(ref notes) = request.notes {
            query_builder = query_builder.bind(notes);
        }
        if let Some(ref payment_date) = request.payment_date {
            let ts = format!("{} 12:00:00", payment_date);
            query_builder = query_builder.bind(ts);
        }

        let row = query_builder
            .fetch_one(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(row)
    }

    pub async fn delete_payment(pool: &DbPool, payment_id: i64) -> Result<Option<i64>, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        let payment_row =
            sqlx::query("SELECT id, payment_type, booking_id FROM payments WHERE id = $1")
                .bind(payment_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(ApiError::from)?;

        let payment_row = match payment_row {
            Some(row) => row,
            None => return Err(ApiError::NotFound("Payment not found".to_string())),
        };

        let payment_type: Option<String> = payment_row.get("payment_type");
        if payment_type.as_deref() == Some("refund") {
            return Err(ApiError::BadRequest(
                "Cannot delete refund records".to_string(),
            ));
        }

        let affected_booking_id: Option<i64> = Some(payment_row.get("booking_id"));

        sqlx::query("DELETE FROM payments WHERE id = $1")
            .bind(payment_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(affected_booking_id)
    }

    pub async fn existing_invoice_number<'e, E>(
        executor: E,
        booking_id: i64,
    ) -> Result<Option<String>, ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let sql = "SELECT invoice_number FROM invoices WHERE booking_id = ?1 LIMIT 1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let sql = "SELECT invoice_number FROM invoices WHERE booking_id = $1 LIMIT 1";

        sqlx::query_scalar(sql)
            .bind(booking_id)
            .fetch_optional(executor)
            .await
            .map_err(ApiError::from)
    }

    pub async fn ledger_invoice_number<'e, E>(
        executor: E,
        booking_id: i64,
    ) -> Result<Option<String>, ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let sql = "SELECT invoice_number FROM customer_ledgers \
             WHERE booking_id = ?1 AND invoice_number IS NOT NULL \
             ORDER BY id LIMIT 1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let sql = "SELECT invoice_number FROM customer_ledgers \
             WHERE booking_id = $1 AND invoice_number IS NOT NULL \
             ORDER BY id LIMIT 1";

        sqlx::query_scalar(sql)
            .bind(booking_id)
            .fetch_optional(executor)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_checkout_invoice<'e, E>(
        executor: E,
        booking_id: i64,
        user_id: i64,
        invoice_number: &str,
    ) -> Result<(), ApiError>
    where
        E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
    {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            sqlx::query(
                r#"
                INSERT INTO invoices (
                    invoice_number, booking_id, invoice_type,
                    subtotal, total_amount, status, created_by
                )
                SELECT ?1, b.id, 'checkout', b.total_amount, b.total_amount, 'issued', ?2
                FROM bookings b
                WHERE b.id = ?3
                "#,
            )
            .bind(invoice_number)
            .bind(user_id)
            .bind(booking_id)
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        }

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        {
            sqlx::query(
                r#"
                INSERT INTO invoices (
                    invoice_number, booking_id, billing_name, billing_email,
                    subtotal, total_amount, line_items, status, invoice_type, created_by
                )
                SELECT $1, b.id,
                       COALESCE(g.full_name, ''),
                       g.email,
                       b.total_amount,
                       b.total_amount,
                       '[]'::jsonb,
                       'issued',
                       'booking',
                       $2
                FROM bookings b
                INNER JOIN guests g ON b.guest_id = g.id
                WHERE b.id = $3
                "#,
            )
            .bind(invoice_number)
            .bind(user_id)
            .bind(booking_id)
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        }

        Ok(())
    }

    /// Find invoice by invoice number, enriched with stay/room detail joined at
    /// read time (LEFT JOIN — absent joins degrade to NULL).
    pub async fn find_invoice_by_number(
        pool: &DbPool,
        invoice_number: &str,
    ) -> Result<Option<Invoice>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                SELECT i.*, i.created_by AS user_id,
                       b.check_in_date::date AS check_in_date,
                       b.check_out_date::date AS check_out_date,
                       (b.check_out_date::date - b.check_in_date::date) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.invoice_number = $1
                LIMIT 1
            "#,
            sqlite: r#"
                SELECT i.*, i.created_by AS user_id,
                       date(b.check_in_date) AS check_in_date,
                       date(b.check_out_date) AS check_out_date,
                       CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER) AS number_of_nights,
                       r.room_number, rt.name AS room_type
                FROM invoices i
                LEFT JOIN bookings b ON b.id = i.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN room_types rt ON rt.id = r.room_type_id
                WHERE i.invoice_number = ?1
                LIMIT 1
            "#
        );
        let row = sqlx::query(sql)
            .bind(invoice_number)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(row.as_ref().map(row_mappers::row_to_invoice))
    }

    #[allow(dead_code)]
    pub async fn invoice_booking_details(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<InvoiceBookingDetails, ApiError> {
        let (
            _booking_id,
            _guest_id,
            customer_name,
            customer_email,
            customer_phone,
            check_in,
            check_out,
            room_id,
            room_number,
            room_type,
        ): (
            i64,
            i64,
            String,
            String,
            Option<String>,
            chrono::NaiveDateTime,
            chrono::NaiveDateTime,
            i64,
            String,
            String,
        ) = sqlx::query_as(
            r#"
            SELECT b.id, b.guest_id, u.full_name, u.email, u.phone,
                   b.check_in_date, b.check_out_date,
                   r.id as room_id, r.room_number, rt.name as room_type
            FROM bookings b
            JOIN users u ON b.guest_id = u.id
            JOIN rooms r ON b.room_id = r.id
            JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.id = $1
            "#,
        )
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(InvoiceBookingDetails {
            customer_name,
            customer_email,
            customer_phone,
            check_in,
            check_out,
            room_id,
            room_number,
            room_type,
        })
    }
}

fn map_workflow_summary_row(row: &DbRow) -> PaymentWorkflowSummaryRow {
    PaymentWorkflowSummaryRow {
        booking_status: row.get("booking_status"),
        payment_status: row.get("payment_status"),
        total_amount: row_mappers::get_decimal(row, "total_amount"),
        tourism_tax_amount: row_mappers::get_decimal(row, "tourism_tax_amount"),
        extra_bed_charge: row_mappers::get_decimal(row, "extra_bed_charge"),
        total_paid: row_mappers::get_decimal(row, "total_paid"),
        total_refunded: row_mappers::get_decimal(row, "total_refunded"),
        deposit_collected: row_mappers::get_decimal(row, "deposit_collected"),
        deposit_refunded: row_mappers::get_decimal(row, "deposit_refunded"),
        has_failed_payment: row_mappers::get_bool(row, "has_failed_payment"),
    }
}
