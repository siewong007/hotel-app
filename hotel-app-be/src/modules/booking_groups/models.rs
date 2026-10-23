use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;

/// Lifecycle of the group row itself. A group is `voided` once every member
/// booking is voided; a partially cancelled group stays `active`.
pub const GROUP_STATUS_ACTIVE: &str = "active";
pub const GROUP_STATUS_VOIDED: &str = "voided";

/// Input for [`super::repository::BookingGroupRepository::create_tx`].
#[derive(Debug, Clone)]
pub struct NewBookingGroup {
    pub guest_id: i64,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub source: String,
    pub currency: String,
    pub voucher_id: Option<i64>,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub portal_request_id: Option<String>,
    pub created_by: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookingGroup {
    pub id: i64,
    pub uuid: String,
    pub group_number: String,
    pub guest_id: i64,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub source: String,
    pub status: String,
    pub payment_status: String,
    pub payment_method: Option<String>,
    pub room_count: i32,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub tourism_tax_amount: Decimal,
    pub total_amount: Decimal,
    pub currency: String,
    pub voucher_id: Option<i64>,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One room of a group, as the group views it.
#[derive(Debug, Clone, Serialize)]
pub struct BookingGroupMember {
    pub booking_id: i64,
    pub booking_number: String,
    pub room_id: i64,
    pub room_number: Option<String>,
    pub room_type_id: Option<i64>,
    pub room_type_name: Option<String>,
    pub adults: i32,
    pub children: i32,
    pub extra_bed_count: i32,
    pub status: String,
    pub payment_status: String,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub tourism_tax_amount: Decimal,
    pub total_amount: Decimal,
}

/// Collapse member payment statuses into the group's: all equal → that
/// status; any paid/partial mix → `partial`; otherwise the first non-void.
/// Voided/void members are ignored (a cancelled room no longer owes).
pub fn derive_group_payment_status<'a>(statuses: impl IntoIterator<Item = &'a str>) -> String {
    let live: Vec<&str> = statuses
        .into_iter()
        .filter(|status| *status != "void")
        .collect();
    let Some(first) = live.first() else {
        return "void".to_string();
    };
    if live.iter().all(|status| status == first) {
        return (*first).to_string();
    }
    let settled = |status: &&str| matches!(*status, "paid" | "paid_rate" | "partial");
    if live.iter().any(settled) {
        return "partial".to_string();
    }
    (*first).to_string()
}

#[cfg(test)]
mod tests {
    use super::derive_group_payment_status;

    #[test]
    fn group_payment_status_follows_live_members() {
        assert_eq!(derive_group_payment_status(["paid", "paid"]), "paid");
        assert_eq!(derive_group_payment_status(["paid", "unpaid"]), "partial");
        assert_eq!(derive_group_payment_status(["unpaid", "void"]), "unpaid");
        assert_eq!(derive_group_payment_status(["void", "void"]), "void");
        assert_eq!(derive_group_payment_status(["refunded", "paid"]), "partial");
        assert_eq!(
            derive_group_payment_status(["unpaid", "unpaid_deposit"]),
            "unpaid"
        );
    }
}
