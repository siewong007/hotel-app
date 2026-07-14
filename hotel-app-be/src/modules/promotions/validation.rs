use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;

use super::models::PromotionInput;
use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;

pub const PROMOTION_STATUSES: &[&str] = &["draft", "published", "paused", "archived"];
pub const PROMOTION_KINDS: &[&str] = &["deal", "voucher"];
pub const DISCOUNT_TYPES: &[&str] = &["percentage", "fixed_amount"];
pub const VOUCHER_STATUSES: &[&str] = &["available", "redeemed", "revoked"];

#[derive(Debug, Clone)]
pub struct PromotionDraft {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub terms: Option<String>,
    pub promotion_kind: String,
    pub discount_type: String,
    pub discount_value: Decimal,
    pub max_discount_amount: Option<Decimal>,
    pub currency: String,
    pub claim_starts_at: Option<DateTime<Utc>>,
    pub claim_ends_at: Option<DateTime<Utc>>,
    pub stay_starts_on: Option<NaiveDate>,
    pub stay_ends_on: Option<NaiveDate>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_subtotal: Option<Decimal>,
    pub claim_limit: Option<i64>,
    pub per_guest_limit: i32,
    pub is_public: bool,
    pub room_type_ids: Vec<i64>,
}

pub fn normalized_choice(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

pub fn validate_status(value: &str) -> Result<String, ApiError> {
    let value = normalized_choice(value);
    if PROMOTION_STATUSES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::BadRequest(
            "Unsupported promotion status".to_string(),
        ))
    }
}

pub fn validate_voucher_status(value: &str) -> Result<String, ApiError> {
    let value = normalized_choice(value);
    if VOUCHER_STATUSES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::BadRequest(
            "Unsupported voucher status".to_string(),
        ))
    }
}

fn sanitize_required_text(
    value: &str,
    field: &str,
    min: usize,
    max: usize,
) -> Result<String, ApiError> {
    let value = Sanitizer::sanitize_notes(value).trim().to_string();
    let len = value.chars().count();
    if len < min || len > max {
        return Err(ApiError::BadRequest(format!(
            "{field} must be between {min} and {max} characters"
        )));
    }
    Ok(value)
}

fn sanitize_optional_text(
    value: Option<String>,
    field: &str,
    max: usize,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = Sanitizer::sanitize_notes(&value).trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max {
        return Err(ApiError::BadRequest(format!(
            "{field} cannot exceed {max} characters"
        )));
    }
    Ok(Some(value))
}

pub fn normalize_slug(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    let value = value.trim_matches('-');
    if value.len() < 3
        || value.len() > 80
        || !value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err(ApiError::BadRequest(
            "Promotion slug must use 3-80 lowercase letters, numbers, or hyphens".to_string(),
        ));
    }
    Ok(value.to_string())
}

pub fn normalize_voucher_code(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_uppercase().replace([' ', '-'], "");
    if value.len() < 8
        || value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err(ApiError::BadRequest(
            "Voucher code must use 8-64 letters or numbers".to_string(),
        ));
    }
    Ok(value)
}

fn decimal_from_f64(value: f64, field: &str) -> Result<Decimal, ApiError> {
    if !value.is_finite() {
        return Err(ApiError::BadRequest(format!(
            "{field} must be a finite number"
        )));
    }
    value
        .to_string()
        .parse::<Decimal>()
        .map_err(|_| ApiError::BadRequest(format!("Invalid {field}")))
}

