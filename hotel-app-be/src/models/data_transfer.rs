//! Data-transfer API models.

use std::collections::HashMap;

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

    // ----- Extended full-backup tables (business config + operational). -----
    // All default to empty so older export files (and partial exports) still
    // deserialize cleanly.
    #[serde(default)]
    pub system_settings: Vec<Value>,
    #[serde(default)]
    pub rate_plans: Vec<Value>,
    #[serde(default)]
    pub room_rates: Vec<Value>,
    #[serde(default)]
    pub amenities: Vec<Value>,
    #[serde(default)]
    pub room_type_amenities: Vec<Value>,
    #[serde(default)]
    pub services: Vec<Value>,
    #[serde(default)]
    pub booking_services: Vec<Value>,
    #[serde(default)]
    pub booking_channels: Vec<Value>,
    #[serde(default)]
    pub room_status_transitions: Vec<Value>,
    #[serde(default)]
    pub room_history: Vec<Value>,
    #[serde(default)]
    pub room_status_change_log: Vec<Value>,
    #[serde(default)]
    pub email_templates: Vec<Value>,
    #[serde(default)]
    pub loyalty_programs: Vec<Value>,
    #[serde(default)]
    pub loyalty_tiers: Vec<Value>,
    #[serde(default)]
    pub loyalty_memberships: Vec<Value>,
    #[serde(default)]
    pub loyalty_members: Vec<Value>,
    #[serde(default)]
    pub loyalty_accounts: Vec<Value>,
    #[serde(default)]
    pub points_transactions: Vec<Value>,
    #[serde(default)]
    pub loyalty_transactions: Vec<Value>,
    #[serde(default)]
    pub reward_catalog: Vec<Value>,
    #[serde(default)]
    pub loyalty_rewards: Vec<Value>,
    #[serde(default)]
    pub reward_redemptions: Vec<Value>,
    #[serde(default)]
    pub loyalty_redemptions: Vec<Value>,
    #[serde(default)]
    pub loyalty_program_rules: Vec<Value>,
    #[serde(default)]
    pub corporate_accounts: Vec<Value>,
    #[serde(default)]
    pub corporate_account_contacts: Vec<Value>,
    #[serde(default)]
    pub housekeeping_tasks: Vec<Value>,
    #[serde(default)]
    pub maintenance_tickets: Vec<Value>,
    #[serde(default)]
    pub guest_documents: Vec<Value>,
    #[serde(default)]
    pub guest_notes: Vec<Value>,
    #[serde(default)]
    pub guest_preferences: Vec<Value>,
    #[serde(default)]
    pub guest_reviews: Vec<Value>,
    #[serde(default)]
    pub self_checkin_events: Vec<Value>,
    #[serde(default)]
    pub night_audit_posted_nights: Vec<Value>,
}

/// Count preview for all transferable tables before generating an export file.
#[derive(Debug, Serialize)]
pub struct ExportPreview {
    pub generated_at: String,
    pub counts: HashMap<String, i64>,
    pub total_records: i64,
}

/// Import request wrapper.
#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub mode: ImportMode,
    pub data: BookingDataExport,
    #[serde(default)]
    pub tables: Vec<String>,
}
