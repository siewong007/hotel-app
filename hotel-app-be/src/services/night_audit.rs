//! Night audit business logic

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;
use std::collections::HashMap;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    JournalEntry, JournalSection, NightAuditRunWithUser, RevenueBreakdownItem,
};

/// Check whether a completed audit run exists for the given date.
pub async fn is_audit_completed(pool: &DbPool, audit_date: NaiveDate) -> bool {
    sqlx::query_scalar::<_, Option<bool>>(
        "SELECT EXISTS(SELECT 1 FROM night_audit_runs WHERE audit_date = $1 AND status = 'completed')",
    )
    .bind(audit_date)
    .fetch_one(pool)
    .await
    .unwrap_or(Some(false))
    .unwrap_or(false)
}

/// Delete all records from a previous audit run so it can be re-executed.
pub async fn reset_audit(pool: &DbPool, audit_date: NaiveDate) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM night_audit_posted_nights WHERE audit_date = $1")
        .bind(audit_date)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE bookings SET is_posted = FALSE, posted_date = NULL, posted_at = NULL, posted_by = NULL \
         WHERE posted_date = $1",
    )
    .bind(audit_date)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "DELETE FROM night_audit_details \
         WHERE audit_run_id IN (SELECT id FROM night_audit_runs WHERE audit_date = $1)",
    )
    .bind(audit_date)
    .execute(pool)
    .await
    .ok();

    sqlx::query("DELETE FROM night_audit_runs WHERE audit_date = $1")
        .bind(audit_date)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Call the `run_night_audit` stored procedure and return the new audit run ID.
pub async fn run_audit_procedure(
    pool: &DbPool,
    audit_date: NaiveDate,
    user_id: i64,
) -> Result<i64, ApiError> {
    sqlx::query_scalar("SELECT run_night_audit($1, $2)")
        .bind(audit_date)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            log::error!("Failed to run night audit: {}", e);
            ApiError::Database(format!("Failed to run night audit: {}", e))
        })
}

/// Fetch a single audit run row with payment/channel breakdowns populated.
pub async fn fetch_audit_run_by_id(
    pool: &DbPool,
    audit_run_id: i64,
) -> Result<NightAuditRunWithUser, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            nar.id,
            nar.audit_date,
            nar.run_at,
            u.username,
            nar.status,
            COALESCE(nar.total_bookings_posted, 0) as total_bookings_posted,
            COALESCE(nar.total_checkins, 0) as total_checkins,
            COALESCE(nar.total_checkouts, 0) as total_checkouts,
            COALESCE(nar.total_revenue, 0) as total_revenue,
            COALESCE(nar.occupancy_rate, 0) as occupancy_rate,
            COALESCE(nar.rooms_available, 0) as rooms_available,
            COALESCE(nar.rooms_occupied, 0) as rooms_occupied,
            COALESCE(nar.rooms_reserved, 0) as rooms_reserved,
            COALESCE(nar.rooms_maintenance, 0) as rooms_maintenance,
            COALESCE(nar.rooms_dirty, 0) as rooms_dirty,
            nar.notes,
            nar.created_at
        FROM night_audit_runs nar
        LEFT JOIN users u ON nar.run_by = u.id
        WHERE nar.id = $1
        "#,
    )
    .bind(audit_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Night audit run not found".to_string()))?;

    let audit_date: NaiveDate = row.get("audit_date");
    let (payment_method_breakdown, booking_channel_breakdown) =
        fetch_breakdown_for_date(pool, audit_date).await;

    Ok(NightAuditRunWithUser {
        id: row.get("id"),
        audit_date,
        run_at: row.get("run_at"),
        run_by_username: row.get("username"),
        status: row.get("status"),
        total_bookings_posted: row.get("total_bookings_posted"),
        total_checkins: row.get("total_checkins"),
        total_checkouts: row.get("total_checkouts"),
        total_revenue: row.get("total_revenue"),
        occupancy_rate: row.get("occupancy_rate"),
        rooms_available: row.get("rooms_available"),
        rooms_occupied: row.get("rooms_occupied"),
        rooms_reserved: row.get("rooms_reserved"),
        rooms_maintenance: row.get("rooms_maintenance"),
        rooms_dirty: row.get("rooms_dirty"),
        notes: row.get("notes"),
        created_at: row.get("created_at"),
        payment_method_breakdown,
        booking_channel_breakdown,
    })
}