pub fn validate_promotion_input(input: PromotionInput) -> Result<PromotionDraft, ApiError> {
    let promotion_kind = normalized_choice(&input.promotion_kind);
    if !PROMOTION_KINDS.contains(&promotion_kind.as_str()) {
        return Err(ApiError::BadRequest(
            "Unsupported promotion kind".to_string(),
        ));
    }
    let discount_type = normalized_choice(&input.discount_type);
    if !DISCOUNT_TYPES.contains(&discount_type.as_str()) {
        return Err(ApiError::BadRequest(
            "Unsupported discount type".to_string(),
        ));
    }
    let discount_value = decimal_from_f64(input.discount_value, "discount value")?;
    if discount_value <= Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Discount value must be greater than zero".to_string(),
        ));
    }
    if discount_type == "percentage" && discount_value > Decimal::new(100, 0) {
        return Err(ApiError::BadRequest(
            "Percentage discounts cannot exceed 100".to_string(),
        ));
    }
    let max_discount_amount = input
        .max_discount_amount
        .map(|value| decimal_from_f64(value, "maximum discount"))
        .transpose()?;
    if max_discount_amount.is_some_and(|value| value <= Decimal::ZERO) {
        return Err(ApiError::BadRequest(
            "Maximum discount must be greater than zero".to_string(),
        ));
    }
    if discount_type == "fixed_amount" && max_discount_amount.is_some() {
        return Err(ApiError::BadRequest(
            "A maximum discount is only available for percentage promotions".to_string(),
        ));
    }
    let min_subtotal = input
        .min_subtotal
        .map(|value| decimal_from_f64(value, "minimum subtotal"))
        .transpose()?;
    if min_subtotal.is_some_and(|value| value < Decimal::ZERO) {
        return Err(ApiError::BadRequest(
            "Minimum subtotal cannot be negative".to_string(),
        ));
    }
    if input.min_nights.is_some_and(|value| value < 1)
        || input.max_nights.is_some_and(|value| value < 1)
        || input
            .min_nights
            .zip(input.max_nights)
            .is_some_and(|(min, max)| min > max)
    {
        return Err(ApiError::BadRequest(
            "Invalid minimum or maximum stay length".to_string(),
        ));
    }
    if input.claim_limit.is_some_and(|value| value < 0) {
        return Err(ApiError::BadRequest(
            "Claim limit cannot be negative".to_string(),
        ));
    }
    let per_guest_limit = input.per_guest_limit.unwrap_or(1);
    if per_guest_limit < 1 {
        return Err(ApiError::BadRequest(
            "Per-guest limit must be at least one".to_string(),
        ));
    }
    if input
        .claim_starts_at
        .zip(input.claim_ends_at)
        .is_some_and(|(start, end)| start >= end)
        || input
            .stay_starts_on
            .zip(input.stay_ends_on)
            .is_some_and(|(start, end)| start > end)
    {
        return Err(ApiError::BadRequest(
            "Promotion date windows are invalid".to_string(),
        ));
    }
    let currency = input.currency.unwrap_or_else(|| "USD".to_string());
    let currency = currency.trim().to_ascii_uppercase();
    if currency.len() != 3
        || !currency
            .chars()
            .all(|character| character.is_ascii_uppercase())
    {
        return Err(ApiError::BadRequest(
            "Currency must be a three-letter ISO code".to_string(),
        ));
    }
    let mut room_type_ids = input.room_type_ids.unwrap_or_default();
    if room_type_ids.iter().any(|id| *id <= 0) {
        return Err(ApiError::BadRequest("Invalid room type target".to_string()));
    }
    room_type_ids.sort_unstable();
    room_type_ids.dedup();

    Ok(PromotionDraft {
        slug: normalize_slug(&input.slug)?,
        name: sanitize_required_text(&input.name, "Promotion name", 2, 160)?,
        description: sanitize_optional_text(input.description, "Promotion description", 2_000)?,
        terms: sanitize_optional_text(input.terms, "Promotion terms", 4_000)?,
        promotion_kind,
        discount_type,
        discount_value,
        max_discount_amount,
        currency,
        claim_starts_at: input.claim_starts_at,
        claim_ends_at: input.claim_ends_at,
        stay_starts_on: input.stay_starts_on,
        stay_ends_on: input.stay_ends_on,
        min_nights: input.min_nights,
        max_nights: input.max_nights,
        min_subtotal,
        claim_limit: input.claim_limit,
        per_guest_limit,
        is_public: input.is_public.unwrap_or(false),
        room_type_ids,
    })
}

pub fn sanitize_optional_reason(value: Option<String>) -> Result<Option<String>, ApiError> {
    sanitize_optional_text(value, "Reason", 1_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_voucher_codes_without_preserving_separators() {
        assert_eq!(
            normalize_voucher_code(" vch-ab12 34cd ").unwrap(),
            "VCHAB1234CD"
        );
    }

    #[test]
    fn rejects_percentage_above_one_hundred() {
        let input = PromotionInput {
            slug: "welcome-deal".to_string(),
            name: "Welcome deal".to_string(),
            description: None,
            terms: None,
            promotion_kind: "voucher".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: 100.01,
            max_discount_amount: None,
            currency: Some("USD".to_string()),
            claim_starts_at: None,
            claim_ends_at: None,
            stay_starts_on: None,
            stay_ends_on: None,
            min_nights: None,
            max_nights: None,
            min_subtotal: None,
            claim_limit: None,
            per_guest_limit: None,
            is_public: None,
            room_type_ids: None,
            expected_version: None,
        };
        assert!(validate_promotion_input(input).is_err());
    }
}
