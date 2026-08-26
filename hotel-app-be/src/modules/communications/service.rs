//! Business logic for the communications domain.
//!
//! Safety invariants enforced here:
//! - Audit details never contain email bodies, recipient addresses, or
//!   voucher codes — only ids, topics, statuses, and counts.
//! - Bulk sending never happens in an HTTP request: `schedule_campaign` only
//!   flips status; audience expansion/enqueue belongs to the background
//!   scheduler (Phase 5).
//! - Subscription changes always write a consent event in the same
//!   transaction.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::json;

use super::models::{
    AudienceCount, CampaignInput, CampaignListQuery, CampaignListResponse, ConsentStatusResponse,
    DeliveryFeedItem, DeliveryFeedResponse, DeliveryListResponse, DeliverySummary, EmailCampaign,
    EmailTemplate, PreferenceUpdateInput, PreferencesResponse, PreviewResponse,
    ScheduleCampaignInput, SuppressionInput, SuppressionListResponse, TestSendInput,
    TopicPreference, UnsubscribeApplyInput, mask_email,
};
use super::repository::{CommunicationsRepository as Repo, ConsentEventValues};
use super::tokens;
use super::transport::{OutgoingEmail, SmtpConfig, Transport};
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;

const CHANNEL_EMAIL: &str = "email";

fn normalize_page(page: Option<i64>, page_size: Option<i64>) -> (i64, i64) {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(20).clamp(1, 100);
    (page, page_size)
}

fn email_transport_configured() -> bool {
    // Keep scheduling readiness in lockstep with Transport::from_env(): a
    // host alone is insufficient because a sender address is mandatory.
    SmtpConfig::from_env().is_some()
}

async fn require_campaign(pool: &DbPool, id: i64) -> Result<EmailCampaign, ApiError> {
    Repo::get_campaign(pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Campaign not found".to_string()))
}

// ----------------------------------------------------------------------
// Campaigns
// ----------------------------------------------------------------------

pub async fn list_campaigns(
    pool: &DbPool,
    query: CampaignListQuery,
) -> Result<CampaignListResponse, ApiError> {
    let (page, page_size) = normalize_page(query.page, query.page_size);
    let status = match query.status.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) => Some(s.to_ascii_lowercase()),
    };
    let campaign_type = match query.campaign_type.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) => Some(s.to_ascii_lowercase()),
    };
    let (items, total) = Repo::list_campaigns(pool, status, campaign_type, page, page_size).await?;
    Ok(CampaignListResponse {
        items,
        total,
        page,
        page_size,
    })
}

pub async fn get_campaign(pool: &DbPool, id: i64) -> Result<EmailCampaign, ApiError> {
    require_campaign(pool, id).await
}

