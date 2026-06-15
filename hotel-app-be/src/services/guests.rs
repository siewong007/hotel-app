//! Guest business workflows.

use crate::constants::GuestType;
use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::repositories::guest::GuestRepository;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;
use regex::Regex;

pub async fn list_guests(
    pool: &DbPool,
    user_id: i64,
    params: GuestPaginationParams,
) -> Result<GuestPaginatedResponse, ApiError> {
    let has_guest_access = AuthService::check_permission(pool, user_id, "guests:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "guests:manage")
            .await
            .unwrap_or(false);

    if !has_guest_access {
        return Ok(GuestPaginatedResponse {
            data: vec![],
            total: 0,
            page: 1,
            page_size: 100,
        });
    }

    let pagination = normalize_pagination(params.page, params.page_size, 100, 500);
    let (total, guests) = GuestRepository::find_paginated(pool, &params, pagination).await?;

    Ok(GuestPaginatedResponse {
        data: guests,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn get_guest(pool: &DbPool, guest_id: i64) -> Result<Guest, ApiError> {
    GuestRepository::find_by_id(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))
}

pub async fn guest_profile(pool: &DbPool, guest_id: i64) -> Result<GuestProfile, ApiError> {
    let guest = get_guest(pool, guest_id).await?;
    let summary = GuestRepository::guest_summary(pool, guest_id).await?;
    let reservations = GuestRepository::guest_profile_bookings(pool, guest_id).await?;
    let duplicate_candidates = duplicate_candidates(pool, &guest).await?;

    Ok(GuestProfile {
        guest,
        summary,
        reservations,
        duplicate_candidates,
    })
}

pub async fn create_guest(
    pool: &DbPool,
    user_id: i64,
    input: GuestInput,
) -> Result<Guest, ApiError> {
    if input.first_name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "First name cannot be empty".to_string(),
        ));
    }
    if input.last_name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Last name cannot be empty".to_string(),
        ));
    }

    if let Some(ref email) = input.email
        && !email.trim().is_empty()
        && !email_regex().is_match(email)
    {
        return Err(ApiError::BadRequest("Invalid email format".to_string()));
    }

    let first_name = Sanitizer::sanitize_guest_name(&input.first_name);
    let last_name = Sanitizer::sanitize_guest_name(&input.last_name);
    let email = input
        .email
        .as_deref()
        .filter(|email| !email.trim().is_empty())
        .map(Sanitizer::sanitize_email);
    let full_name = format!("{} {}", first_name, last_name).trim().to_string();

    if GuestRepository::full_name_conflict(pool, &full_name, None).await? {
        return Err(ApiError::BadRequest(format!(
            "A guest with the name '{}' already exists. Please select the existing guest instead of creating a new one.",
            full_name
        )));
    }

    let guest_type = input.guest_type.unwrap_or(GuestType::NonMember);
    let discount_percentage = input.discount_percentage.unwrap_or(0);

    let guest = GuestRepository::create_detailed(
        pool,
        &full_name,
        &first_name,
        &last_name,
        email.as_deref(),
        input.phone.as_deref().map(Sanitizer::sanitize_phone),
        input.ic_number.as_deref().map(Sanitizer::sanitize_text),
        input.nationality.as_deref().map(Sanitizer::sanitize_text),
        input.address_line1.as_deref().map(Sanitizer::sanitize_text),
        input.city.as_deref().map(Sanitizer::sanitize_text),
        input
            .state_province
            .as_deref()
            .map(Sanitizer::sanitize_text),
        input.postal_code.as_deref().map(Sanitizer::sanitize_text),
        input.country.as_deref().map(Sanitizer::sanitize_text),
        &guest_type,
        &input.tourism_type,
        discount_percentage,
        input.company_name.as_deref().map(Sanitizer::sanitize_text),
        user_id,
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "guest_created",
        "guest",
        Some(guest.id),
        Some(serde_json::json!({"name": &guest.full_name, "email": &guest.email})),
        None,
        None,
    )
    .await;

    Ok(guest)
}

