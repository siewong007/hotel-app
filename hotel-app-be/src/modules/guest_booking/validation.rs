use chrono::{NaiveDate, Utc};

use crate::core::error::ApiError;

pub const MAX_BOOKING_NIGHTS: i64 = 30;

#[derive(Debug, Clone, Copy)]
pub struct ValidatedStay {
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
}

pub fn validate_stay(
    check_in_date: &str,
    check_out_date: &str,
    adults: Option<i32>,
    children: Option<i32>,
) -> Result<ValidatedStay, ApiError> {
    let check_in_date = NaiveDate::parse_from_str(check_in_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-in date. Use YYYY-MM-DD".to_string()))?;
    let check_out_date = NaiveDate::parse_from_str(check_out_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-out date. Use YYYY-MM-DD".to_string()))?;
    let today = Utc::now().date_naive();
    if check_in_date < today {
        return Err(ApiError::BadRequest(
            "Check-in date cannot be in the past".to_string(),
        ));
    }
    let nights = (check_out_date - check_in_date).num_days();
    if nights < 1 {
        return Err(ApiError::BadRequest(
            "Check-out date must be after check-in date".to_string(),
        ));
    }
    if nights > MAX_BOOKING_NIGHTS {
        return Err(ApiError::BadRequest(format!(
            "A portal booking cannot exceed {MAX_BOOKING_NIGHTS} nights"
        )));
    }
    let adults = adults.unwrap_or(1);
    let children = children.unwrap_or(0);
    if !(1..=20).contains(&adults) || !(0..=20).contains(&children) {
        return Err(ApiError::BadRequest("Invalid guest occupancy".to_string()));
    }
    Ok(ValidatedStay {
        check_in_date,
        check_out_date,
        adults,
        children,
    })
}

pub fn validate_client_request_id(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 128 {
        return Err(ApiError::BadRequest(
            "Invalid client request identifier".to_string(),
        ));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_night_stay() {
        let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
        assert!(validate_stay(&today, &today, Some(1), Some(0)).is_err());
    }

    #[test]
    fn validates_occupancy() {
        let check_in = Utc::now().date_naive() + chrono::Duration::days(1);
        let check_out = check_in + chrono::Duration::days(2);
        let stay = validate_stay(
            &check_in.format("%Y-%m-%d").to_string(),
            &check_out.format("%Y-%m-%d").to_string(),
            Some(2),
            Some(1),
        )
        .unwrap();
        assert_eq!(stay.adults + stay.children, 3);
    }
}
