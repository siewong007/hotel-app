//! Business rules for promotion publishing, claims, and voucher management.

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use super::models::{
    ClaimPromotionInput, GuestPromotion, GuestPromotionListResponse, Promotion, PromotionInput,
    PromotionListQuery, PromotionListResponse, PublicPromotion, PublicPromotionListResponse,
    Voucher, VoucherIssueInput, VoucherListResponse, VoucherRevokeInput,
};
use super::repository::PromotionRepository;
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::loyalty::models::RedeemRewardInput;
use crate::modules::loyalty::repository::LoyaltyRepository;
use crate::modules::loyalty::service as loyalty_service;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;

/// System-managed campaign used when a guest portal account is activated.
pub const WELCOME_DELUXE_PROMOTION_SLUG: &str = "welcome-deluxe-10";
pub const JULY_DELUXE_LOYALTY_PROMOTION_SLUG: &str = "july-deluxe-20-loyalty";
const JULY_DELUXE_LOYALTY_REWARD_NAME: &str = "July Deluxe Room 20% Voucher";

fn request_id_is_valid(value: Option<&str>) -> Result<(), ApiError> {
    if value.is_some_and(|value| value.trim().is_empty() || value.chars().count() > 128) {
        return Err(ApiError::BadRequest(
            "Invalid client request identifier".to_string(),
        ));
    }
    Ok(())
}

fn generate_voucher_code() -> String {
    let random = Uuid::new_v4().simple().to_string().to_ascii_uppercase();
    format!("VCH{}", &random[..20])
}

fn normalized_filter(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    })
}

fn promotion_is_within_claim_window(promotion: &Promotion) -> Result<(), ApiError> {
    let now = Utc::now();
    if promotion
        .claim_starts_at
        .is_some_and(|starts_at| starts_at > now)
    {
        return Err(ApiError::Conflict(
            "This promotion is not open for claims yet".to_string(),
        ));
    }
    if promotion.claim_ends_at.is_some_and(|ends_at| ends_at < now) {
        return Err(ApiError::Conflict(
            "This promotion is no longer available".to_string(),
        ));
    }
    if promotion
        .claim_limit
        .is_some_and(|limit| promotion.claimed_count >= limit)
    {
        return Err(ApiError::Conflict(
            "This promotion has reached its claim limit".to_string(),
        ));
    }
    Ok(())
}

fn ensure_guest_claimable(promotion: &Promotion) -> Result<(), ApiError> {
    if promotion.slug == JULY_DELUXE_LOYALTY_PROMOTION_SLUG {
        return Err(ApiError::Conflict(
            "Redeem loyalty points to claim this voucher.".to_string(),
        ));
    }
    if promotion.status != "published" || !promotion.is_public {
        return Err(ApiError::NotFound("Promotion not found".to_string()));
    }
    // `promotion_kind` is a campaign/display category. Every claim creates a
    // guest-bound voucher so both advertised deals and voucher campaigns share
    // the same safe redemption workflow.
    promotion_is_within_claim_window(promotion)
}

fn ensure_admin_issueable(promotion: &Promotion) -> Result<(), ApiError> {
    if promotion.status != "published" {
        return Err(ApiError::Conflict(
            "Only published promotions can issue vouchers".to_string(),
        ));
    }
    promotion_is_within_claim_window(promotion)
}

fn pagination(query: &PromotionListQuery) -> (i64, i64, i64) {
    let pagination = normalize_pagination(query.page, query.page_size, 20, 100);
    (pagination.page, pagination.page_size, pagination.offset)
}

fn ensure_publishable(promotion: &Promotion) -> Result<(), ApiError> {
    if !matches!(promotion.status.as_str(), "draft" | "paused") {
        return Err(ApiError::Conflict(
            "Only draft or paused promotions can be published".to_string(),
        ));
    }
    if promotion
        .claim_limit
        .is_some_and(|limit| limit < promotion.claimed_count)
    {
        return Err(ApiError::BadRequest(
            "Claim limit cannot be below the number of existing claims".to_string(),
        ));
    }
    Ok(())
}

