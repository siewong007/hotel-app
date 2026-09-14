//! The governed report catalog — one registry entry per report type, so the
//! filter bar, envelope adapter, and permission surface all agree on what a
//! report is called and which parameters it consumes.
//!
//! The generator SQL still lives in `repositories/analytics.rs` (and
//! `repositories/channel_net_revenue.rs`); this catalog owns identity,
//! declared params, and date basis. Migrating generator bodies into
//! `queries.rs` is staged work — the envelope does not depend on it.

use crate::modules::insights::models::ReportCatalogEntry;

/// Every parameter name accepted by `ReportQuery` beyond the mandatory
/// `report_type`/`start_date`/`end_date`.
const RANGE_ONLY: &[&str] = &[];
const CHANNEL: &[&str] = &["booking_channel_id", "booking_channel", "platform_name"];
const SHIFT: &[&str] = &["shift", "drawer"];
const COMPANY: &[&str] = &["company_name"];

pub const CATALOG: &[ReportCatalogEntry] = &[
    ReportCatalogEntry {
        id: "daily_operations",
        title: "Daily Operations",
        category: "operations",
        description: "Arrivals, departures, in-house guests and room status for one business date.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "occupancy",
        title: "Occupancy",
        category: "operations",
        description: "Occupancy rate, ADR and RevPAR over a stay-date range, by room type and day.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "rooms_sold",
        title: "Rooms Sold",
        category: "operations",
        description: "Rooms sold per stay date with rate and revenue detail.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "room_performance",
        title: "Room Performance",
        category: "operations",
        description: "Revenue and occupancy per room and per room type, with underperformers.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "revenue",
        title: "Revenue",
        category: "financial",
        description: "Revenue by room type, source and payment status over a stay-date range.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "channel_net_revenue",
        title: "Channel Net Revenue",
        category: "financial",
        description: "Gross-to-net revenue per booking channel after commission.",
        date_basis: "stay",
        params: CHANNEL,
    },
    ReportCatalogEntry {
        id: "ota_commission",
        title: "OTA Commission",
        category: "financial",
        description: "Alias of Channel Net Revenue — commission owed per OTA.",
        date_basis: "stay",
        params: CHANNEL,
    },
    ReportCatalogEntry {
        id: "ota_monthly_statement",
        title: "OTA Monthly Statement",
        category: "financial",
        description: "Per-OTA statement of bookings, commission and net payout for the period.",
        date_basis: "stay",
        params: CHANNEL,
    },
    ReportCatalogEntry {
        id: "payment_status",
        title: "Payment Status",
        category: "financial",
        description: "Payment-state breakdown and overdue balances.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "shift_report",
        title: "Shift Report",
        category: "operations",
        description: "Movements and room status for one date, optionally narrowed to a shift/drawer.",
        date_basis: "stay",
        params: SHIFT,
    },
    ReportCatalogEntry {
        id: "complimentary",
        title: "Complimentary Nights",
        category: "operations",
        description: "Complimentary and partially-comped stays with the discount given.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "guest_statistics",
        title: "Guest Statistics",
        category: "analytics",
        description: "Unique/new/returning guests, nationality mix and top guests.",
        date_basis: "stay",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "general_journal",
        title: "General Journal",
        category: "accounting",
        description: "Journal entries for the period.",
        date_basis: "accounting",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "journal_by_type",
        title: "Journal by Type",
        category: "accounting",
        description: "Journal entries grouped by transaction type.",
        date_basis: "accounting",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "balance_sheet",
        title: "Balance Sheet",
        category: "accounting",
        description: "Assets, liabilities and equity position for the period.",
        date_basis: "accounting",
        params: RANGE_ONLY,
    },
    ReportCatalogEntry {
        id: "company_ledger_statement",
        title: "Company Ledger Statement",
        category: "accounting",
        description: "Per-company statement with aging buckets; lists companies when unnamed.",
        date_basis: "accounting",
        params: COMPANY,
    },
];

pub fn find(id: &str) -> Option<&'static ReportCatalogEntry> {
    CATALOG.iter().find(|e| e.id == id)
}