pub async fn update_guest(
    pool: &DbPool,
    guest_id: i64,
    input: GuestUpdateInput,
) -> Result<Guest, ApiError> {
    let existing = GuestRepository::update_state(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;

    let first_name = input.first_name.unwrap_or(existing.first_name);
    let last_name = input.last_name.unwrap_or(existing.last_name);
    let email = match input.email {
        Some(ref email) if email.trim().is_empty() => None,
        Some(email) => {
            let trimmed = email.trim().to_string();
            if !email_regex().is_match(&trimmed) {
                return Err(ApiError::BadRequest("Invalid email format".to_string()));
            }
            Some(trimmed)
        }
        None => existing.email,
    };
    let company_name = match input.company_name {
        Some(ref company) if company.trim().is_empty() => None,
        Some(company) => Some(company),
        None => existing.company_name,
    };

    let full_name = format!("{} {}", first_name.trim(), last_name.trim())
        .trim()
        .to_string();

    if GuestRepository::full_name_conflict(pool, &full_name, Some(guest_id)).await? {
        return Err(ApiError::BadRequest(format!(
            "A guest with the name '{}' already exists. Guest names must be unique.",
            full_name
        )));
    }

    let values = GuestUpdateValues {
        full_name,
        first_name,
        last_name,
        email,
        phone: input.phone.or(existing.phone),
        ic_number: input.ic_number.or(existing.ic_number),
        nationality: input.nationality.or(existing.nationality),
        address_line1: input.address_line1.or(existing.address_line1),
        city: input.city.or(existing.city),
        state_province: input.state_province.or(existing.state_province),
        postal_code: input.postal_code.or(existing.postal_code),
        country: input.country.or(existing.country),
        title: input.title.or(existing.title),
        alt_phone: input.alt_phone.or(existing.alt_phone),
        guest_type: input.guest_type.unwrap_or(existing.guest_type),
        tourism_type: input.tourism_type.or(existing.tourism_type),
        discount_percentage: input
            .discount_percentage
            .unwrap_or(existing.discount_percentage),
        company_name,
    };

    let updated_guest = GuestRepository::update_detailed(pool, guest_id, &values).await?;

    let _ = AuditLog::log_event(
        pool,
        None,
        "guest_updated",
        "guest",
        Some(guest_id),
        Some(serde_json::json!({"name": &updated_guest.full_name})),
        None,
        None,
    )
    .await;

    Ok(updated_guest)
}

pub async fn delete_guest(pool: &DbPool, guest_id: i64) -> Result<(), ApiError> {
    if !GuestRepository::exists_any(pool, guest_id).await? {
        return Err(ApiError::NotFound("Guest not found".to_string()));
    }

    if GuestRepository::has_checked_in_booking(pool, guest_id).await? {
        return Err(ApiError::BadRequest(
            "Cannot delete guest who is currently checked in. Please complete the checkout first."
                .to_string(),
        ));
    }

    GuestRepository::hard_delete(pool, guest_id).await?;

    let _ = AuditLog::log_event(
        pool,
        None,
        "guest_deleted",
        "guest",
        Some(guest_id),
        None,
        None,
        None,
    )
    .await;

    Ok(())
}

pub async fn guest_bookings(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Vec<serde_json::Value>, ApiError> {
    Ok(GuestRepository::guest_bookings(pool, guest_id)
        .await?
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id.to_string(),
                "booking_number": row.booking_number,
                "check_in_date": row.check_in_date,
                "check_out_date": row.check_out_date,
                "nights": row.nights,
                "status": row.status,
                "total_amount": row.total_amount.to_string(),
                "created_at": row.created_at,
                "room_number": row.room_number,
                "room_type": row.room_type
            })
        })
        .collect())
}

pub async fn link_guest(
    pool: &DbPool,
    user_id: i64,
    input: LinkGuestInput,
) -> Result<i64, ApiError> {
    if !GuestRepository::exists(pool, input.guest_id).await? {
        return Err(ApiError::NotFound("Guest not found".to_string()));
    }
    let guest_id = input.guest_id;
    GuestRepository::upsert_link(pool, user_id, input).await?;
    Ok(guest_id)
}

pub async fn unlink_guest(pool: &DbPool, user_id: i64, guest_id: i64) -> Result<(), ApiError> {
    if GuestRepository::unlink(pool, user_id, guest_id).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound("Guest link not found".to_string()))
    }
}

pub async fn my_guests(pool: &DbPool, user_id: i64) -> Result<Vec<Guest>, ApiError> {
    GuestRepository::linked_guests(pool, user_id).await
}

pub async fn upgrade_guest_to_user(
    pool: &DbPool,
    user_id: i64,
    input: UpgradeGuestInput,
) -> Result<i64, ApiError> {
    if !GuestRepository::has_modifiable_relationship(pool, user_id, input.guest_id).await? {
        return Err(ApiError::Unauthorized(
            "You don't have permission to upgrade this guest".to_string(),
        ));
    }

    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    GuestRepository::upgrade_guest_to_user(
        pool,
        input.guest_id,
        &input.username,
        &password_hash,
        &input.role.unwrap_or_else(|| "guest".to_string()),
    )
    .await
}