async fn updated_promotion(pool: &DbPool, promotion_id: i64) -> Result<Promotion, ApiError> {
    PromotionRepository::find_by_id(pool, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))
}

/// Public, currently active campaigns. A public catalogue intentionally does
/// not return staff-only fields beyond the promotion terms themselves.
pub async fn list_public_promotions(
    pool: &DbPool,
    query: PromotionListQuery,
) -> Result<PublicPromotionListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let (total, items) = PromotionRepository::list_public(pool, page_size, offset).await?;
    Ok(PublicPromotionListResponse {
        items: items.into_iter().map(PublicPromotion::from).collect(),
        total,
        page,
        page_size,
    })
}

pub async fn get_public_promotion(pool: &DbPool, slug: &str) -> Result<PublicPromotion, ApiError> {
    let slug = validation::normalize_slug(slug)?;
    PromotionRepository::find_public_by_slug(pool, &slug)
        .await?
        .map(PublicPromotion::from)
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))
}

pub async fn list_guest_promotions(
    pool: &DbPool,
    guest_id: i64,
    query: PromotionListQuery,
) -> Result<GuestPromotionListResponse, ApiError> {
    let public = list_public_promotions(pool, query).await?;
    let mut items = Vec::with_capacity(public.items.len());
    for promotion in public.items {
        let has_voucher =
            PromotionRepository::guest_has_voucher(pool, promotion.id, guest_id).await?;
        let can_claim = !has_voucher;
        items.push(GuestPromotion {
            promotion,
            can_claim,
            has_voucher,
            claim_unavailable_reason: None,
        });
    }
    let mut has_loyalty_offer = false;
    if let Some(member) = LoyaltyRepository::member_by_guest(pool, guest_id).await?
        && member.status == "active"
    {
        if let Some(promotion) =
            PromotionRepository::find_by_slug(pool, JULY_DELUXE_LOYALTY_PROMOTION_SLUG).await?
            && promotion_is_within_claim_window(&promotion).is_ok()
        {
            let has_voucher =
                PromotionRepository::guest_has_voucher(pool, promotion.id, guest_id).await?;
            let reward = LoyaltyRepository::find_active_reward_by_name(
                pool,
                JULY_DELUXE_LOYALTY_REWARD_NAME,
            )
            .await?;
            let can_claim = reward.as_ref().is_some_and(|reward| {
                !has_voucher && member.available_points >= reward.points_cost
            });
            let claim_unavailable_reason = if has_voucher {
                None
            } else if let Some(reward) = reward {
                (member.available_points < reward.points_cost).then(|| {
                    format!(
                        "You need {} loyalty points to redeem this voucher.",
                        reward.points_cost
                    )
                })
            } else {
                Some("This loyalty voucher is not configured.".to_string())
            };
            items.push(GuestPromotion {
                promotion: PublicPromotion::from(promotion),
                can_claim,
                has_voucher,
                claim_unavailable_reason,
            });
            has_loyalty_offer = true;
        }
    }
    Ok(GuestPromotionListResponse {
        items,
        total: public.total + i64::from(has_loyalty_offer),
        page: public.page,
        page_size: public.page_size,
    })
}

pub async fn list_guest_vouchers(
    pool: &DbPool,
    guest_id: i64,
    query: PromotionListQuery,
) -> Result<VoucherListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let (total, items) =
        PromotionRepository::list_guest_vouchers(pool, guest_id, page_size, offset).await?;
    Ok(VoucherListResponse {
        items,
        total,
        page,
        page_size,
    })
}

