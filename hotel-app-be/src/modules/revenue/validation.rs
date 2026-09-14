use chrono::NaiveDate;

use crate::core::error::ApiError;

/// Resolved stay-date window. `to` is the last counted night (inclusive);
/// callers translating to an exclusive SQL bound add one day.
pub struct RevenueRange {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// Keep aggregate scans bounded; a year of stay nights is the widest window
/// the dashboard needs.
const MAX_RANGE_DAYS: i64 = 366;

pub fn revenue_range(from: &str, to: &str) -> Result<RevenueRange, ApiError> {
    let parse = |value: &str, label: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest(format!("{label} must be a YYYY-MM-DD date")))
    };
    let (from, to) = (parse(from, "from")?, parse(to, "to")?);
    if from > to {
        return Err(ApiError::BadRequest(
            "'from' must not be after 'to'".to_string(),
        ));
    }
    if (to - from).num_days() + 1 > MAX_RANGE_DAYS {
        return Err(ApiError::BadRequest(
            "Date range cannot exceed 366 days".to_string(),
        ));
    }
    Ok(RevenueRange { from, to })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_rejects_inverted_bounds() {
        assert!(revenue_range("2026-10-02", "2026-10-01").is_err());
    }

    #[test]
    fn range_rejects_malformed_dates() {
        assert!(revenue_range("10/01/2026", "2026-10-02").is_err());
        assert!(revenue_range("2026-10-01", "").is_err());
    }

    #[test]
    fn range_accepts_single_day_and_year_spans() {
        assert!(revenue_range("2026-10-01", "2026-10-01").is_ok());
        assert!(revenue_range("2026-01-01", "2027-01-01").is_ok());
    }

    #[test]
    fn range_rejects_span_over_366_days() {
        assert!(revenue_range("2026-01-01", "2027-01-02").is_err());
    }
}
