//! Payment repository for database operations

use crate::constants::PaymentStatus;
use crate::core::db::{DbPool, DbRow, DbTransaction, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    Invoice, InvoiceBookingDetails, Payment, PaymentBookingStay, PaymentEntryRow, PaymentRequest,
    PaymentRoomPricing, PaymentSummary, PaymentWorkflowSummaryRow, RecordPaymentRequest,
    UpdatePaymentRequest,
};
use rust_decimal::Decimal;
use sqlx::Row;

pub struct PaymentRepository;

impl PaymentRepository {
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

        let existing_payment: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM payments WHERE booking_id = $1 AND payment_status = $2 LIMIT 1",
        )
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

        let payment = sqlx::query(
            r#"
            INSERT INTO payments (
                booking_id, user_id, payment_method, payment_status,
                subtotal, service_charge, tax_amount, keycard_deposit, total_amount,
                transaction_reference, payment_gateway,
                card_last_four, card_brand, bank_name, account_reference, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *
            "#,
        )
        .bind(request.booking_id)
        .bind(user_id)
        .bind(request.payment_method.to_string())
        .bind(PaymentStatus::Completed.to_string())
        .bind(decimal_to_db(summary.subtotal))
        .bind(decimal_to_db(summary.service_charge))
        .bind(decimal_to_db(summary.tax_amount))
        .bind(decimal_to_db(summary.keycard_deposit))
        .bind(decimal_to_db(summary.total_amount))
        .bind(&request.transaction_reference)
        .bind(payment_gateway)
        .bind(&request.card_last_four)
        .bind(&request.card_brand)
        .bind(&request.bank_name)
        .bind(&request.account_reference)
        .bind(&request.notes)
        .fetch_one(&mut *tx)
        .await
        .map(|row| row_mappers::row_to_payment(&row))
        .map_err(ApiError::from)?;

        if summary.keycard_deposit > Decimal::ZERO {
            sqlx::query(
                r#"
                INSERT INTO keycard_deposits (booking_id, payment_id, deposit_amount, deposit_status)
                VALUES ($1, $2, $3, 'held')
                "#,
            )
            .bind(request.booking_id)
            .bind(payment.id)
            .bind(decimal_to_db(summary.keycard_deposit))
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        }

        tx.commit().await.map_err(ApiError::from)?;

        Ok(payment)
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
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 'completed', $5, $6, $7, $8::timestamptz)
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
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 'completed', $5, $6, $7, CURRENT_TIMESTAMP)
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
            VALUES (gen_random_uuid(), $1, $2, $3, 'refund', 'refunded', 'Keycard deposit refund', $4)
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

        if let Some(existing) = sqlx::query("SELECT * FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?
            .as_ref()
            .map(row_mappers::row_to_invoice)
        {
            return Ok(existing);
        }

        let booking_details: (
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
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let (
            _bid,
            _guest_id,
            customer_name,
            customer_email,
            customer_phone,
            check_in,
            check_out,
            room_id,
            room_number,
            room_type,
        ) = booking_details;

        let payment = sqlx::query(
            "SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(booking_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?
        .as_ref()
        .map(row_mappers::row_to_payment);

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

        let invoice = sqlx::query(
            r#"
            INSERT INTO invoices (
                invoice_number, booking_id, payment_id, user_id,
                subtotal, service_charge, service_charge_percentage,
                tax_amount, tax_percentage, keycard_deposit, total_amount,
                line_items, customer_name, customer_email, customer_phone,
                room_number, room_type, check_in_date, check_out_date,
                number_of_nights, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            RETURNING *
            "#,
        )
        .bind(invoice_number)
        .bind(booking_id)
        .bind(payment.as_ref().map(|p| p.id))
        .bind(user_id)
        .bind(decimal_to_db(subtotal))
        .bind(decimal_to_db(service_charge))
        .bind(decimal_to_db(service_charge_pct))
        .bind(decimal_to_db(tax_amount))
        .bind(decimal_to_db(Decimal::ZERO))
        .bind(decimal_to_db(keycard_deposit))
        .bind(decimal_to_db(total))
        .bind(&line_items)
        .bind(&customer_name)
        .bind(&customer_email)
        .bind(&customer_phone)
        .bind(&room_number)
        .bind(&room_type)
        .bind(check_in)
        .bind(check_out)
        .bind(nights)
        .bind(if payment.is_some() { "paid" } else { "draft" })
        .fetch_one(&mut *tx)
        .await
        .map(|row| row_mappers::row_to_invoice(&row))
        .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(invoice)
    }

    pub async fn find_invoice_by_booking_id(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Option<Invoice>, ApiError> {
        let row = sqlx::query("SELECT * FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(row.as_ref().map(row_mappers::row_to_invoice))
    }

    pub async fn find_user_invoices(pool: &DbPool, user_id: i64) -> Result<Vec<Invoice>, ApiError> {
        // The invoices table has no `user_id`/`invoice_date` columns; ownership is
        // tracked via `created_by` and the issue date is `issue_date`.
        let rows = sqlx::query(
            "SELECT * FROM invoices WHERE created_by = $1 ORDER BY issue_date DESC, id DESC",
        )
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

    /// Find invoice by invoice number
    pub async fn find_invoice_by_number(
        pool: &DbPool,
        invoice_number: &str,
    ) -> Result<Option<Invoice>, ApiError> {
        let row = sqlx::query("SELECT * FROM invoices WHERE invoice_number = $1")
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
        total_paid: row_mappers::get_decimal(row, "total_paid"),
        total_refunded: row_mappers::get_decimal(row, "total_refunded"),
        deposit_collected: row_mappers::get_decimal(row, "deposit_collected"),
        deposit_refunded: row_mappers::get_decimal(row, "deposit_refunded"),
        has_failed_payment: row_mappers::get_bool(row, "has_failed_payment"),
    }
}