/// Issue the one-time welcome voucher for a newly activated guest portal
/// account. The database uniqueness constraint makes retries safe.
pub async fn issue_welcome_deluxe_voucher(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Voucher, ApiError> {
    let promotion = PromotionRepository::find_by_slug(pool, WELCOME_DELUXE_PROMOTION_SLUG)
        .await?
        .ok_or_else(|| {
            ApiError::Internal("Welcome Deluxe promotion is not configured".to_string())
        })?;
    ensure_admin_issueable(&promotion)?;

    if let Some(voucher) =
        PromotionRepository::find_voucher_by_promotion_guest(pool, promotion.id, guest_id, true)
            .await?
    {
        return Ok(voucher);
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let voucher_id = PromotionRepository::insert_voucher_if_new(
        &mut tx,
        promotion.id,
        guest_id,
        &generate_voucher_code(),
        "admin_issue",
        None,
        None,
    )
    .await?;

    if let Some(voucher_id) = voucher_id {
        if !PromotionRepository::reserve_claim_capacity(&mut tx, promotion.id).await? {
            return Err(ApiError::Conflict(
                "The Welcome Deluxe promotion has reached its claim limit".to_string(),
            ));
        }
        AuditLog::log_event_tx(
            &mut tx,
            None,
            "voucher.welcome_issued",
            "voucher",
            Some(voucher_id),
            Some(json!({
                "promotion_id": promotion.id,
                "guest_id": guest_id,
                "source": "guest_activation",
            })),
            None,
            None,
        )
        .await?;
        tx.commit().await.map_err(ApiError::from)?;
        return PromotionRepository::find_voucher_for_guest(pool, voucher_id, guest_id)
            .await?
            .ok_or_else(|| ApiError::Internal("Issued welcome voucher was not found".to_string()));
    }

    tx.commit().await.map_err(ApiError::from)?;
    PromotionRepository::find_voucher_by_promotion_guest(pool, promotion.id, guest_id, true)
        .await?
        .ok_or_else(|| ApiError::Internal("Existing welcome voucher was not found".to_string()))
}

pub async fn claim_guest_promotion(
    pool: &DbPool,
    guest_id: i64,
    promotion_id: i64,
    input: ClaimPromotionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Voucher, ApiError> {
    request_id_is_valid(input.client_request_id.as_deref())?;

    // A repeated claim is an idempotent read, even after the campaign reaches
    // its overall capacity or closes. The unique promotion/guest constraint
    // makes this safe without consuming an additional claim.
    if let Some(voucher) =
        PromotionRepository::find_voucher_by_promotion_guest(pool, promotion_id, guest_id, true)
            .await?
    {
        return Ok(voucher);
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let promotion = PromotionRepository::find_by_id_tx(&mut tx, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    if promotion.slug == JULY_DELUXE_LOYALTY_PROMOTION_SLUG {
        drop(tx);
        let reward =
            LoyaltyRepository::find_active_reward_by_name(pool, JULY_DELUXE_LOYALTY_REWARD_NAME)
                .await?
                .ok_or_else(|| {
                    ApiError::Internal("July Deluxe loyalty reward is not configured.".to_string())
                })?;
        loyalty_service::redeem_reward_for_guest(
            pool,
            guest_id,
            None,
            reward.id,
            RedeemRewardInput {
                booking_id: None,
                notes: None,
            },
        )
        .await?;
        return PromotionRepository::find_voucher_by_promotion_guest(
            pool,
            promotion_id,
            guest_id,
            true,
        )
        .await?
        .ok_or_else(|| ApiError::Internal("Redeemed loyalty voucher was not found.".to_string()));
    }
    ensure_guest_claimable(&promotion)?;

    let voucher_id = PromotionRepository::insert_voucher_if_new(
        &mut tx,
        promotion_id,
        guest_id,
        &generate_voucher_code(),
        "guest_claim",
        None,
        None,
    )
    .await?;

    if let Some(voucher_id) = voucher_id {
        if !PromotionRepository::reserve_claim_capacity(&mut tx, promotion_id).await? {
            return Err(ApiError::Conflict(
                "This promotion has reached its claim limit".to_string(),
            ));
        }
        AuditLog::log_event_tx(
            &mut tx,
            None,
            "promotion.claimed",
            "voucher",
            Some(voucher_id),
            Some(json!({
                "promotion_id": promotion_id,
                "guest_id": guest_id,
                "source": "guest_portal",
            })),
            ip_address,
            user_agent,
        )
        .await?;
        tx.commit().await.map_err(ApiError::from)?;
        return PromotionRepository::find_voucher_for_guest(pool, voucher_id, guest_id)
            .await?
            .ok_or_else(|| ApiError::Internal("Claimed voucher was not found".to_string()));
    }

    tx.commit().await.map_err(ApiError::from)?;
    PromotionRepository::find_voucher_by_promotion_guest(pool, promotion_id, guest_id, true)
        .await?
        .ok_or_else(|| ApiError::Internal("Existing voucher was not found".to_string()))
}

pub async fn list_admin_promotions(
    pool: &DbPool,
    query: PromotionListQuery,
) -> Result<PromotionListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let status = normalized_filter(query.status);
    let status = status
        .as_deref()
        .map(validation::validate_status)
        .transpose()?;
    let search = normalized_filter(query.search);
    let (total, items) = PromotionRepository::list_admin(
        pool,
        status.as_deref(),
        search.as_deref(),
        page_size,
        offset,
    )
    .await?;
    Ok(PromotionListResponse {
        items,
        total,
        page,
        page_size,
    })
}

pub async fn get_admin_promotion(pool: &DbPool, promotion_id: i64) -> Result<Promotion, ApiError> {
    updated_promotion(pool, promotion_id).await
}

pub async fn create_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    input: PromotionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    let draft = validation::validate_promotion_input(input)?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let promotion_id = PromotionRepository::insert_promotion(&mut tx, &draft, actor_id).await?;
    PromotionRepository::replace_room_type_targets(&mut tx, promotion_id, &draft.room_type_ids)
        .await?;
    AuditLog::log_event_tx(
        &mut tx,
        Some(actor_id),
        "promotion.created",
        "promotion",
        Some(promotion_id),
        Some(json!({"status": "draft", "promotion_kind": draft.promotion_kind})),
        ip_address,
        user_agent,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    updated_promotion(pool, promotion_id).await
}

pub async fn update_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    input: PromotionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    let expected_version = input.expected_version;
    let draft = validation::validate_promotion_input(input)?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let existing = PromotionRepository::find_by_id_tx(&mut tx, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    if !matches!(existing.status.as_str(), "draft" | "paused") {
        return Err(ApiError::Conflict(
            "Published or archived promotions cannot be edited. Pause and create a new version instead."
                .to_string(),
        ));
    }
    if PromotionRepository::update_promotion(
        &mut tx,
        promotion_id,
        expected_version,
        &draft,
        actor_id,
    )
    .await?
    .is_none()
    {
        return Err(ApiError::Conflict(
            "This promotion changed. Refresh it before saving.".to_string(),
        ));
    }
    PromotionRepository::replace_room_type_targets(&mut tx, promotion_id, &draft.room_type_ids)
        .await?;
    AuditLog::log_event_tx(
        &mut tx,
        Some(actor_id),
        "promotion.updated",
        "promotion",
        Some(promotion_id),
        Some(json!({"previous_version": existing.version})),
        ip_address,
        user_agent,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    updated_promotion(pool, promotion_id).await
}

async fn transition_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    next_status: &str,
    expected_version: Option<i64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let current = PromotionRepository::find_by_id_tx(&mut tx, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    match next_status {
        "published" => ensure_publishable(&current)?,
        "paused" if current.status != "published" => {
            return Err(ApiError::Conflict(
                "Only published promotions can be paused".to_string(),
            ));
        }
        "archived" if current.status == "archived" => {
            return Err(ApiError::Conflict(
                "This promotion is already archived".to_string(),
            ));
        }
        "paused" | "archived" => {}
        _ => {
            return Err(ApiError::BadRequest(
                "Unsupported promotion action".to_string(),
            ));
        }
    }
    if PromotionRepository::set_status(
        &mut tx,
        promotion_id,
        next_status,
        expected_version,
        actor_id,
    )
    .await?
    .is_none()
    {
        return Err(ApiError::Conflict(
            "This promotion changed. Refresh it before continuing.".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        Some(actor_id),
        &format!("promotion.{next_status}"),
        "promotion",
        Some(promotion_id),
        Some(json!({"previous_status": current.status, "previous_version": current.version})),
        ip_address,
        user_agent,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    updated_promotion(pool, promotion_id).await
}

pub async fn publish_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    expected_version: Option<i64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_admin_promotion(
        pool,
        actor_id,
        promotion_id,
        "published",
        expected_version,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn pause_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    expected_version: Option<i64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_admin_promotion(
        pool,
        actor_id,
        promotion_id,
        "paused",
        expected_version,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn archive_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    expected_version: Option<i64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_admin_promotion(
        pool,
        actor_id,
        promotion_id,
        "archived",
        expected_version,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn list_admin_vouchers(
    pool: &DbPool,
    query: PromotionListQuery,
) -> Result<VoucherListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let status = normalized_filter(query.status);
    let status = status
        .as_deref()
        .map(validation::validate_voucher_status)
        .transpose()?;
    let search = normalized_filter(query.search);
    let (total, items) = PromotionRepository::list_admin_vouchers(
        pool,
        status.as_deref(),
        search.as_deref(),
        page_size,
        offset,
    )
    .await?;
    Ok(VoucherListResponse {
        items,
        total,
        page,
        page_size,
    })
}

pub async fn issue_admin_voucher(
    pool: &DbPool,
    actor_id: i64,
    input: VoucherIssueInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Voucher, ApiError> {
    if input.guest_id <= 0 || input.promotion_id <= 0 {
        return Err(ApiError::BadRequest(
            "Invalid guest or promotion".to_string(),
        ));
    }
    if input
        .expires_at
        .is_some_and(|expires_at| expires_at <= Utc::now())
    {
        return Err(ApiError::BadRequest(
            "Voucher expiry must be in the future".to_string(),
        ));
    }
    let code = match input.code {
        Some(code) => validation::normalize_voucher_code(&code)?,
        None => generate_voucher_code(),
    };
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let promotion = PromotionRepository::find_by_id_tx(&mut tx, input.promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    ensure_admin_issueable(&promotion)?;
    let voucher_id = PromotionRepository::insert_voucher_if_new(
        &mut tx,
        input.promotion_id,
        input.guest_id,
        &code,
        "admin_issue",
        input.expires_at,
        Some(actor_id),
    )
    .await?
    .ok_or_else(|| {
        ApiError::Conflict("This guest already has a voucher for this promotion".to_string())
    })?;
    if !PromotionRepository::reserve_claim_capacity(&mut tx, input.promotion_id).await? {
        return Err(ApiError::Conflict(
            "This promotion has reached its claim limit".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        Some(actor_id),
        "voucher.issued",
        "voucher",
        Some(voucher_id),
        Some(json!({
            "promotion_id": input.promotion_id,
            "guest_id": input.guest_id,
            "source": "admin_issue",
        })),
        ip_address,
        user_agent,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::Internal("Issued voucher was not found".to_string()))
}

pub async fn revoke_admin_voucher(
    pool: &DbPool,
    actor_id: i64,
    voucher_id: i64,
    input: VoucherRevokeInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Voucher, ApiError> {
    let reason = validation::sanitize_optional_reason(input.reason)?;
    let existing = PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Voucher not found".to_string()))?;
    if existing.status != "available" {
        return Err(ApiError::Conflict(
            "Only available vouchers can be revoked".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    if PromotionRepository::revoke_voucher(&mut tx, voucher_id, actor_id, reason.as_deref())
        .await?
        .is_none()
    {
        return Err(ApiError::Conflict(
            "This voucher changed. Refresh it before revoking.".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        Some(actor_id),
        "voucher.revoked",
        "voucher",
        Some(voucher_id),
        Some(json!({
            "promotion_id": existing.promotion_id,
            "guest_id": existing.guest_id,
            "reason": reason,
        })),
        ip_address,
        user_agent,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::Internal("Revoked voucher was not found".to_string()))
}
