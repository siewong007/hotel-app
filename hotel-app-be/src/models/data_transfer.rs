//! Data-transfer API models.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants::ImportMode;

/// Represents all booking-related data for export/import.
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingDataExport {
    pub version: String,
    pub exported_at: String,
    pub guests: Vec<Value>,
    pub guest_complimentary_credits: Vec<Value>,
    pub companies: Vec<Value>,
    pub bookings: Vec<Value>,
    pub payments: Vec<Value>,
    pub invoices: Vec<Value>,
    pub booking_guests: Vec<Value>,
    pub booking_modifications: Vec<Value>,
    pub booking_history: Vec<Value>,
    pub night_audit_runs: Vec<Value>,
    pub night_audit_details: Vec<Value>,
    pub customer_ledgers: Vec<Value>,
    pub customer_ledger_payments: Vec<Value>,
    pub room_changes: Vec<Value>,
    #[serde(default)]
    pub user_guests: Vec<Value>,
    #[serde(default)]
    pub rooms: Vec<Value>,
    #[serde(default)]
    pub room_types: Vec<Value>,
}

/// Import request wrapper.
#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub mode: ImportMode,
    pub data: BookingDataExport,
}
