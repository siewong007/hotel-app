//! Night Audit handlers for posting daily data for reporting

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{NaiveDate, DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;
use crate::services::audit::AuditLog;
use std::collections::HashMap;

/// Revenue breakdown by category
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RevenueBreakdownItem {
    pub category: String,
    pub count: i32,
    pub amount: Decimal,
}

/// Night audit run with username
#[derive(Debug, Serialize, Deserialize)]
pub struct NightAuditRunWithUser {
    pub id: i64,
    pub audit_date: NaiveDate,
    pub run_at: DateTime<Utc>,
    pub run_by_username: Option<String>,
    pub status: String,
    pub total_bookings_posted: i32,
    pub total_checkins: i32,
    pub total_checkouts: i32,
    pub total_revenue: Decimal,
    pub occupancy_rate: Decimal,
    pub rooms_available: i32,
    pub rooms_occupied: i32,
    pub rooms_reserved: i32,
    pub rooms_maintenance: i32,
    pub rooms_dirty: i32,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub payment_method_breakdown: Vec<RevenueBreakdownItem>,
    #[serde(default)]
    pub booking_channel_breakdown: Vec<RevenueBreakdownItem>,
}

/// Unposted booking for preview
#[derive(Debug, Serialize, Deserialize)]
pub struct UnpostedBooking {
    pub booking_id: i64,
    pub booking_number: String,
    pub guest_name: String,
    pub room_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub total_amount: Decimal,
    pub payment_method: Option<String>,
    pub source: Option<String>,
}

/// Journal entry for night audit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub booking_number: String,
    pub room_number: String,
    pub entry_type: String,  // room_charge, service_tax, cash, deposit, deposit_refund, other
    pub debit: Decimal,
    pub credit: Decimal,
    pub description: Option<String>,
}

/// Journal section grouped by type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalSection {
    pub entry_type: String,
    pub display_name: String,
    pub entries: Vec<JournalEntry>,
    pub total_debit: Decimal,
    pub total_credit: Decimal,
}

/// Request to run night audit
#[derive(Debug, Deserialize)]
pub struct RunNightAuditRequest {
    pub audit_date: String,  // YYYY-MM-DD format
    pub notes: Option<String>,
    #[serde(default)]
    pub force: bool,  // If true, allow rerunning even if already completed
}

/// Query params for listing audits
#[derive(Debug, Deserialize)]
pub struct ListAuditsQuery {
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

/// Response for night audit run
#[derive(Debug, Serialize)]
pub struct NightAuditResponse {
    pub success: bool,
    pub audit_run: NightAuditRunWithUser,
    pub message: String,
}

/// Preview response before running audit
#[derive(Debug, Serialize)]
pub struct NightAuditPreview {
    pub audit_date: String,
    pub can_run: bool,
    pub already_run: bool,
    pub unposted_bookings: Vec<UnpostedBooking>,
    pub total_unposted: i32,
    pub estimated_revenue: Decimal,
    pub room_snapshot: RoomSnapshot,
    pub payment_method_breakdown: Vec<RevenueBreakdownItem>,
    pub booking_channel_breakdown: Vec<RevenueBreakdownItem>,
    pub journal_sections: Vec<JournalSection>,
}

#[derive(Debug, Serialize)]
pub struct RoomSnapshot {
    pub total: i32,
    pub available: i32,
    pub occupied: i32,
    pub reserved: i32,
    pub maintenance: i32,
    pub dirty: i32,
}

/// Generate journal sections from bookings and payments for a given date
async fn generate_journal_sections(pool: &DbPool, audit_date: NaiveDate, is_posted: bool) -> Vec<JournalSection> {
    let mut entries: Vec<JournalEntry> = Vec::new();

    // Service tax rate: read from system_settings, must be > 0, default 8%
    let tax_rate_pct: Decimal = {
        let raw = sqlx::query_scalar::<_, String>(
            "SELECT value FROM system_settings WHERE key = 'service_tax_rate'"
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
        .and_then(|v| v.parse::<Decimal>().ok())
        .unwrap_or(Decimal::ZERO);

        if raw > Decimal::ZERO { raw } else { Decimal::new(8, 0) }
    };
    // e.g. tax_rate_pct = 8  =>  divisor = 1.08
    let divisor = Decimal::ONE + tax_rate_pct / Decimal::new(100, 0);

    // Hotel timezone: read from system_settings, default to UTC
    let hotel_timezone: String = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'timezone'"
    )
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "UTC".to_string());