/// Compute payment-method and booking-channel revenue breakdowns from posted night records.
pub async fn fetch_breakdown_for_date(
    pool: &DbPool,
    audit_date: NaiveDate,
) -> (Vec<RevenueBreakdownItem>, Vec<RevenueBreakdownItem>) {
    let rows = sqlx::query(
        r#"
        SELECT
            COALESCE(b.payment_method, 'Unknown') as payment_method,
            COALESCE(b.source, 'Unknown') as source,
            napn.total_posted as room_rate
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        WHERE napn.audit_date = $1
        "#,
    )
    .bind(audit_date)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut pm_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut bc_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for row in &rows {
        let pm: String = row.get("payment_method");
        let src: String = row.get("source");
        let amt: Decimal = row.get("room_rate");

        let e = pm_map.entry(pm).or_insert((0, Decimal::ZERO));
        e.0 += 1;
        e.1 += amt;

        let e = bc_map.entry(src).or_insert((0, Decimal::ZERO));
        e.0 += 1;
        e.1 += amt;
    }

    let pm_breakdown = pm_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let bc_breakdown = bc_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    (pm_breakdown, bc_breakdown)
}

/// Build journal sections from bookings and payments for a given audit date.
///
/// `is_posted` controls whether to read from `night_audit_posted_nights` (true)
/// or from active unposted bookings (false / preview mode).
pub async fn generate_journal_sections(
    pool: &DbPool,
    audit_date: NaiveDate,
    is_posted: bool,
) -> Vec<JournalSection> {
    let mut entries: Vec<JournalEntry> = Vec::new();

    let tax_rate_pct: Decimal = {
        let raw = sqlx::query_scalar::<_, String>(
            "SELECT value FROM system_settings WHERE key = 'service_tax_rate'",
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
        .and_then(|v| v.parse::<Decimal>().ok())
        .unwrap_or(Decimal::ZERO);

        if raw > Decimal::ZERO { raw } else { Decimal::new(8, 0) }
    };
    let divisor = Decimal::ONE + tax_rate_pct / Decimal::new(100, 0);

    let hotel_timezone: String = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'timezone'",
    )
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "UTC".to_string());

    if is_posted {
        let query = r#"
            SELECT
                b.booking_number,
                r.room_number,
                napn.room_charge,
                napn.service_tax,
                COALESCE(napn.tourism_tax, 0) as tourism_tax,
                COALESCE(napn.extra_bed_charge, 0) as extra_bed_charge,
                COALESCE(napn.extra_bed_tax, 0) as extra_bed_tax,
                COALESCE(b.deposit_amount, 0) as deposit_amount,
                b.check_in_date,
                b.status
            FROM night_audit_posted_nights napn
            JOIN bookings b ON napn.booking_id = b.id
            JOIN rooms r ON b.room_id = r.id
            WHERE napn.audit_date = $1
            ORDER BY r.room_number
        "#;

        match sqlx::query(query).bind(audit_date).fetch_all(pool).await {
            Ok(rows) => {
                for row in &rows {
                    let booking_number: String = row.get("booking_number");
                    let room_number: String = row.get("room_number");
                    let room_charge: Decimal = row.get("room_charge");
                    let service_tax: Decimal = row.get("service_tax");
                    let tourism_tax: Decimal = row.get("tourism_tax");
                    let extra_bed_charge: Decimal = row.get("extra_bed_charge");
                    let extra_bed_tax: Decimal = row.get("extra_bed_tax");
                    let deposit_amount: Decimal = row.get("deposit_amount");
                    let check_in_date: NaiveDate = row.get("check_in_date");

                    if room_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "room_charge".to_string(),
                            debit: room_charge,
                            credit: Decimal::ZERO,
                            description: Some("Room Charge".to_string()),
                        });
                    }
                    if service_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "service_tax".to_string(),
                            debit: service_tax,
                            credit: Decimal::ZERO,
                            description: Some("Service Tax".to_string()),
                        });
                    }
                    if extra_bed_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_charge".to_string(),
                            debit: extra_bed_charge,
                            credit: Decimal::ZERO,
                            description: Some("Extra Bed Charge".to_string()),
                        });
                    }
                    if extra_bed_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_tax".to_string(),
                            debit: extra_bed_tax,
                            credit: Decimal::ZERO,
                            description: Some("Extra Bed Tax".to_string()),
                        });
                    }
                    if tourism_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "tourism_tax".to_string(),
                            debit: tourism_tax,
                            credit: Decimal::ZERO,
                            description: Some("Tourism Tax".to_string()),
                        });
                    }
                    if check_in_date == audit_date && deposit_amount > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "deposit".to_string(),
                            debit: deposit_amount,
                            credit: Decimal::ZERO,
                            description: Some("Deposit".to_string()),
                        });
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to fetch posted room charges for {}: {}", audit_date, e);
            }
        }
    } else {
        let query = r#"
            SELECT
                b.booking_number,
                r.room_number,
                b.room_rate,
                COALESCE(b.extra_bed_charge, 0) as extra_bed_charge,
                COALESCE(b.deposit_amount, 0) as deposit_amount,
                COALESCE(b.source, 'walk_in') as source,
                COALESCE(b.remarks, '') as remarks,
                b.check_in_date,
                b.check_out_date,
                b.status,
                COALESCE(b.is_tourist, false) as is_tourist,
                COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            WHERE b.status NOT IN ('pending', 'confirmed', 'voided')
            AND (
                (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= $1 AND b.check_out_date > $1)
                OR (b.status = 'checked_out' AND b.check_in_date <= $1 AND b.check_out_date >= $1)
            )
            AND NOT EXISTS (
                SELECT 1 FROM night_audit_posted_nights napn
                WHERE napn.booking_id = b.id AND napn.audit_date = $1
            )
            ORDER BY r.room_number
        "#;

        match sqlx::query(query).bind(audit_date).fetch_all(pool).await {
            Ok(rows) => {
                for row in &rows {
                    let booking_number: String = row.get("booking_number");
                    let room_number: String = row.get("room_number");
                    let nightly_rate: Decimal = row.get("room_rate");
                    let extra_bed_charge_raw: Decimal = row.get("extra_bed_charge");
                    let deposit_amount: Decimal = row.get("deposit_amount");
                    let check_in_date: NaiveDate = row.get("check_in_date");
                    let check_out_date: NaiveDate = row.get("check_out_date");
                    let is_tourist: bool = row.get("is_tourist");
                    let tourism_tax_amount: Decimal = row.get("tourism_tax_amount");

                    let room_charge = (nightly_rate / divisor).round_dp(2);
                    let service_tax = nightly_rate - room_charge;

                    if room_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "room_charge".to_string(),
                            debit: room_charge,
                            credit: Decimal::ZERO,
                            description: Some("Room Charge".to_string()),
                        });
                    }
                    if service_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "service_tax".to_string(),
                            debit: service_tax,
                            credit: Decimal::ZERO,
                            description: Some("Service Tax".to_string()),
                        });
                    }

                    if extra_bed_charge_raw > Decimal::ZERO {
                        let extra_bed_charge = (extra_bed_charge_raw / divisor).round_dp(2);
                        let extra_bed_tax = extra_bed_charge_raw - extra_bed_charge;

                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_charge".to_string(),
                            debit: extra_bed_charge,
                            credit: Decimal::ZERO,
                            description: Some("Extra Bed Charge".to_string()),
                        });
                        if extra_bed_tax > Decimal::ZERO {
                            entries.push(JournalEntry {
                                booking_number: booking_number.clone(),
                                room_number: room_number.clone(),
                                entry_type: "extra_bed_tax".to_string(),
                                debit: extra_bed_tax,
                                credit: Decimal::ZERO,
                                description: Some("Extra Bed Tax".to_string()),
                            });
                        }
                    }

                    if is_tourist && tourism_tax_amount > Decimal::ZERO {
                        let nights = (check_out_date - check_in_date).num_days().max(1);
                        let per_night = (tourism_tax_amount / Decimal::from(nights)).round_dp(2);
                        if per_night > Decimal::ZERO {
                            entries.push(JournalEntry {
                                booking_number: booking_number.clone(),
                                room_number: room_number.clone(),
                                entry_type: "tourism_tax".to_string(),
                                debit: per_night,
                                credit: Decimal::ZERO,
                                description: Some("Tourism Tax".to_string()),
                            });
                        }
                    }

                    if check_in_date == audit_date && deposit_amount > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "deposit".to_string(),
                            debit: deposit_amount,
                            credit: Decimal::ZERO,
                            description: Some("Deposit".to_string()),
                        });
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to fetch unposted room charges for {}: {}", audit_date, e);
            }
        }
    }

    // Payments made on the audit date
    let payment_query = r#"
        SELECT
            b.booking_number,
            r.room_number,
            p.amount,
            COALESCE(p.payment_method, '') as payment_method,
            COALESCE(p.payment_type, '') as payment_type,
            COALESCE(p.notes, '') as payment_notes,
            b.check_in_date,
            b.check_out_date
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN rooms r ON b.room_id = r.id
        WHERE p.status = 'completed'
        AND p.payment_type != 'refund'
        AND (p.created_at AT TIME ZONE $2)::date = $1
        ORDER BY r.room_number
    "#;

    match sqlx::query(payment_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(payment_rows) => {
            for row in &payment_rows {
                let booking_number: String = row.get("booking_number");
                let room_number: String = row.get("room_number");
                let amount: Decimal = row.get("amount");
                let payment_method: String = row.get("payment_method");
                let payment_type: String = row.get("payment_type");
                let payment_notes: String = row.get("payment_notes");
                let check_in_date: NaiveDate = row.get("check_in_date");

                if payment_type == "refund" {
                    continue;
                }

                let entry_type = if payment_method.is_empty() {
                    "Cash".to_string()
                } else if payment_method.contains('_') {
                    payment_method
                        .replace('_', " ")
                        .split_whitespace()
                        .map(|w| {
                            let mut chars = w.chars();
                            match chars.next() {
                                Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                                None => String::new(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    let mut chars = payment_method.chars();
                    match chars.next() {
                        Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                        None => "Cash".to_string(),
                    }
                };

                let description = if check_in_date > audit_date {
                    let room_desc = if !payment_notes.is_empty() {
                        payment_notes.clone()
                    } else {
                        format!("Book {} on {}", room_number, check_in_date.format("%d.%m.%Y"))
                    };
                    Some(room_desc)
                } else {
                    None
                };

                entries.push(JournalEntry {
                    booking_number: booking_number.clone(),
                    room_number: room_number.clone(),
                    entry_type: format!("payment_{}", entry_type),
                    debit: amount,
                    credit: Decimal::ZERO,
                    description: description.or_else(|| Some(entry_type.clone())),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to fetch payments for {}: {}", audit_date, e);
        }
    }

    // Deposit refunds on checkout day
    let refund_query = r#"
        SELECT
            b.booking_number,
            r.room_number,
            COALESCE(b.room_card_deposit, 0) as room_card_deposit,
            COALESCE(b.deposit_amount, 0) as deposit_amount
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.status = 'checked_out'
        AND COALESCE((b.actual_check_out AT TIME ZONE $2)::date, b.check_out_date) = $1
        AND (COALESCE(b.room_card_deposit, 0) > 0 OR COALESCE(b.deposit_amount, 0) > 0)
        ORDER BY r.room_number
    "#;

    match sqlx::query(refund_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(refund_rows) => {
            for row in &refund_rows {
                let booking_number: String = row.get("booking_number");
                let room_number: String = row.get("room_number");
                let room_card_deposit: Decimal = row.get("room_card_deposit");
                let deposit_amount: Decimal = row.get("deposit_amount");

                if room_card_deposit > Decimal::ZERO {
                    entries.push(JournalEntry {
                        booking_number: booking_number.clone(),
                        room_number: room_number.clone(),
                        entry_type: "deposit_refund".to_string(),
                        debit: Decimal::ZERO,
                        credit: room_card_deposit,
                        description: Some("Deposit Refund".to_string()),
                    });
                }
                if deposit_amount > Decimal::ZERO && deposit_amount != room_card_deposit {
                    entries.push(JournalEntry {
                        booking_number: booking_number.clone(),
                        room_number: room_number.clone(),
                        entry_type: "deposit_refund".to_string(),
                        debit: Decimal::ZERO,
                        credit: deposit_amount,
                        description: Some("Deposit Refund".to_string()),
                    });
                }
            }
        }
        Err(e) => {
            log::error!("Failed to fetch deposit refunds for {}: {}", audit_date, e);
        }
    }

    // City ledger payments received on the audit date
    let city_ledger_query = r#"
        SELECT
            cl.company_name,
            COALESCE(cl.room_number, '') as room_number,
            clp.payment_amount,
            COALESCE(clp.payment_method, 'Unknown') as payment_method
        FROM customer_ledger_payments clp
        JOIN customer_ledgers cl ON clp.ledger_id = cl.id
        WHERE cl.void_at IS NULL
        AND (clp.payment_date AT TIME ZONE $2)::date = $1
        ORDER BY cl.company_name
    "#;

    match sqlx::query(city_ledger_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(clp_rows) => {
            for row in &clp_rows {
                let company_name: String = row.get("company_name");
                let room_number: String = row.get("room_number");
                let payment_amount: Decimal = row.get("payment_amount");
                let payment_method: String = row.get("payment_method");

                entries.push(JournalEntry {
                    booking_number: company_name,
                    room_number,
                    entry_type: "city_ledger".to_string(),
                    debit: Decimal::ZERO,
                    credit: payment_amount,
                    description: Some(format!("City Ledger Payment ({})", payment_method)),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to fetch city ledger payments for {}: {}", audit_date, e);
        }
    }

    // Group entries into ordered sections
    let fixed_types = [
        ("room_charge", "Room Charges"),
        ("service_tax", "Service Tax"),
        ("extra_bed_charge", "Extra Bed Charges"),
        ("extra_bed_tax", "Extra Bed Tax"),
        ("tourism_tax", "Tourism Tax"),
    ];

    let mut sections: Vec<JournalSection> = Vec::new();

    for (type_key, display_name) in &fixed_types {
        let type_entries: Vec<JournalEntry> =
            entries.iter().filter(|e| e.entry_type == *type_key).cloned().collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            sections.push(JournalSection {
                entry_type: type_key.to_string(),
                display_name: display_name.to_string(),
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    let mut payment_types: Vec<String> = entries
        .iter()
        .filter(|e| e.entry_type.starts_with("payment_"))
        .map(|e| e.entry_type.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    payment_types.sort();

    for pt in &payment_types {
        let type_entries: Vec<JournalEntry> =
            entries.iter().filter(|e| e.entry_type == *pt).cloned().collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            let display_name = type_entries
                .first()
                .and_then(|e| e.description.clone())
                .unwrap_or_else(|| pt.replace("payment_", ""));
            sections.push(JournalSection {
                entry_type: pt.clone(),
                display_name,
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    let trailing_types = [
        ("deposit", "Deposit"),
        ("deposit_refund", "Deposit Refund"),
        ("city_ledger", "City Ledger"),
    ];

    for (type_key, display_name) in &trailing_types {
        let type_entries: Vec<JournalEntry> =
            entries.iter().filter(|e| e.entry_type == *type_key).cloned().collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            sections.push(JournalSection {
                entry_type: type_key.to_string(),
                display_name: display_name.to_string(),
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    sections
}