pub async fn create_campaign(
    pool: &DbPool,
    actor_id: i64,
    input: CampaignInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailCampaign, ApiError> {
    let draft = validation::validate_campaign_input(input)?;
    if let Some(promotion_id) = draft.promotion_id
        && Repo::promotion_status(pool, promotion_id).await?.is_none()
    {
        return Err(ApiError::BadRequest("Unknown promotion".to_string()));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let id = Repo::insert_campaign_tx(&mut tx, &draft, actor_id).await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "campaign.created",
            resource_type: "email_campaign",
            resource_id: Some(id),
            details: Some(json!({
                "campaign_type": draft.campaign_type,
                "topic": draft.topic,
                "promotion_id": draft.promotion_id,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_campaign(pool, id).await
}

pub async fn update_campaign(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: CampaignInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailCampaign, ApiError> {
    let draft = validation::validate_campaign_input(input)?;
    let existing = require_campaign(pool, id).await?;
    if existing.status != "draft" {
        return Err(ApiError::Conflict(
            "Only draft campaigns can be edited".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = Repo::update_campaign_draft_tx(&mut tx, id, &draft).await?;
    if !updated {
        return Err(ApiError::Conflict(
            "Only draft campaigns can be edited".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "campaign.updated",
            resource_type: "email_campaign",
            resource_id: Some(id),
            details: Some(json!({
                "campaign_type": draft.campaign_type,
                "topic": draft.topic,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_campaign(pool, id).await
}

fn sample_vars(template: &EmailTemplate) -> HashMap<String, String> {
    template
        .variables
        .iter()
        .map(|name| (name.clone(), format!("[{name}]")))
        .collect()
}

/// Renders the effective body for a campaign: the linked template with
/// sample values (escaped), or the campaign's own body.
async fn render_campaign_body(pool: &DbPool, campaign: &EmailCampaign) -> Result<String, ApiError> {
    match campaign.template_id {
        Some(template_id) => {
            let template = Repo::get_template(pool, template_id)
                .await?
                .ok_or_else(|| ApiError::NotFound("Template not found".to_string()))?;
            validation::render_template(
                &template.body_html,
                &sample_vars(&template),
                &template.variables,
            )
        }
        None => Ok(campaign.body_html.clone()),
    }
}

pub async fn preview_campaign(pool: &DbPool, id: i64) -> Result<PreviewResponse, ApiError> {
    let campaign = require_campaign(pool, id).await?;
    // Stored campaign HTML is authored with communications:compose and is
    // deliberately not stripped for SMTP delivery. The browser preview,
    // however, renders it with dangerouslySetInnerHTML to viewers holding
    // only communications:read — so the preview response gets the whitelist
    // sanitizer while the outbound email keeps the original markup.
    let body_html = crate::utils::sanitization::Sanitizer::sanitize_html(
        &render_campaign_body(pool, &campaign).await?,
    );
    let audience = Repo::count_audience_for_topic(pool, &campaign.topic).await?;
    Ok(PreviewResponse {
        subject: campaign.subject,
        body_html,
        audience,
    })
}

/// Sends ONE rendered test email directly (not via the outbox) to a
/// staff-supplied address. Deliberately synchronous: a single message, gated
/// on communications:send.
pub async fn test_send_campaign(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: TestSendInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    let recipient = validation::validate_email(&input.recipient_email)?;
    let campaign = require_campaign(pool, id).await?;
    let transport = Transport::from_env()?.ok_or_else(|| {
        ApiError::Conflict(
            "Email transport is not configured; set SMTP_* environment variables".to_string(),
        )
    })?;
    let body_html = render_campaign_body(pool, &campaign).await?;
    transport
        .send(&OutgoingEmail {
            to: recipient,
            subject: format!("[TEST] {}", campaign.subject),
            body_html,
            body_text: campaign.body_text.clone(),
        })
        .await
        .map_err(|e| ApiError::Internal(format!("Test send failed: {e}")))?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "campaign.test_sent",
            resource_type: "email_campaign",
            resource_id: Some(id),
            details: None,
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

pub async fn schedule_campaign(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: ScheduleCampaignInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailCampaign, ApiError> {
    if !email_transport_configured() {
        return Err(ApiError::Conflict(
            "Email transport is not configured; set SMTP_* environment variables before scheduling"
                .to_string(),
        ));
    }
    let campaign = require_campaign(pool, id).await?;
    if campaign.status != "draft" {
        return Err(ApiError::Conflict(
            "Only draft campaigns can be scheduled".to_string(),
        ));
    }
    if campaign.campaign_type == "promotion" {
        let promotion_id = campaign.promotion_id.ok_or_else(|| {
            ApiError::Conflict("Promotion campaigns require a promotion".to_string())
        })?;
        let status = Repo::promotion_status(pool, promotion_id)
            .await?
            .ok_or_else(|| ApiError::Conflict("Linked promotion no longer exists".to_string()))?;
        if status != "published" {
            return Err(ApiError::Conflict(
                "Linked promotion must be published before sending".to_string(),
            ));
        }
    }
    let scheduled_at: DateTime<Utc> = input.scheduled_at.unwrap_or_else(Utc::now);
    if scheduled_at < Utc::now() - chrono::Duration::minutes(1) {
        return Err(ApiError::BadRequest(
            "scheduled_at cannot be in the past".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = Repo::schedule_campaign_tx(&mut tx, id, scheduled_at).await?;
    if !updated {
        return Err(ApiError::Conflict(
            "Only draft campaigns can be scheduled".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "campaign.scheduled",
            resource_type: "email_campaign",
            resource_id: Some(id),
            details: Some(json!({ "scheduled_at": scheduled_at.to_rfc3339() })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_campaign(pool, id).await
}

pub async fn cancel_campaign(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailCampaign, ApiError> {
    require_campaign(pool, id).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = Repo::cancel_campaign_tx(&mut tx, id, actor_id).await?;
    if !updated {
        return Err(ApiError::Conflict(
            "Only scheduled or running campaigns can be cancelled".to_string(),
        ));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "campaign.cancelled",
            resource_type: "email_campaign",
            resource_id: Some(id),
            details: None,
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_campaign(pool, id).await
}

pub async fn list_campaign_deliveries(
    pool: &DbPool,
    campaign_id: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<DeliveryListResponse, ApiError> {
    require_campaign(pool, campaign_id).await?;
    let (page, page_size) = normalize_page(page, page_size);
    let (rows, total) =
        Repo::list_deliveries_for_campaign(pool, campaign_id, page, page_size).await?;
    let items = rows
        .into_iter()
        .map(|d| DeliverySummary {
            id: d.id,
            campaign_id: d.campaign_id,
            kind: d.kind,
            guest_id: d.guest_id,
            topic: d.topic,
            recipient_masked: mask_email(&d.recipient_email),
            status: d.status,
            attempts: d.attempts,
            last_error: d.last_error,
            sent_at: d.sent_at,
            created_at: d.created_at,
        })
        .collect();
    Ok(DeliveryListResponse {
        items,
        total,
        page,
        page_size,
    })
}

/// Admin notification-center feed: recent deliveries across all campaigns,
/// filterable by derived priority tier and exact status.
pub async fn list_delivery_feed(
    pool: &DbPool,
    tier: Option<String>,
    status: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<DeliveryFeedResponse, ApiError> {
    const TIERS: [&str; 3] = ["all", "transactional", "marketing"];
    let tier = tier.unwrap_or_else(|| "all".to_string());
    if !TIERS.contains(&tier.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Unknown tier '{tier}'. Expected one of: {}",
            TIERS.join(", ")
        )));
    }
    if let Some(status) = &status {
        crate::modules::communications::validation::validate_delivery_status(status)?;
    }

    let (page, page_size) = normalize_page(page, page_size);
    let kinds: Vec<&'static str> = match tier.as_str() {
        "transactional" => validation::TRANSACTIONAL_KINDS.to_vec(),
        "marketing" => validation::MARKETING_KINDS.to_vec(),
        _ => Vec::new(), // no kind filter
    };

    let (rows, total, unread) = Repo::list_deliveries_page(
        pool,
        &kinds,
        status.as_deref(),
        page_size,
        (page - 1) * page_size,
    )
    .await?;

    let items = rows
        .into_iter()
        .map(|d| {
            let tier_label =
                crate::modules::communications::validation::delivery_tier(&d.kind);
            DeliveryFeedItem {
                summary: DeliverySummary {
                    id: d.id,
                    campaign_id: d.campaign_id,
                    kind: d.kind.clone(),
                    guest_id: d.guest_id,
                    topic: d.topic,
                    recipient_masked: mask_email(&d.recipient_email),
                    status: d.status,
                    attempts: d.attempts,
                    last_error: d.last_error,
                    sent_at: d.sent_at,
                    created_at: d.created_at,
                },
                tier: tier_label,
            }
        })
        .collect();

    Ok(DeliveryFeedResponse {
        items,
        total,
        unread,
        page,
        page_size,
    })
}

// ----------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------

pub async fn list_templates(pool: &DbPool) -> Result<Vec<EmailTemplate>, ApiError> {
    Repo::list_templates(pool).await
}

pub async fn create_template(
    pool: &DbPool,
    actor_id: i64,
    input: super::models::TemplateInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailTemplate, ApiError> {
    let draft = validation::validate_template_input(input)?;
    if Repo::get_template_by_code(pool, &draft.code)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "Template code already exists".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let id = Repo::insert_template_tx(&mut tx, &draft).await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "email_template.created",
            resource_type: "email_template",
            resource_id: Some(id),
            details: Some(json!({ "code": draft.code })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Repo::get_template(pool, id)
        .await?
        .ok_or_else(|| ApiError::Internal("Template vanished after insert".to_string()))
}

pub async fn update_template(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: super::models::TemplateInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EmailTemplate, ApiError> {
    let draft = validation::validate_template_input(input)?;
    if let Some(existing) = Repo::get_template_by_code(pool, &draft.code).await?
        && existing.id != id
    {
        return Err(ApiError::Conflict(
            "Template code already exists".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = Repo::update_template_tx(&mut tx, id, &draft).await?;
    if !updated {
        return Err(ApiError::NotFound("Template not found".to_string()));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "email_template.updated",
            resource_type: "email_template",
            resource_id: Some(id),
            details: Some(json!({ "code": draft.code })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Repo::get_template(pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Template not found".to_string()))
}

pub async fn deactivate_template(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = Repo::set_template_active_tx(&mut tx, id, false).await?;
    if !updated {
        return Err(ApiError::NotFound("Template not found".to_string()));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "email_template.deactivated",
            resource_type: "email_template",
            resource_id: Some(id),
            details: None,
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

// ----------------------------------------------------------------------
// Audience + suppressions
// ----------------------------------------------------------------------

pub async fn audience_count(pool: &DbPool, topic: &str) -> Result<AudienceCount, ApiError> {
    let topic = validation::validate_topic(topic)?;
    Repo::count_audience_for_topic(pool, &topic).await
}

pub async fn list_suppressions(
    pool: &DbPool,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<SuppressionListResponse, ApiError> {
    let (page, page_size) = normalize_page(page, page_size);
    let (items, total) = Repo::list_suppressions(pool, page, page_size).await?;
    Ok(SuppressionListResponse {
        items,
        total,
        page,
        page_size,
    })
}

pub async fn add_suppression(
    pool: &DbPool,
    actor_id: i64,
    input: SuppressionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    let draft = validation::validate_suppression_input(input)?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    Repo::insert_suppression_tx(&mut tx, &draft, Some("staff")).await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "suppression.added",
            resource_type: "email_suppression",
            resource_id: None,
            details: Some(json!({
                "email_masked": mask_email(&draft.email),
                "reason": draft.reason,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

pub async fn remove_suppression(
    pool: &DbPool,
    actor_id: i64,
    email: &str,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    let email = validation::validate_email(email)?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let removed = Repo::delete_suppression_tx(&mut tx, &email).await?;
    if !removed {
        return Err(ApiError::NotFound("Suppression not found".to_string()));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "suppression.removed",
            resource_type: "email_suppression",
            resource_id: None,
            details: Some(json!({ "email_masked": mask_email(&email) })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

// ----------------------------------------------------------------------
// Preferences + consent
// ----------------------------------------------------------------------

fn to_topic_preferences(
    subscriptions: &[super::models::NotificationSubscription],
) -> Vec<TopicPreference> {
    validation::TOPICS
        .iter()
        .map(|topic| TopicPreference {
            topic: (*topic).to_string(),
            subscribed: subscriptions
                .iter()
                .find(|s| s.topic == *topic && s.channel == CHANNEL_EMAIL)
                .map(|s| s.subscribed)
                .unwrap_or(false),
        })
        .collect()
}

pub async fn get_preferences(
    pool: &DbPool,
    guest_id: i64,
) -> Result<PreferencesResponse, ApiError> {
    Repo::get_guest_email(pool, guest_id).await?;
    let subscriptions = Repo::list_subscriptions_for_guest(pool, guest_id).await?;
    Ok(PreferencesResponse {
        subscriptions: to_topic_preferences(&subscriptions),
    })
}

/// Shared by guest self-service, staff-recorded consent, and unsubscribe.
/// One batch of subscription preference changes plus its consent provenance.
struct PreferenceChangeRequest<'a> {
    guest_id: i64,
    changes: &'a [(String, bool)],
    source: &'a str,
    policy_version: Option<&'a str>,
    actor_type: &'a str,
    actor_user_id: Option<i64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
}

async fn apply_preference_changes(
    pool: &DbPool,
    request: PreferenceChangeRequest<'_>,
) -> Result<(), ApiError> {
    let PreferenceChangeRequest {
        guest_id,
        changes,
        source,
        policy_version,
        actor_type,
        actor_user_id,
        ip_address,
        user_agent,
    } = request;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    for (topic, subscribed) in changes {
        Repo::upsert_subscription_tx(
            &mut tx,
            guest_id,
            CHANNEL_EMAIL,
            topic,
            *subscribed,
            Some(source),
            policy_version,
        )
        .await?;
        Repo::insert_consent_event_tx(
            &mut tx,
            ConsentEventValues {
                guest_id,
                channel: CHANNEL_EMAIL,
                topic,
                action: if *subscribed { "opt_in" } else { "opt_out" },
                source,
                policy_version,
                actor_type,
                actor_user_id,
                ip_address: ip_address.clone(),
                user_agent: user_agent.clone(),
            },
        )
        .await?;
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: actor_user_id,
            action: "subscription.updated",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({
                "source": source,
                "changes": changes
                    .iter()
                    .map(|(topic, subscribed)| json!({ "topic": topic, "subscribed": subscribed }))
                    .collect::<Vec<_>>(),
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

fn validate_changes(input: &PreferenceUpdateInput) -> Result<Vec<(String, bool)>, ApiError> {
    if input.subscriptions.is_empty() {
        return Err(ApiError::BadRequest(
            "No subscription changes provided".to_string(),
        ));
    }
    input
        .subscriptions
        .iter()
        .map(|change| {
            Ok((
                validation::validate_topic(&change.topic)?,
                change.subscribed,
            ))
        })
        .collect()
}

pub async fn update_my_preferences(
    pool: &DbPool,
    guest_id: i64,
    input: PreferenceUpdateInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<PreferencesResponse, ApiError> {
    let changes = validate_changes(&input)?;
    Repo::get_guest_email(pool, guest_id).await?;
    apply_preference_changes(
        pool,
        PreferenceChangeRequest {
            guest_id,
            changes: &changes,
            source: "guest_portal",
            policy_version: input.policy_version.as_deref(),
            actor_type: "guest",
            actor_user_id: None,
            ip_address,
            user_agent,
        },
    )
    .await?;
    get_preferences(pool, guest_id).await
}

pub async fn record_staff_consent(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    input: PreferenceUpdateInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<ConsentStatusResponse, ApiError> {
    let changes = validate_changes(&input)?;
    Repo::get_guest_email(pool, guest_id).await?;
    apply_preference_changes(
        pool,
        PreferenceChangeRequest {
            guest_id,
            changes: &changes,
            source: "staff",
            policy_version: input.policy_version.as_deref(),
            actor_type: "staff",
            actor_user_id: Some(actor_id),
            ip_address,
            user_agent,
        },
    )
    .await?;
    guest_consent_status(pool, guest_id).await
}

pub async fn guest_consent_status(
    pool: &DbPool,
    guest_id: i64,
) -> Result<ConsentStatusResponse, ApiError> {
    Repo::get_guest_email(pool, guest_id).await?;
    let subscriptions = Repo::list_subscriptions_for_guest(pool, guest_id).await?;
    let events = Repo::list_consent_events_for_guest(pool, guest_id, 50).await?;
    Ok(ConsentStatusResponse {
        subscriptions: to_topic_preferences(&subscriptions),
        events,
    })
}

// ----------------------------------------------------------------------
// Public unsubscribe
// ----------------------------------------------------------------------

fn guest_id_from_token(token: &str) -> Result<i64, ApiError> {
    tokens::verify_unsubscribe_token(token)
        .ok_or_else(|| ApiError::NotFound("Invalid unsubscribe link".to_string()))
}

pub async fn unsubscribe_view(pool: &DbPool, token: &str) -> Result<PreferencesResponse, ApiError> {
    let guest_id = guest_id_from_token(token)?;
    get_preferences(pool, guest_id).await
}

pub async fn unsubscribe_apply(
    pool: &DbPool,
    token: &str,
    input: UnsubscribeApplyInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<PreferencesResponse, ApiError> {
    let guest_id = guest_id_from_token(token)?;
    let email = Repo::get_guest_email(pool, guest_id).await?;
    let global = input.global.unwrap_or(false);
    let changes: Vec<(String, bool)> = if global {
        validation::TOPICS
            .iter()
            .map(|t| ((*t).to_string(), false))
            .collect()
    } else {
        let topic = input
            .topic
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("topic or global is required".to_string()))?;
        vec![(validation::validate_topic(topic)?, false)]
    };
    apply_preference_changes(
        pool,
        PreferenceChangeRequest {
            guest_id,
            changes: &changes,
            source: "unsubscribe_link",
            policy_version: None,
            actor_type: "guest",
            actor_user_id: None,
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;
    if global
        && let Some(email) = email
        && let Ok(email) = validation::validate_email(&email)
    {
        let draft = validation::validate_suppression_input(SuppressionInput {
            email,
            reason: "unsubscribe".to_string(),
            notes: None,
        })?;
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        Repo::insert_suppression_tx(&mut tx, &draft, Some("unsubscribe_link")).await?;
        AuditLog::log_event_tx(
            &mut tx,
            AuditEvent {
                user_id: None,
                action: "consent.opt_out",
                resource_type: "guest",
                resource_id: Some(guest_id),
                details: Some(json!({ "global": true })),
                ip_address,
                user_agent,
            },
        )
        .await?;
        tx.commit().await.map_err(ApiError::from)?;
    }
    get_preferences(pool, guest_id).await
}