    // Get per-night room charges for the audit date
    // For posted audits: read from night_audit_posted_nights
    // For unposted (preview): find active bookings whose night hasn't been posted yet
    if is_posted {
        // Already-posted nights: read from the posted_nights table
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

        match sqlx::query(query)
            .bind(audit_date)
            .fetch_all(pool)
            .await
        {
            Ok(rows) => {
                for row in rows.iter() {
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

                    // Deposits only post on the check-in night
                    if check_in_date == audit_date
                        && deposit_amount > Decimal::ZERO {
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
        // Preview (unposted): find active bookings on the audit date that haven't been posted for this night
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
            WHERE b.status NOT IN ('pending', 'confirmed', 'no_show', 'voided')
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

        match sqlx::query(query)
            .bind(audit_date)
            .fetch_all(pool)
            .await
        {
            Ok(rows) => {
            for row in rows.iter() {
                let booking_number: String = row.get("booking_number");
                let room_number: String = row.get("room_number");
                let nightly_rate: Decimal = row.get("room_rate");
                let extra_bed_charge_raw: Decimal = row.get("extra_bed_charge");
                let deposit_amount: Decimal = row.get("deposit_amount");
                let check_in_date: NaiveDate = row.get("check_in_date");
                let check_out_date: NaiveDate = row.get("check_out_date");
                let is_tourist: bool = row.get("is_tourist");
                let tourism_tax_amount: Decimal = row.get("tourism_tax_amount");

                // Per-night charge: back-calculate room charge and tax from tax-inclusive nightly rate
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

                // Extra bed charge: back-calculate charge and tax from tax-inclusive amount
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

                // Tourism tax: per-night amount for tourist bookings
                if is_tourist && tourism_tax_amount > Decimal::ZERO {
                    let nights = (check_out_date - check_in_date).num_days().max(1);
                    let tourism_tax_per_night = (tourism_tax_amount / Decimal::from(nights)).round_dp(2);
                    if tourism_tax_per_night > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "tourism_tax".to_string(),
                            debit: tourism_tax_per_night,
                            credit: Decimal::ZERO,
                            description: Some("Tourism Tax".to_string()),
                        });
                    }
                }

                // Deposits only post on the check-in night
                if check_in_date == audit_date
                    && deposit_amount > Decimal::ZERO {
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

    // Get ALL payments made on the audit date, regardless of booking status/dates.
    // A payment received today (e.g. bank transfer for a future booking) should appear in today's audit.
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
        for row in payment_rows.iter() {
            let booking_number: String = row.get("booking_number");
            let room_number: String = row.get("room_number");
            let amount: Decimal = row.get("amount");
            let payment_method: String = row.get("payment_method");
            let payment_type: String = row.get("payment_type");
            let payment_notes: String = row.get("payment_notes");
            let check_in_date: NaiveDate = row.get("check_in_date");
            let _check_out_date: NaiveDate = row.get("check_out_date");

            // Skip refund/deposit type payments (handled separately)
            if payment_type == "refund" {
                continue;
            }

            // Determine entry type from the individual payment's method
            let entry_type = if payment_method.is_empty() {
                "Cash".to_string()
            } else if payment_method.contains('_') {
                payment_method.replace('_', " ")
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
                // Normalize to title case (e.g. "cash" -> "Cash")
                let mut chars = payment_method.chars();
                match chars.next() {
                    Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                    None => "Cash".to_string(),
                }
            };

            // For advance payments (check-in is after audit date), add booking info to description
            let description = if check_in_date > audit_date {
                // Format: "Book FR on 21.03.2026" or "Book FR on 20/3-21/3"
                let room_desc = if !payment_notes.is_empty() {
                    payment_notes.clone()
                } else {
                    format!("Book {} on {}", room_number,
                        check_in_date.format("%d.%m.%Y"))
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

    // Get deposit refunds: bookings checked out on the audit date with any deposit
    // Deposit refunds happen on checkout day regardless of posted status
    // Must check both room_card_deposit and deposit_amount (mirrors deposit collection logic)
    // Use actual_check_out converted to hotel timezone for accurate date matching,
    // falling back to check_out_date for legacy bookings without actual_check_out
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
        for row in refund_rows.iter() {
            let booking_number: String = row.get("booking_number");
            let room_number: String = row.get("room_number");
            let room_card_deposit: Decimal = row.get("room_card_deposit");
            let deposit_amount: Decimal = row.get("deposit_amount");

            // Mirror the deposit collection logic: refund room_card_deposit first,
            // then deposit_amount if it's different (avoids double-refunding)
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

    // Get city ledger entries: charges posted to company accounts on the audit date
    let city_ledger_query = r#"
        SELECT
            cl.company_name,
            COALESCE(cl.room_number, '') as room_number,
            cl.amount,
            COALESCE(cl.transaction_type, 'debit') as transaction_type,
            COALESCE(cl.description, 'Guest Ledger Transfer') as description
        FROM customer_ledgers cl
        WHERE cl.void_at IS NULL
        AND COALESCE(cl.posting_date, (cl.created_at AT TIME ZONE $2)::date) = $1
        ORDER BY cl.company_name, cl.room_number
    "#;

    match sqlx::query(city_ledger_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(cl_rows) => {
            for row in cl_rows.iter() {
                let company_name: String = row.get("company_name");
                let room_number: String = row.get("room_number");
                let amount: Decimal = row.get("amount");
                let transaction_type: String = row.get("transaction_type");
                let description: String = row.get("description");

                let (debit, credit) = if transaction_type == "credit" {
                    (Decimal::ZERO, amount)
                } else {
                    (amount, Decimal::ZERO)
                };

                entries.push(JournalEntry {
                    booking_number: company_name,
                    room_number,
                    entry_type: "city_ledger".to_string(),
                    debit,
                    credit,
                    description: Some(description),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to fetch city ledger charges for {}: {}", audit_date, e);
        }
    }

    // Get city ledger payments received on the audit date
    let city_ledger_payments_query = r#"
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

    match sqlx::query(city_ledger_payments_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(clp_rows) => {
            for row in clp_rows.iter() {
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

    // Group entries by type - fixed order, then dynamic payment types
    let fixed_types = vec![
        ("room_charge", "Room Charges"),
        ("service_tax", "Service Tax"),
        ("extra_bed_charge", "Extra Bed Charges"),
        ("extra_bed_tax", "Extra Bed Tax"),
        ("tourism_tax", "Tourism Tax"),
    ];

    let mut sections: Vec<JournalSection> = Vec::new();

    // Add fixed sections first
    for (type_key, display_name) in &fixed_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *type_key)
            .cloned()
            .collect();

        if !type_entries.is_empty() {
            let total_debit: Decimal = type_entries.iter().map(|e| e.debit).sum();
            let total_credit: Decimal = type_entries.iter().map(|e| e.credit).sum();

            sections.push(JournalSection {
                entry_type: type_key.to_string(),
                display_name: display_name.to_string(),
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    // Collect unique payment entry types (payment_cash, payment_debit_card, payment_Booking.Com, etc.)
    let mut payment_types: Vec<String> = entries
        .iter()
        .filter(|e| e.entry_type.starts_with("payment_"))
        .map(|e| e.entry_type.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    payment_types.sort();

    for pt in &payment_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *pt)
            .cloned()
            .collect();

        if !type_entries.is_empty() {
            let total_debit: Decimal = type_entries.iter().map(|e| e.debit).sum();
            let total_credit: Decimal = type_entries.iter().map(|e| e.credit).sum();

            // Derive display name from the entry description
            let display_name = type_entries.first()
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

    // Add deposit, deposit_refund, and city_ledger sections
    let trailing_types = vec![
        ("deposit", "Deposit"),
        ("deposit_refund", "Deposit Refund"),
        ("city_ledger", "City Ledger"),
    ];

    for (type_key, display_name) in &trailing_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *type_key)
            .cloned()
            .collect();

        if !type_entries.is_empty() {
            let total_debit: Decimal = type_entries.iter().map(|e| e.debit).sum();
            let total_credit: Decimal = type_entries.iter().map(|e| e.credit).sum();

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

/// Get preview of what will be posted for a given date
pub async fn get_night_audit_preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<NightAuditPreview>, ApiError> {
    log::info!("Night audit preview called with params: {:?}", params);

    let _user_id = match require_permission_helper(&pool, &headers, "night_audit:read").await {
        Ok(id) => id,
        Err(e) => {
            log::error!("Permission check failed: {:?}", e);
            return Err(e);
        }
    };

    let audit_date_str = params.get("date").ok_or_else(|| {
        ApiError::BadRequest("date parameter is required".to_string())
    })?;

    let audit_date = NaiveDate::parse_from_str(audit_date_str, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date format. Use YYYY-MM-DD".to_string()))?;

    log::info!("Checking if audit already run for date: {}", audit_date);

    // Check if already run
    let already_run: bool = match sqlx::query_scalar::<_, Option<bool>>(
        "SELECT EXISTS(SELECT 1 FROM night_audit_runs WHERE audit_date = $1 AND status = 'completed')"
    )
    .bind(audit_date)
    .fetch_one(&pool)
    .await {
        Ok(Some(v)) => v,
        Ok(None) => false,
        Err(e) => {
            log::error!("Error checking already_run: {:?}", e);
            false
        }
    };

    log::info!("Already run: {}, fetching unposted bookings", already_run);

    // Get bookings active on the audit date whose night hasn't been posted yet
    let rows = sqlx::query(
        r#"
        SELECT
            b.id as booking_id,
            b.booking_number,
            COALESCE(g.full_name, COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) as guest_name,
            r.room_number,
            b.check_in_date::text as check_in_date,
            b.check_out_date::text as check_out_date,
            COALESCE(b.status, 'unknown') as status,
            b.room_rate,
            COALESCE(b.extra_bed_charge, 0) as extra_bed_charge,
            b.total_amount,
            b.payment_method,
            b.source
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.status NOT IN ('pending', 'confirmed', 'no_show', 'voided')
        AND (
            (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= $1 AND b.check_out_date > $1)
            OR (b.status = 'checked_out' AND b.check_in_date <= $1 AND b.check_out_date >= $1)
        )
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = $1
        )
        ORDER BY r.room_number
        "#
    )
    .bind(audit_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching unposted bookings: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Fetched {} booking rows", rows.len());

    let mut unposted_bookings: Vec<UnpostedBooking> = Vec::new();
    let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for row in rows.iter() {
        let check_in_str: String = row.get("check_in_date");
        let check_out_str: String = row.get("check_out_date");

        let check_in = NaiveDate::parse_from_str(&check_in_str, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
        let check_out = NaiveDate::parse_from_str(&check_out_str, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());

        let payment_method: Option<String> = row.get("payment_method");
        let source: Option<String> = row.get("source");
        let room_rate: Decimal = row.get("room_rate");
        let extra_bed_charge: Decimal = row.get("extra_bed_charge");
        let _total_amount: Decimal = row.get("total_amount");
        let status: String = row.get("status");

        // Use per-night room_rate + extra_bed_charge for revenue aggregation
        let night_total = room_rate + extra_bed_charge;
        let pm_key = payment_method.clone().unwrap_or_else(|| "Unknown".to_string());
        let pm_entry = payment_method_map.entry(pm_key).or_insert((0, Decimal::ZERO));
        pm_entry.0 += 1;
        pm_entry.1 += night_total;

        let bc_key = source.clone().unwrap_or_else(|| "Unknown".to_string());
        let bc_entry = booking_channel_map.entry(bc_key).or_insert((0, Decimal::ZERO));
        bc_entry.0 += 1;
        bc_entry.1 += night_total;

        unposted_bookings.push(UnpostedBooking {
            booking_id: row.get("booking_id"),
            booking_number: row.get("booking_number"),
            guest_name: row.get("guest_name"),
            room_number: row.get("room_number"),
            check_in_date: check_in,
            check_out_date: check_out,
            status,
            total_amount: night_total, // Show per-night rate + extra bed in preview
            payment_method,
            source,
        });
    }

    log::info!("Parsed {} unposted bookings", unposted_bookings.len());

    // Convert maps to breakdown vectors
    let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let total_unposted = unposted_bookings.len() as i32;
    let estimated_revenue: Decimal = unposted_bookings.iter()
        .map(|b| b.total_amount)
        .sum();

    log::info!("Estimated revenue: {}, fetching room snapshot", estimated_revenue);

    // Get room snapshot - use i64 counts then convert
    let room_row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('available', 'clean')) as available,
            COUNT(*) FILTER (WHERE status = 'occupied') as occupied,
            COUNT(*) FILTER (WHERE status = 'reserved') as reserved,
            COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')) as maintenance,
            COUNT(*) FILTER (WHERE status IN ('dirty', 'cleaning')) as dirty
        FROM rooms
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching room snapshot: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Room snapshot fetched successfully");

    let total: i64 = room_row.get("total");
    let available: i64 = room_row.get("available");
    let occupied: i64 = room_row.get("occupied");
    let reserved: i64 = room_row.get("reserved");
    let maintenance: i64 = room_row.get("maintenance");
    let dirty: i64 = room_row.get("dirty");

    log::info!("Room stats - total: {}, available: {}, occupied: {}", total, available, occupied);

    // Count occupied rooms from active bookings
    let occupied_from_bookings: i64 = sqlx::query_scalar::<_, Option<i64>>(
        r#"
        SELECT COUNT(DISTINCT r.id)
        FROM rooms r
        JOIN bookings b ON r.id = b.room_id
        WHERE b.status = 'checked_in'
        AND b.check_in_date <= $1
        AND b.check_out_date > $1
        "#
    )
    .bind(audit_date)
    .fetch_one(&pool)
    .await
    .unwrap_or(Some(0))
    .unwrap_or(0);

    log::info!("Occupied from bookings: {}", occupied_from_bookings);

    // Generate journal sections for preview
    let journal_sections = generate_journal_sections(&pool, audit_date, false).await;

    Ok(Json(NightAuditPreview {
        audit_date: audit_date.to_string(),
        can_run: !already_run,
        already_run,
        unposted_bookings,
        total_unposted,
        estimated_revenue,
        room_snapshot: RoomSnapshot {
            total: total as i32,
            available: available as i32,
            occupied: std::cmp::max(occupied as i32, occupied_from_bookings as i32),
            reserved: reserved as i32,
            maintenance: maintenance as i32,
            dirty: dirty as i32,
        },
        payment_method_breakdown,
        booking_channel_breakdown,
        journal_sections,
    }))
}

/// Run night audit for a specific date
pub async fn run_night_audit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RunNightAuditRequest>,
) -> Result<Json<NightAuditResponse>, ApiError> {
    log::info!("Run night audit called for date: {}, force: {}", input.audit_date, input.force);
    let user_id = require_permission_helper(&pool, &headers, "night_audit:execute").await?;
    log::info!("User {} authorized for night audit", user_id);

    let audit_date = NaiveDate::parse_from_str(&input.audit_date, "%Y-%m-%d")
        .map_err(|e| {
            log::error!("Invalid date format: {} - error: {}", input.audit_date, e);
            ApiError::BadRequest(format!("Invalid date format '{}'. Use YYYY-MM-DD", input.audit_date))
        })?;

    // Check if already run
    let already_run: bool = sqlx::query_scalar::<_, Option<bool>>(
        "SELECT EXISTS(SELECT 1 FROM night_audit_runs WHERE audit_date = $1 AND status = 'completed')"
    )
    .bind(audit_date)
    .fetch_one(&pool)
    .await
    .unwrap_or(Some(false))
    .unwrap_or(false);

    log::info!("Checking if audit already run for {}: {}", audit_date, already_run);

    if already_run {
        if input.force {
            // Reset the previous audit: delete audit run and reset bookings
            log::info!("Force rerun requested for {}. Resetting previous audit.", audit_date);

            // Delete per-night posting records for this date
            sqlx::query(
                "DELETE FROM night_audit_posted_nights WHERE audit_date = $1"
            )
            .bind(audit_date)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            // Reset legacy is_posted flag for bookings that were posted on this date
            sqlx::query(
                "UPDATE bookings SET is_posted = FALSE, posted_date = NULL, posted_at = NULL, posted_by = NULL WHERE posted_date = $1"
            )
            .bind(audit_date)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            // Delete audit details for this date
            sqlx::query(
                "DELETE FROM night_audit_details WHERE audit_run_id IN (SELECT id FROM night_audit_runs WHERE audit_date = $1)"
            )
            .bind(audit_date)
            .execute(&pool)
            .await
            .ok();

            // Delete the audit run record
            sqlx::query("DELETE FROM night_audit_runs WHERE audit_date = $1")
                .bind(audit_date)
                .execute(&pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            log::info!("Previous audit for {} has been reset", audit_date);
        } else {
            return Err(ApiError::BadRequest(format!(
                "Night audit already completed for {}. Use force=true to rerun.",
                audit_date
            )));
        }
    }

    // Run the night audit using the database function
    log::info!("Running night audit database function for {}", audit_date);
    let audit_run_id: i64 = sqlx::query_scalar(
        "SELECT run_night_audit($1, $2)"
    )
    .bind(audit_date)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        log::error!("Failed to run night audit: {}", e);
        ApiError::Database(format!("Failed to run night audit: {}", e))
    })?;
    log::info!("Night audit completed, run ID: {}", audit_run_id);

    // Update notes if provided
    if let Some(notes) = &input.notes {
        let _ = sqlx::query("UPDATE night_audit_runs SET notes = $1 WHERE id = $2")
            .bind(notes)
            .bind(audit_run_id)
            .execute(&pool)
            .await;
    }

    // Fetch the audit run details
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
        "#
    )
    .bind(audit_run_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log audit event
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "night_audit_run",
        "night_audit",
        Some(audit_run_id),
        Some(serde_json::json!({
            "audit_date": audit_date.to_string(),
            "bookings_posted": row.get::<i32, _>("total_bookings_posted"),
            "revenue": row.get::<Decimal, _>("total_revenue").to_string(),
        })),
        None,
        None,
    ).await;

    // Compute breakdown from per-night posted records for this audit date
    let breakdown_rows = sqlx::query(
        r#"
        SELECT
            COALESCE(b.payment_method, 'Unknown') as payment_method,
            COALESCE(b.source, 'Unknown') as source,
            napn.total_posted as room_rate
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        WHERE napn.audit_date = $1
        "#
    )
    .bind(audit_date)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for br in breakdown_rows.iter() {
        let pm: String = br.get("payment_method");
        let src: String = br.get("source");
        let amt: Decimal = br.get("room_rate");

        let pm_entry = payment_method_map.entry(pm).or_insert((0, Decimal::ZERO));
        pm_entry.0 += 1;
        pm_entry.1 += amt;

        let bc_entry = booking_channel_map.entry(src).or_insert((0, Decimal::ZERO));
        bc_entry.0 += 1;
        bc_entry.1 += amt;
    }

    let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    Ok(Json(NightAuditResponse {
        success: true,
        audit_run: NightAuditRunWithUser {
            id: row.get("id"),
            audit_date: row.get("audit_date"),
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
        },
        message: format!("Night audit completed successfully for {}", audit_date),
    }))
}

/// List all night audit runs
pub async fn list_night_audits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<ListAuditsQuery>,
) -> Result<Json<Vec<NightAuditRunWithUser>>, ApiError> {
    log::info!("List night audits called");
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(30).min(100);
    let offset = (page - 1) * page_size;
    log::info!("Fetching audits page {} with size {}", page, page_size);

    let rows = sqlx::query(
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
            nar.created_at,
            COALESCE(nar.payment_method_breakdown, '{}') as payment_method_breakdown,
            COALESCE(nar.booking_channel_breakdown, '{}') as booking_channel_breakdown
        FROM night_audit_runs nar
        LEFT JOIN users u ON nar.run_by = u.id
        ORDER BY nar.audit_date DESC
        LIMIT $1 OFFSET $2
        "#
    )
    .bind(page_size)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        log::error!("Failed to fetch night audit runs: {}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Fetched {} night audit rows", rows.len());

    let mut result: Vec<NightAuditRunWithUser> = Vec::new();
    for row in rows.iter() {
        let audit_date: NaiveDate = row.get("audit_date");

        // Compute breakdown from per-night posted records for this audit date
        let breakdown_rows = sqlx::query(
            r#"
            SELECT
                COALESCE(b.payment_method, 'Unknown') as payment_method,
                COALESCE(b.source, 'Unknown') as source,
                napn.total_posted as room_rate
            FROM night_audit_posted_nights napn
            JOIN bookings b ON napn.booking_id = b.id
            WHERE napn.audit_date = $1
            "#
        )
        .bind(audit_date)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
        let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

        for br in breakdown_rows.iter() {
            let pm: String = br.get("payment_method");
            let src: String = br.get("source");
            let amt: Decimal = br.get("room_rate");

            let pm_entry = payment_method_map.entry(pm).or_insert((0, Decimal::ZERO));
            pm_entry.0 += 1;
            pm_entry.1 += amt;

            let bc_entry = booking_channel_map.entry(src).or_insert((0, Decimal::ZERO));
            bc_entry.0 += 1;
            bc_entry.1 += amt;
        }

        let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
            .into_iter()
            .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
            .collect();

        let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
            .into_iter()
            .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
            .collect();

        result.push(NightAuditRunWithUser {
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
        });
    }

    log::info!("List night audits returning {} results", result.len());
    Ok(Json(result))
}

/// Get a specific night audit run by ID
pub async fn get_night_audit(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<NightAuditRunWithUser>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;

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
        "#
    )
    .bind(audit_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Night audit run not found".to_string()))?;

    let audit_date: NaiveDate = row.get("audit_date");

    // Compute breakdown from per-night posted records for this audit date
    let breakdown_rows = sqlx::query(
        r#"
        SELECT
            COALESCE(b.payment_method, 'Unknown') as payment_method,
            COALESCE(b.source, 'Unknown') as source,
            napn.total_posted as room_rate
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        WHERE napn.audit_date = $1
        "#
    )
    .bind(audit_date)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for br in breakdown_rows.iter() {
        let pm: String = br.get("payment_method");
        let src: String = br.get("source");
        let amt: Decimal = br.get("room_rate");

        let pm_entry = payment_method_map.entry(pm).or_insert((0, Decimal::ZERO));
        pm_entry.0 += 1;
        pm_entry.1 += amt;

        let bc_entry = booking_channel_map.entry(src).or_insert((0, Decimal::ZERO));
        bc_entry.0 += 1;
        bc_entry.1 += amt;
    }

    let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    Ok(Json(NightAuditRunWithUser {
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
    }))
}

/// Posted booking detail for audit export
#[derive(Debug, Serialize, Deserialize)]
pub struct PostedBookingDetail {
    pub booking_id: i64,
    pub booking_number: String,
    pub guest_name: String,
    pub room_number: String,
    pub room_type: String,
    pub room_type_code: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights: i32,
    pub status: String,
    pub total_amount: Decimal,
    pub payment_status: Option<String>,
    pub payment_method: Option<String>,
    pub source: Option<String>,
}

/// Audit details response with posted bookings
#[derive(Debug, Serialize)]
pub struct AuditDetailsResponse {
    pub audit_run: NightAuditRunWithUser,
    pub posted_bookings: Vec<PostedBookingDetail>,
    pub journal_sections: Vec<JournalSection>,
}

/// Get audit details including all posted bookings
pub async fn get_night_audit_details(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<AuditDetailsResponse>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;

    // Get the audit run
    let audit_row = sqlx::query(
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
        "#
    )
    .bind(audit_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Night audit run not found".to_string()))?;

    let audit_date: NaiveDate = audit_row.get("audit_date");

    // Get all bookings that were posted for this audit date (per-night)
    let booking_rows = sqlx::query(
        r#"
        SELECT
            b.id as booking_id,
            b.booking_number,
            COALESCE(g.full_name, COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) as guest_name,
            r.room_number,
            COALESCE(rt.name, 'Unknown') as room_type,
            rt.code as room_type_code,
            b.check_in_date,
            b.check_out_date,
            (b.check_out_date - b.check_in_date)::integer as nights,
            COALESCE(b.status, 'unknown') as status,
            napn.total_posted as total_amount,
            b.payment_status,
            b.source,
            COALESCE(b.payment_method, 'Unknown') as payment_method
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN room_types rt ON r.room_type_id = rt.id
        WHERE napn.audit_date = $1
        ORDER BY r.room_number, b.check_in_date
        "#
    )
    .bind(audit_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Compute breakdowns from posted bookings
    let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    let posted_bookings: Vec<PostedBookingDetail> = booking_rows.iter().map(|row| {
        let source: Option<String> = row.get("source");
        let total_amount: Decimal = row.get("total_amount");
        let pm: String = row.get("payment_method");
        let src = source.clone().unwrap_or_else(|| "Unknown".to_string());

        let pm_entry = payment_method_map.entry(pm.clone()).or_insert((0, Decimal::ZERO));
        pm_entry.0 += 1;
        pm_entry.1 += total_amount;

        let bc_entry = booking_channel_map.entry(src).or_insert((0, Decimal::ZERO));
        bc_entry.0 += 1;
        bc_entry.1 += total_amount;

        PostedBookingDetail {
            booking_id: row.get("booking_id"),
            booking_number: row.get("booking_number"),
            guest_name: row.get("guest_name"),
            room_number: row.get("room_number"),
            room_type: row.get("room_type"),
            room_type_code: row.get("room_type_code"),
            check_in_date: row.get("check_in_date"),
            check_out_date: row.get("check_out_date"),
            nights: row.get("nights"),
            status: row.get("status"),
            total_amount,
            payment_status: row.get("payment_status"),
            payment_method: Some(pm),
            source,
        }
    }).collect();

    let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem { category, count, amount })
        .collect();

    // Generate journal sections for posted bookings
    let journal_sections = generate_journal_sections(&pool, audit_date, true).await;

    Ok(Json(AuditDetailsResponse {
        audit_run: NightAuditRunWithUser {
            id: audit_row.get("id"),
            audit_date,
            run_at: audit_row.get("run_at"),
            run_by_username: audit_row.get("username"),
            status: audit_row.get("status"),
            total_bookings_posted: audit_row.get("total_bookings_posted"),
            total_checkins: audit_row.get("total_checkins"),
            total_checkouts: audit_row.get("total_checkouts"),
            total_revenue: audit_row.get("total_revenue"),
            occupancy_rate: audit_row.get("occupancy_rate"),
            rooms_available: audit_row.get("rooms_available"),
            rooms_occupied: audit_row.get("rooms_occupied"),
            rooms_reserved: audit_row.get("rooms_reserved"),
            rooms_maintenance: audit_row.get("rooms_maintenance"),
            rooms_dirty: audit_row.get("rooms_dirty"),
            notes: audit_row.get("notes"),
            created_at: audit_row.get("created_at"),
            payment_method_breakdown,
            booking_channel_breakdown,
        },
        posted_bookings,
        journal_sections,
    }))
}

/// Check if a booking is posted (can be used to prevent editing)
pub async fn is_booking_posted(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "bookings:read").await?;

    let row = sqlx::query(
        "SELECT COALESCE(is_posted, false) as is_posted, posted_date FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match row {
        Some(r) => Ok(Json(serde_json::json!({
            "booking_id": booking_id,
            "is_posted": r.get::<bool, _>("is_posted"),
            "posted_date": r.get::<Option<NaiveDate>, _>("posted_date"),
        }))),
        None => Err(ApiError::NotFound("Booking not found".to_string())),
    }
}
