//! Check-in advisory.
//!
//! Flags the case where a guest who has used company / city-ledger billing
//! before is about to be checked in as a normal (non-company) guest — the
//! mistake behind orphaned guest folios like booking #1094, where the company
//! was typed as the guest name but no billing company was attached. The
//! front-desk UI calls this so the operator can confirm whether the stay should
//! be a company check-in instead of creating an uncollectable guest balance.
//!
//! Two entry points share one core:
//! - [`checkin_advisory`] — for an existing booking (check-in of a reservation).
//! - [`checkin_advisory_for_guest`] — for a guest before any booking exists
//!   (the walk-in / direct-booking dialog), keyed purely on guest history.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::services::booking::fetch_booking_by_id;
use sqlx::Row;

/// Sentinel booking id that excludes nothing (no real booking has id -1), so the
/// guest-history query can be shared between the booking and bare-guest paths.
const EXCLUDE_NONE: i64 = -1;

/// Result of the check-in advisory check. `needs_attention == false` means the
/// booking looks normal and the UI should not interrupt the operator.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CheckInAdvisory {
    pub needs_attention: bool,
    /// Machine-readable reason code (currently only `confirm_company_checkin`).
    pub reason: Option<String>,
    /// Human-readable prompt for the front desk.
    pub message: Option<String>,
    pub prior_total_bookings: i64,
    pub prior_company_bookings: i64,
    pub suggested_company_id: Option<i64>,
    pub suggested_company_name: Option<String>,
}

impl CheckInAdvisory {
    fn clear() -> Self {
        Self {
            needs_attention: false,
            reason: None,
            message: None,
            prior_total_bookings: 0,
            prior_company_bookings: 0,
            suggested_company_id: None,
            suggested_company_name: None,
        }
    }
}

/// Decide whether to prompt the operator to confirm company billing. We flag as
/// soon as the guest has *any* prior company-billed stay (`company_count >= 1`):
/// once a guest has been company-billed before, every later check-in should
/// confirm whether it is company billing again, rather than silently defaulting
/// to a normal guest folio.
fn has_prior_company_billing(_total: i64, company_count: i64) -> bool {
    company_count > 0
}

/// Check-in advisory for an existing booking. Returns a clear advisory if the
/// booking already has company billing attached.
pub async fn checkin_advisory(pool: &DbPool, booking_id: i64) -> Result<CheckInAdvisory, ApiError> {
    let booking = fetch_booking_by_id(pool, booking_id).await?;

    // Already company-billed → nothing to confirm.
    let has_company = booking.company_id.is_some()
        || booking
            .company_name
            .as_deref()
            .map(|n| !n.trim().is_empty())
            .unwrap_or(false);
    if has_company {
        return Ok(CheckInAdvisory::clear());
    }

    build_guest_advisory(pool, booking.guest_id, booking_id).await
}

/// Check-in advisory for a guest before a booking exists (walk-in / direct
/// booking). Keyed purely on the guest's prior company-billing history.
pub async fn checkin_advisory_for_guest(
    pool: &DbPool,
    guest_id: i64,
) -> Result<CheckInAdvisory, ApiError> {
    build_guest_advisory(pool, guest_id, EXCLUDE_NONE).await
}

/// Shared core: tally the guest's prior (non-voided) bookings and, if any were
/// company-billed, build a "confirm company check-in" advisory suggesting the
/// company they most often bill to. `exclude_booking_id` removes the current
/// booking from the tally (pass [`EXCLUDE_NONE`] when there is no booking yet).
async fn build_guest_advisory(
    pool: &DbPool,
    guest_id: i64,
    exclude_booking_id: i64,
) -> Result<CheckInAdvisory, ApiError> {
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let totals_sql = "SELECT COUNT(*) AS total, COUNT(company_id) AS company_count \
         FROM bookings WHERE guest_id = $1 AND id <> $2 AND status <> 'voided'";
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let totals_sql = "SELECT COUNT(*) AS total, COUNT(company_id) AS company_count \
         FROM bookings WHERE guest_id = ?1 AND id <> ?2 AND status <> 'voided'";

    let row = sqlx::query(totals_sql)
        .bind(guest_id)
        .bind(exclude_booking_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let prior_total: i64 = row.try_get("total").unwrap_or(0);
    let prior_company: i64 = row.try_get("company_count").unwrap_or(0);

    if !has_prior_company_billing(prior_total, prior_company) {
        let mut advisory = CheckInAdvisory::clear();
        advisory.prior_total_bookings = prior_total;
        advisory.prior_company_bookings = prior_company;
        return Ok(advisory);
    }

    // Suggest the company they most often bill to.
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let suggest_sql = "SELECT company_id, company_name, COUNT(*) AS c \
         FROM bookings WHERE guest_id = $1 AND id <> $2 AND status <> 'voided' \
         AND company_id IS NOT NULL \
         GROUP BY company_id, company_name ORDER BY c DESC, MAX(created_at) DESC LIMIT 1";
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let suggest_sql = "SELECT company_id, company_name, COUNT(*) AS c \
         FROM bookings WHERE guest_id = ?1 AND id <> ?2 AND status <> 'voided' \
         AND company_id IS NOT NULL \
         GROUP BY company_id, company_name ORDER BY c DESC, MAX(created_at) DESC LIMIT 1";

    let suggestion = sqlx::query(suggest_sql)
        .bind(guest_id)
        .bind(exclude_booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let (suggested_company_id, suggested_company_name) = match suggestion {
        Some(r) => (
            r.try_get::<Option<i64>, _>("company_id").unwrap_or(None),
            r.try_get::<Option<String>, _>("company_name").unwrap_or(None),
        ),
        None => (None, None),
    };

    let company_label = suggested_company_name
        .clone()
        .unwrap_or_else(|| "a company account".to_string());
    let stay_word = if prior_company == 1 { "stay" } else { "stays" };
    let message = format!(
        "This guest has used company check-in before ({} of {} past {} billed to {}), \
         but no company is attached. Do you want to use company check-in for this stay?",
        prior_company, prior_total, stay_word, company_label
    );

    Ok(CheckInAdvisory {
        needs_attention: true,
        reason: Some("confirm_company_checkin".to_string()),
        message: Some(message),
        prior_total_bookings: prior_total,
        prior_company_bookings: prior_company,
        suggested_company_id,
        suggested_company_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_guest_with_any_prior_company_billing() {
        assert!(has_prior_company_billing(4, 4)); // always company
        assert!(has_prior_company_billing(4, 1)); // company used once before
        assert!(has_prior_company_billing(1, 1));
    }

    #[test]
    fn does_not_flag_guests_who_never_used_company_billing() {
        assert!(!has_prior_company_billing(0, 0)); // brand-new guest
        assert!(!has_prior_company_billing(3, 0)); // never company-billed
    }
}
