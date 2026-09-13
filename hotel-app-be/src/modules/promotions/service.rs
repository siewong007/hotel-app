//! Business rules for promotion publishing, claims, and voucher management.

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use super::models::{
    CampaignChannelMixRow, CampaignPerNightTotals, CampaignPerformance, CampaignRedemptionTotals,
    CampaignVoucherFunnel, ClaimPromotionInput, GuestPromotion, GuestPromotionListResponse,
    Promotion, PromotionActionInput, PromotionInput, PromotionListQuery, PromotionListResponse,
    PublicPromotion, PublicPromotionListResponse, TargetingChannelOption, TargetingOptionsResponse,
    TargetingTierOption, Voucher, VoucherIssueInput, VoucherListResponse, VoucherRevokeInput,
    VoucherSummary,
};
use super::repository::PromotionRepository;
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::models::row_mappers::get_decimal;
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

/// Loyalty-tier targeting gates acquisition: a guest outside the targeted
/// tiers can neither claim nor be issued the campaign's vouchers. An empty
/// tier set targets everyone.
async fn ensure_tier_targetable(
    pool: &DbPool,
    promotion: &Promotion,
    guest_id: i64,
) -> Result<(), ApiError> {
    if promotion.loyalty_tier_ids.is_empty() {
        return Ok(());
    }
    if PromotionRepository::guest_in_loyalty_tiers(pool, guest_id, &promotion.loyalty_tier_ids)
        .await?
    {
        Ok(())
    } else {
        Err(ApiError::Conflict(
            "This campaign is reserved for specific loyalty tiers".to_string(),
        ))
    }
}

/// Channel targeting gates the portal: every guest-portal claim resolves to
/// the direct booking channel, so a campaign whose channel set excludes it is
/// not claimable online. An empty channel set is reachable on every channel.
async fn ensure_portal_channel_targetable(
    pool: &DbPool,
    promotion: &Promotion,
) -> Result<(), ApiError> {
    if promotion.booking_channel_ids.is_empty() {
        return Ok(());
    }
    let direct =
        crate::modules::guest_booking::repository::GuestBookingRepository::direct_booking_channel(
            pool,
        )
        .await?;
    if direct.is_some_and(|id| promotion.booking_channel_ids.contains(&id)) {
        Ok(())
    } else {
        Err(ApiError::Conflict(
            "This campaign is not available for online booking".to_string(),
        ))
    }
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
        items,
        total,
        page,
        page_size,
    })
}

