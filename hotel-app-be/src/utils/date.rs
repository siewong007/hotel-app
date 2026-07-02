//! Date parsing helpers shared by handlers and services.

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

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

/// Parse a user-supplied checkout/checkin timestamp into a `NaiveDateTime`.
///
/// Accepts several shapes emitted by HTML inputs and API clients:
/// - date-only (`YYYY-MM-DD`) — time defaults to 12:00:00 (noon) so that
///   timezone conversions on display never roll the date to an adjacent day;
/// - `datetime-local` (`YYYY-MM-DDTHH:MM` / `...:SS`);
/// - RFC3339 / ISO-8601 with offset (`YYYY-MM-DDTHH:MM:SS+08:00`) — the offset
///   is dropped and the wall-clock portion is kept.
pub fn parse_datetime_flexible(value: &str) -> Result<NaiveDateTime, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Empty timestamp".to_string());
    }

    // Full RFC3339 with offset (e.g. produced by JS toISOString / +08:00).
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Ok(dt.naive_local());
    }

    if value.contains('T') || value.contains(' ') {
        let normalized = value.replace(' ', "T");
        for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
            if let Ok(dt) = NaiveDateTime::parse_from_str(&normalized, fmt) {
                return Ok(dt);
            }
        }
        // Timestamp-like but with an unparsed tail — fall back to the date part.
        if let Some(date_part) = normalized.split('T').next()
            && let Ok(date) = NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
        {
            return Ok(date.and_hms_opt(12, 0, 0).unwrap());
        }
        return Err(format!("Invalid timestamp format: {}", value));
    }

    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|d| d.and_time(NaiveTime::from_hms_opt(12, 0, 0).unwrap()))
        .map_err(|e| format!("Invalid timestamp format: {}", e))
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

    #[test]
    fn parse_datetime_flexible_defaults_date_only_to_noon() {
        let parsed = parse_datetime_flexible("2026-06-27").expect("date should parse");

        assert_eq!(
            parsed,
            NaiveDate::from_ymd_opt(2026, 6, 27)
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap()
        );
    }

    #[test]
    fn parse_datetime_flexible_accepts_datetime_local() {
        let parsed = parse_datetime_flexible("2026-06-27T09:30").expect("datetime should parse");

        assert_eq!(
            parsed,
            NaiveDate::from_ymd_opt(2026, 6, 27)
                .unwrap()
                .and_hms_opt(9, 30, 0)
                .unwrap()
        );
    }

    #[test]
    fn parse_datetime_flexible_accepts_rfc3339_with_offset() {
        let parsed =
            parse_datetime_flexible("2026-06-27T14:30:00+08:00").expect("rfc3339 should parse");

        assert_eq!(
            parsed,
            NaiveDate::from_ymd_opt(2026, 6, 27)
                .unwrap()
                .and_hms_opt(14, 30, 0)
                .unwrap()
        );
    }

    #[test]
    fn parse_datetime_flexible_rejects_invalid_values() {
        let error = parse_datetime_flexible("not-a-date").expect_err("invalid value should fail");

        assert!(error.starts_with("Invalid timestamp format:"));
    }
}
