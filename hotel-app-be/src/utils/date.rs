//! Date parsing helpers shared by handlers and services.

use chrono::NaiveDate;

/// Parse either a date-only value (`YYYY-MM-DD`) or a timestamp-like value
/// whose date portion appears before `T`.
pub fn parse_date_flexible(date_str: &str) -> Result<NaiveDate, String> {
    if date_str.contains('T') {
        let date_part = date_str.split('T').next().unwrap_or(date_str);
        NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    } else {
        NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_flexible_accepts_date_only_values() {
        let parsed = parse_date_flexible("2026-05-26").expect("date should parse");

        assert_eq!(parsed, NaiveDate::from_ymd_opt(2026, 5, 26).unwrap());
    }

    #[test]
    fn parse_date_flexible_accepts_timestamp_values_by_date_part() {
        let parsed =
            parse_date_flexible("2026-05-26T14:30:00+08:00").expect("timestamp should parse");

        assert_eq!(parsed, NaiveDate::from_ymd_opt(2026, 5, 26).unwrap());
    }

    #[test]
    fn parse_date_flexible_rejects_invalid_values() {
        let error = parse_date_flexible("26-05-2026").expect_err("invalid date should fail");

        assert!(error.starts_with("Invalid date format:"));
    }
}