pub async fn get_public_promotion(pool: &DbPool, slug: &str) -> Result<PublicPromotion, ApiError> {
    let slug = validation::normalize_slug(slug)?;
    PromotionRepository::find_public_by_slug(pool, &slug)
        .await?
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
        && let Some(promotion) =
            PromotionRepository::find_by_slug(pool, JULY_DELUXE_LOYALTY_PROMOTION_SLUG).await?
        && promotion_is_within_claim_window(&promotion).is_ok()
    {
        let has_voucher =
            PromotionRepository::guest_has_voucher(pool, promotion.id, guest_id).await?;
        let reward =
            LoyaltyRepository::find_active_reward_by_name(pool, JULY_DELUXE_LOYALTY_REWARD_NAME)
                .await?;
        let can_claim = reward
            .as_ref()
            .is_some_and(|reward| !has_voucher && member.available_points >= reward.points_cost);
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
    ensure_tier_targetable(pool, &promotion, guest_id).await?;

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
            AuditEvent {
                user_id: None,
                action: "voucher.welcome_issued",
                resource_type: "voucher",
                resource_id: Some(voucher_id),
                details: Some(json!({
                    "promotion_id": promotion.id,
                    "guest_id": guest_id,
                    "source": "guest_activation",
                })),
                ..Default::default()
            },
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

    // Targeting gates run on a pool read before the transaction: pool queries
    // inside the tx would hold two connections per claim and can starve the
    // pool under concurrent claims.
    let promotion = PromotionRepository::find_by_id(pool, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    if promotion.slug == JULY_DELUXE_LOYALTY_PROMOTION_SLUG {
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
    ensure_tier_targetable(pool, &promotion, guest_id).await?;
    ensure_portal_channel_targetable(pool, &promotion).await?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    // Re-read inside the transaction: status or claim capacity may have moved
    // since the pre-check, so the mutation path validates current state.
    let promotion = PromotionRepository::find_by_id_tx(&mut tx, promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
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
            AuditEvent {
                user_id: None,
                action: "promotion.claimed",
                resource_type: "voucher",
                resource_id: Some(voucher_id),
                details: Some(json!({
                    "promotion_id": promotion_id,
                    "guest_id": guest_id,
                    "source": "guest_portal",
                })),
                ip_address,
                user_agent,
            },
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
    let lifecycle = normalized_filter(query.status);
    let lifecycle = lifecycle
        .as_deref()
        .map(validation::validate_lifecycle_filter)
        .transpose()?;
    let search = normalized_filter(query.search);
    let (total, items) = PromotionRepository::list_admin(
        pool,
        lifecycle.as_deref(),
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
    PromotionRepository::replace_channel_targets(&mut tx, promotion_id, &draft.booking_channel_ids)
        .await?;
    PromotionRepository::replace_tier_targets(&mut tx, promotion_id, &draft.loyalty_tier_ids)
        .await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "promotion.created",
            resource_type: "promotion",
            resource_id: Some(promotion_id),
            details: Some(json!({"status": "draft", "promotion_kind": draft.promotion_kind})),
            ip_address,
            user_agent,
        },
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
    PromotionRepository::replace_channel_targets(&mut tx, promotion_id, &draft.booking_channel_ids)
        .await?;
    PromotionRepository::replace_tier_targets(&mut tx, promotion_id, &draft.loyalty_tier_ids)
        .await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "promotion.updated",
            resource_type: "promotion",
            resource_id: Some(promotion_id),
            details: Some(json!({"previous_version": existing.version})),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    updated_promotion(pool, promotion_id).await
}

#[allow(clippy::too_many_arguments)]
async fn transition_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    next_status: &str,
    expected_version: Option<i64>,
    reason: Option<String>,
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
        // Cancellation is terminal: the campaign stops claiming and its
        // outstanding vouchers freeze because redemption requires `published`.
        // It is intentionally irreversible — start a new campaign instead.
        "cancelled" if matches!(current.status.as_str(), "cancelled" | "archived") => {
            return Err(ApiError::Conflict(
                "A cancelled or archived campaign cannot be cancelled again".to_string(),
            ));
        }
        "archived" if current.status == "archived" => {
            return Err(ApiError::Conflict(
                "This promotion is already archived".to_string(),
            ));
        }
        "paused" | "cancelled" | "archived" => {}
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
        AuditEvent {
            user_id: Some(actor_id),
            action: &format!("promotion.{next_status}"),
            resource_type: "promotion",
            resource_id: Some(promotion_id),
            details: Some(json!({
                "previous_status": current.status,
                "previous_version": current.version,
                "reason": reason,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    updated_promotion(pool, promotion_id).await
}

#[allow(clippy::too_many_arguments)]
async fn transition_wrapper(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    next_status: &str,
    input: PromotionActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    let reason = validation::sanitize_optional_reason(input.reason)?;
    transition_admin_promotion(
        pool,
        actor_id,
        promotion_id,
        next_status,
        input.expected_version,
        reason,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn publish_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    input: PromotionActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_wrapper(
        pool,
        actor_id,
        promotion_id,
        "published",
        input,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn pause_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    input: PromotionActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_wrapper(
        pool,
        actor_id,
        promotion_id,
        "paused",
        input,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn cancel_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    input: PromotionActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_wrapper(
        pool,
        actor_id,
        promotion_id,
        "cancelled",
        input,
        ip_address,
        user_agent,
    )
    .await
}

pub async fn archive_admin_promotion(
    pool: &DbPool,
    actor_id: i64,
    promotion_id: i64,
    input: PromotionActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<Promotion, ApiError> {
    transition_wrapper(
        pool,
        actor_id,
        promotion_id,
        "archived",
        input,
        ip_address,
        user_agent,
    )
    .await
}

/// Maps the admin voucher `status` query param to a repository filter. The
/// aliases `expired` / `expiring_soon` become date predicates in SQL — they
/// are never persisted statuses.
fn normalized_voucher_status_filter(value: Option<String>) -> Result<Option<String>, ApiError> {
    match normalized_filter(value) {
        None => Ok(None),
        Some(raw) => {
            let normalized = validation::normalized_choice(&raw);
            if normalized == "expired" || normalized == "expiring_soon" {
                return Ok(Some(normalized));
            }
            validation::validate_voucher_status(&normalized).map(Some)
        }
    }
}

pub async fn list_admin_vouchers(
    pool: &DbPool,
    query: PromotionListQuery,
) -> Result<VoucherListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let status = normalized_voucher_status_filter(query.status)?;
    let search = normalized_filter(query.search);
    let promotion_id = query.promotion_id.filter(|id| *id > 0);
    let (total, items) = PromotionRepository::list_admin_vouchers(
        pool,
        status.as_deref(),
        search.as_deref(),
        promotion_id,
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

pub async fn get_admin_voucher(pool: &DbPool, voucher_id: i64) -> Result<Voucher, ApiError> {
    PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Voucher not found".to_string()))
}

pub async fn voucher_admin_summary(pool: &DbPool) -> Result<VoucherSummary, ApiError> {
    PromotionRepository::voucher_admin_summary(pool).await
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
    // Issueability and tier targeting are pool reads: running them inside the
    // transaction would hold two connections per request (pool starvation).
    let promotion = PromotionRepository::find_by_id(pool, input.promotion_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Promotion not found".to_string()))?;
    ensure_admin_issueable(&promotion)?;
    ensure_tier_targetable(pool, &promotion, input.guest_id).await?;

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
        AuditEvent {
            user_id: Some(actor_id),
            action: "voucher.issued",
            resource_type: "voucher",
            resource_id: Some(voucher_id),
            details: Some(json!({
                "promotion_id": input.promotion_id,
                "guest_id": input.guest_id,
                "source": "admin_issue",
            })),
            ip_address,
            user_agent,
        },
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
        AuditEvent {
            user_id: Some(actor_id),
            action: "voucher.revoked",
            resource_type: "voucher",
            resource_id: Some(voucher_id),
            details: Some(json!({
                "promotion_id": existing.promotion_id,
                "guest_id": existing.guest_id,
                "reason": reason,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::Internal("Revoked voucher was not found".to_string()))
}

/// Pick lists for the campaign editor's targeting controls. Lives behind
/// `promotions:read` because the campaigns workspace needs it and the generic
/// `/api/booking-channels` list is gated on analytics/reports permissions.
pub async fn targeting_options(pool: &DbPool) -> Result<TargetingOptionsResponse, ApiError> {
    use sqlx::Row;
    let (channels, tiers) = PromotionRepository::targeting_options(pool).await?;
    Ok(TargetingOptionsResponse {
        channels: channels
            .iter()
            .map(|row| TargetingChannelOption {
                id: row.try_get("id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                channel_type: row.try_get("channel_type").unwrap_or_default(),
            })
            .collect(),
        loyalty_tiers: tiers
            .iter()
            .map(|row| TargetingTierOption {
                id: row.try_get("id").unwrap_or_default(),
                code: row.try_get::<Option<String>, _>("code").ok().flatten(),
                name: row.try_get("name").unwrap_or_default(),
            })
            .collect(),
    })
}

/// Per-campaign performance built entirely from voucher/redemption rows —
/// counts the claim funnel, applied vs reversed redemptions, stay-night
/// attribution, and the booking-channel mix. No impressions or clicks exist
/// to report on, so none are returned.
pub async fn campaign_performance(
    pool: &DbPool,
    promotion_id: i64,
) -> Result<CampaignPerformance, ApiError> {
    use sqlx::Row;
    let promotion = updated_promotion(pool, promotion_id).await?;
    let funnel = PromotionRepository::campaign_voucher_funnel(pool, promotion_id).await?;
    let totals = PromotionRepository::campaign_redemption_totals(pool, promotion_id).await?;
    let nights = PromotionRepository::campaign_per_night_totals(pool, promotion_id).await?;
    let mix = PromotionRepository::campaign_channel_mix(pool, promotion_id).await?;

    let total_vouchers = funnel.try_get::<i64, _>("total").unwrap_or_default();
    let applied = totals.try_get::<i64, _>("applied").unwrap_or_default();
    let conversion_rate = (total_vouchers > 0).then(|| applied as f64 / total_vouchers as f64);
    let amount = |row: &crate::core::db::DbRow, column: &str| {
        get_decimal(row, column)
            .to_string()
            .parse::<f64>()
            .unwrap_or(0.0)
    };

    Ok(CampaignPerformance {
        promotion_id,
        currency: promotion.currency,
        vouchers: CampaignVoucherFunnel {
            total: total_vouchers,
            available: funnel.try_get("available").unwrap_or_default(),
            redeemed: funnel.try_get("redeemed").unwrap_or_default(),
            revoked: funnel.try_get("revoked").unwrap_or_default(),
            expired: funnel.try_get("expired").unwrap_or_default(),
            guest_claims: funnel.try_get("guest_claims").unwrap_or_default(),
            admin_issues: funnel.try_get("admin_issues").unwrap_or_default(),
        },
        redemptions: CampaignRedemptionTotals {
            applied,
            reversed: totals.try_get("reversed").unwrap_or_default(),
            gross_subtotal: amount(&totals, "gross_subtotal"),
            discount_amount: amount(&totals, "discount_amount"),
            net_total: amount(&totals, "net_total"),
            bookings: totals.try_get("bookings").unwrap_or_default(),
            guests: totals.try_get("guests").unwrap_or_default(),
            conversion_rate,
        },
        per_night: CampaignPerNightTotals {
            nights: nights.try_get("nights").unwrap_or_default(),
            gross_amount: amount(&nights, "gross_amount"),
            discount_amount: amount(&nights, "discount_amount"),
            net_amount: amount(&nights, "net_amount"),
        },
        channel_mix: mix
            .iter()
            .map(|row| CampaignChannelMixRow {
                channel_id: row.try_get::<Option<i64>, _>("channel_id").ok().flatten(),
                name: row
                    .try_get::<Option<String>, _>("name")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "Unassigned".to_string()),
                channel_type: row
                    .try_get::<Option<String>, _>("channel_type")
                    .ok()
                    .flatten(),
                redemptions: row.try_get("redemptions").unwrap_or_default(),
                net_total: amount(row, "net_total"),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::normalized_voucher_status_filter;

    #[test]
    fn voucher_status_filter_accepts_query_aliases() {
        assert_eq!(
            normalized_voucher_status_filter(Some("expired".to_string())).unwrap(),
            Some("expired".to_string())
        );
        assert_eq!(
            normalized_voucher_status_filter(Some("Expiring_Soon".to_string())).unwrap(),
            Some("expiring_soon".to_string())
        );
        assert_eq!(
            normalized_voucher_status_filter(Some("expiring-soon".to_string())).unwrap(),
            Some("expiring_soon".to_string())
        );
        assert_eq!(
            normalized_voucher_status_filter(Some(" Expiring soon ".to_string())).unwrap(),
            Some("expiring_soon".to_string())
        );
    }

    #[test]
    fn voucher_status_filter_normalizes_persisted_statuses() {
        assert_eq!(
            normalized_voucher_status_filter(Some(" Available ".to_string())).unwrap(),
            Some("available".to_string())
        );
    }

    #[test]
    fn voucher_status_filter_rejects_non_voucher_statuses() {
        assert!(normalized_voucher_status_filter(Some("paused".to_string())).is_err());
        assert!(normalized_voucher_status_filter(Some("archived".to_string())).is_err());
    }

    #[test]
    fn voucher_status_filter_passes_through_empty() {
        assert_eq!(normalized_voucher_status_filter(None).unwrap(), None);
        assert_eq!(
            normalized_voucher_status_filter(Some("   ".to_string())).unwrap(),
            None
        );
    }
}