pub async fn guest_credits(
    pool: &DbPool,
    user_id: i64,
    guest_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let has_access = GuestRepository::has_link(pool, user_id, guest_id).await?;
    let has_guest_permission = AuthService::check_permission(pool, user_id, "guests:read")
        .await
        .unwrap_or(false);

    if !has_access && !has_guest_permission {
        return Err(ApiError::Unauthorized(
            "You don't have access to this guest's credits".to_string(),
        ));
    }

    let (guest_id, guest_name) = GuestRepository::guest_info(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;

    let credits_by_room_type: Vec<serde_json::Value> =
        GuestRepository::guest_credits(pool, guest_id)
            .await
            .into_iter()
            .map(|credit| {
                serde_json::json!({
                    "id": credit.id,
                    "guest_id": credit.guest_id,
                    "room_type_id": credit.room_type_id,
                    "room_type_name": credit.room_type_name,
                    "room_type_code": credit.room_type_code,
                    "nights_available": credit.nights_available,
                    "created_at": credit.created_at,
                    "updated_at": credit.updated_at
                })
            })
            .collect();

    let total_nights: i32 = credits_by_room_type
        .iter()
        .map(|credit| credit["nights_available"].as_i64().unwrap_or(0) as i32)
        .sum();
    let legacy_total = GuestRepository::legacy_credit_total(pool, guest_id).await;

    Ok(serde_json::json!({
        "guest_id": guest_id,
        "guest_name": guest_name,
        "total_nights": total_nights,
        "legacy_total_nights": legacy_total,
        "credits_by_room_type": credits_by_room_type
    }))
}

pub async fn my_guests_with_credits(
    pool: &DbPool,
    user_id: i64,
) -> Result<Vec<serde_json::Value>, ApiError> {
    let guests = GuestRepository::linked_guest_credit_rows(pool, user_id).await?;
    let mut result = Vec::new();

    for guest in guests {
        let credits_by_room_type: Vec<serde_json::Value> =
            GuestRepository::room_credits_by_guest(pool, guest.id)
                .await
                .into_iter()
                .map(|credit| {
                    serde_json::json!({
                        "room_type_id": credit.room_type_id,
                        "room_type_name": credit.room_type_name,
                        "room_type_code": credit.room_type_code,
                        "nights_available": credit.nights_available
                    })
                })
                .collect();

        let total_credits: i32 = credits_by_room_type
            .iter()
            .map(|credit| credit["nights_available"].as_i64().unwrap_or(0) as i32)
            .sum();

        result.push(serde_json::json!({
            "id": guest.id,
            "full_name": guest.full_name,
            "email": guest.email,
            "legacy_complimentary_nights_credit": guest.legacy_credits,
            "total_complimentary_credits": total_credits,
            "credits_by_room_type": credits_by_room_type
        }));
    }

    Ok(result)
}

fn email_regex() -> Regex {
    Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap()
}

async fn duplicate_candidates(
    pool: &DbPool,
    guest: &Guest,
) -> Result<Vec<GuestDuplicateCandidate>, ApiError> {
    let normalized_email = guest
        .email
        .as_deref()
        .map(normalize_email)
        .filter(|value| !value.is_empty());
    let phone_digits = guest
        .phone
        .as_deref()
        .map(normalize_phone)
        .filter(|value| !value.is_empty());
    let identity_document = guest
        .ic_number
        .as_deref()
        .map(normalize_identity_document)
        .filter(|value| !value.is_empty());
    let normalized_name = normalize_name(&guest.full_name);
    let name_pattern = duplicate_name_pattern(&normalized_name);

    let candidates = GuestRepository::duplicate_candidate_pool(
        pool,
        guest.id,
        normalized_email.as_deref(),
        phone_digits.as_deref(),
        identity_document.as_deref(),
        &guest.full_name,
        &name_pattern,
    )
    .await?;

    let mut scored: Vec<GuestDuplicateCandidate> = candidates
        .into_iter()
        .filter_map(|candidate| build_duplicate_candidate(guest, candidate))
        .collect();

    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.guest.full_name.cmp(&right.guest.full_name))
    });
    scored.truncate(10);

    Ok(scored)
}

