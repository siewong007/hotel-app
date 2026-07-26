use chrono::{Months, NaiveDate};
use sqlx::query_scalar;

use crate::core::db::DbPool;
use crate::core::error::ApiError;

pub const MAX_BOOKING_NIGHTS: i64 = 30;
pub const MAX_ADVANCE_BOOKING_MONTHS: u32 = 3;

#[derive(Debug, Clone, Copy)]
pub struct ValidatedStay {
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
}

pub async fn validate_stay(
    pool: &DbPool,
    check_in_date: &str,
    check_out_date: &str,
    adults: Option<i32>,
    children: Option<i32>,
) -> Result<ValidatedStay, ApiError> {
    // PostgreSQL connections are configured with the hotel's timezone, so
    // CURRENT_DATE is the local hotel date rather than the API host's UTC date.
    let today: NaiveDate = query_scalar(&format!(
        "SELECT {}",
        crate::core::sql_compat::current_date()
    ))
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;
    validate_stay_for_today(check_in_date, check_out_date, adults, children, today)
}

fn validate_stay_for_today(
    check_in_date: &str,
    check_out_date: &str,
    adults: Option<i32>,
    children: Option<i32>,
    today: NaiveDate,
) -> Result<ValidatedStay, ApiError> {
    let check_in_date = NaiveDate::parse_from_str(check_in_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-in date. Use YYYY-MM-DD".to_string()))?;
    let check_out_date = NaiveDate::parse_from_str(check_out_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-out date. Use YYYY-MM-DD".to_string()))?;
    if check_in_date < today {
        return Err(ApiError::BadRequest(
            "Check-in date cannot be in the past".to_string(),
        ));
    }
    let latest_check_in = today
        .checked_add_months(Months::new(MAX_ADVANCE_BOOKING_MONTHS))
        .expect("three calendar months must be representable");
    if check_in_date > latest_check_in {
        return Err(ApiError::BadRequest(format!(
            "Bookings can only be made up to {MAX_ADVANCE_BOOKING_MONTHS} months in advance"
        )));
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

/// Parse the nights a guest asked to fund with complimentary credits.
///
/// Returns them sorted and de-duplicated. Every date must fall inside the stay
/// (`check_in <= date < check_out`) — a comped night is a night actually being
/// stayed, so check-out day is never eligible.
pub fn validate_complimentary_dates(
    values: Option<&[String]>,
    stay: ValidatedStay,
) -> Result<Vec<NaiveDate>, ApiError> {
    let Some(values) = values else {
        return Ok(Vec::new());
    };
    let mut dates: Vec<NaiveDate> = Vec::with_capacity(values.len());
    for value in values {
        let date = NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").map_err(|_| {
            ApiError::BadRequest(format!("Invalid complimentary night date: {value}"))
        })?;
        if date < stay.check_in_date || date >= stay.check_out_date {
            return Err(ApiError::BadRequest(format!(
                "{date} is not a night of this stay ({} to {})",
                stay.check_in_date, stay.check_out_date
            )));
        }
        if !dates.contains(&date) {
            dates.push(date);
        }
    }
    dates.sort_unstable();
    Ok(dates)
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
        let today = NaiveDate::from_ymd_opt(2026, 7, 17).unwrap();
        assert!(
            validate_stay_for_today(
                &today.to_string(),
                &today.to_string(),
                Some(1),
                Some(0),
                today
            )
            .is_err()
        );
    }

    #[test]
    fn validates_occupancy() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 17).unwrap();
        let check_in = today + chrono::Duration::days(1);
        let check_out = check_in + chrono::Duration::days(2);
        let stay = validate_stay_for_today(
            &check_in.format("%Y-%m-%d").to_string(),
            &check_out.format("%Y-%m-%d").to_string(),
            Some(2),
            Some(1),
            today,
        )
        .unwrap();
        assert_eq!(stay.adults + stay.children, 3);
    }

    fn three_night_stay() -> ValidatedStay {
        ValidatedStay {
            check_in_date: NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2026, 8, 13).unwrap(),
            adults: 1,
            children: 0,
        }
    }

    #[test]
    fn complimentary_dates_are_sorted_and_deduplicated() {
        let dates = validate_complimentary_dates(
            Some(&[
                "2026-08-12".to_string(),
                "2026-08-10".to_string(),
                "2026-08-12".to_string(),
            ]),
            three_night_stay(),
        )
        .unwrap();
        assert_eq!(
            dates,
            vec![
                NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
                NaiveDate::from_ymd_opt(2026, 8, 12).unwrap(),
            ]
        );
    }

    #[test]
    fn checkout_day_is_not_a_night_of_the_stay() {
        assert!(
            validate_complimentary_dates(Some(&["2026-08-13".to_string()]), three_night_stay())
                .is_err()
        );
    }

    #[test]
    fn complimentary_dates_outside_the_stay_are_rejected() {
        assert!(
            validate_complimentary_dates(Some(&["2026-08-09".to_string()]), three_night_stay())
                .is_err()
        );
    }

    #[test]
    fn no_complimentary_selection_yields_no_dates() {
        assert!(
            validate_complimentary_dates(None, three_night_stay())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_stays_more_than_three_calendar_months_ahead() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 17).unwrap();
        let check_in =
            today.checked_add_months(Months::new(3)).unwrap() + chrono::Duration::days(1);
        let check_out = check_in + chrono::Duration::days(1);
        assert!(
            validate_stay_for_today(
                &check_in.to_string(),
                &check_out.to_string(),
                None,
                None,
                today
            )
            .is_err()
        );
    }
}