fn build_duplicate_candidate(target: &Guest, candidate: Guest) -> Option<GuestDuplicateCandidate> {
    let mut score = 0;
    let mut match_reasons = Vec::new();
    let mut blocking_reasons = Vec::new();

    let target_phone = target.phone.as_deref().map(normalize_phone);
    let candidate_phone = candidate.phone.as_deref().map(normalize_phone);
    if matches_nonempty(target_phone.as_deref(), candidate_phone.as_deref()) {
        score += 60;
        match_reasons.push("Same normalized phone".to_string());
    }

    let target_email = target.email.as_deref().map(normalize_email);
    let candidate_email = candidate.email.as_deref().map(normalize_email);
    if matches_nonempty(target_email.as_deref(), candidate_email.as_deref()) {
        score += 60;
        match_reasons.push("Same normalized email".to_string());
    }

    let target_identity = target.ic_number.as_deref().map(normalize_identity_document);
    let candidate_identity = candidate
        .ic_number
        .as_deref()
        .map(normalize_identity_document);
    if matches_nonempty(target_identity.as_deref(), candidate_identity.as_deref()) {
        score += 100;
        match_reasons.push("Same identity document".to_string());
    } else if target_identity
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        && candidate_identity
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    {
        blocking_reasons.push("Conflicting identity document".to_string());
    }

    let target_name = normalize_name(&target.full_name);
    let candidate_name = normalize_name(&candidate.full_name);
    if !target_name.is_empty() && target_name == candidate_name {
        score += 25;
        match_reasons.push("Same full name".to_string());
    } else if names_are_similar(&target_name, &candidate_name) {
        score += 10;
        match_reasons.push("Similar name".to_string());
    }

    if score < 25 {
        return None;
    }

    let recommended_action = if !blocking_reasons.is_empty() {
        "do_not_merge".to_string()
    } else if score >= 100 {
        "high_confidence_review".to_string()
    } else if score >= 60 {
        "contact_match_review".to_string()
    } else {
        "manual_review".to_string()
    };

    Some(GuestDuplicateCandidate {
        guest: candidate,
        score,
        match_reasons,
        blocking_reasons,
        recommended_action,
    })
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_phone(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

fn normalize_identity_document(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn normalize_name(value: &str) -> String {
    value
        .split_whitespace()
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}

fn duplicate_name_pattern(normalized_name: &str) -> String {
    let seed = normalized_name
        .split_whitespace()
        .find(|part| part.len() >= 3)
        .unwrap_or(normalized_name);

    format!("%{}%", seed)
}

fn matches_nonempty(left: Option<&str>, right: Option<&str>) -> bool {
    left.zip(right)
        .is_some_and(|(left, right)| !left.is_empty() && left == right)
}

fn names_are_similar(left: &str, right: &str) -> bool {
    if left.is_empty() || right.is_empty() || left == right {
        return false;
    }

    let left_parts: Vec<&str> = left.split_whitespace().collect();
    let right_parts: Vec<&str> = right.split_whitespace().collect();

    match (
        left_parts.first(),
        left_parts.last(),
        right_parts.first(),
        right_parts.last(),
    ) {
        (Some(left_first), Some(left_last), Some(right_first), Some(right_last)) => {
            left_last == right_last
                && left_first
                    .chars()
                    .next()
                    .zip(right_first.chars().next())
                    .is_some_and(|(left_char, right_char)| left_char == right_char)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::GuestType;
    use chrono::Utc;

    fn guest(
        id: i64,
        full_name: &str,
        email: Option<&str>,
        phone: Option<&str>,
        ic_number: Option<&str>,
    ) -> Guest {
        Guest {
            id,
            full_name: full_name.to_string(),
            email: email.map(str::to_string),
            phone: phone.map(str::to_string),
            ic_number: ic_number.map(str::to_string),
            nationality: None,
            address_line1: None,
            city: None,
            state_province: None,
            postal_code: None,
            country: None,
            title: None,
            alt_phone: None,
            is_active: true,
            guest_type: GuestType::NonMember,
            tourism_type: None,
            discount_percentage: 0,
            company_name: None,
            complimentary_nights_credit: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            bookings_count: None,
            last_stay_date: None,
        }
    }

    #[test]
    fn duplicate_score_normalizes_email_phone_and_identity_document() {
        let target = guest(
            1,
            "Davina Wong",
            Some("DAVINA@EMAIL.COM"),
            Some("+60 12-345 6789"),
            Some("A-123"),
        );
        let candidate = guest(
            2,
            "Davina Wong",
            Some("davina@email.com"),
            Some("60123456789"),
            Some("A123"),
        );

        let candidate = build_duplicate_candidate(&target, candidate).expect("candidate");

        assert_eq!(candidate.score, 245);
        assert_eq!(
            candidate.match_reasons,
            vec![
                "Same normalized phone",
                "Same normalized email",
                "Same identity document",
                "Same full name"
            ]
        );
        assert_eq!(candidate.recommended_action, "high_confidence_review");
    }

    #[test]
    fn similar_name_alone_is_not_enough_for_duplicate_review() {
        let target = guest(1, "Davina Wong", None, None, None);
        let candidate = guest(2, "D Wong", None, None, None);

        assert!(build_duplicate_candidate(&target, candidate).is_none());
    }

    #[test]
    fn conflicting_identity_document_blocks_merge_recommendation() {
        let target = guest(
            1,
            "Davina Wong",
            None,
            Some("+60 12-345 6789"),
            Some("A123"),
        );
        let candidate = guest(2, "Davina Wong", None, Some("60123456789"), Some("B999"));

        let candidate = build_duplicate_candidate(&target, candidate).expect("candidate");

        assert_eq!(candidate.recommended_action, "do_not_merge");
        assert_eq!(
            candidate.blocking_reasons,
            vec!["Conflicting identity document"]
        );
    }
}
