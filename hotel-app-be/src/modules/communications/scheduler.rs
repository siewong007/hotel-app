//! Communications scheduler: campaign fan-out and daily birthday vouchers.
//!
//! Campaign fan-out: campaigns whose `scheduled_at` has arrived move
//! scheduled→running, then eligible recipients are expanded in bounded
//! batches into the `email_deliveries` outbox (the worker does the actual
//! sending). Expansion is restart-safe: recipients are selected by "no
//! delivery row for this campaign yet" and inserts dedup on idempotency key.
//!
//! Birthday vouchers: once per hotel-local day, guests whose birthday is
//! today (Feb-29 birthdays are honoured on Feb-28 in non-leap years), hold a
//! live `birthday_voucher` subscription, and have not yet received this
//! year's voucher get — in ONE transaction — a voucher, an audit event, and a
//! queued email. Annual uniqueness is enforced by the partial unique index on
//! `vouchers (guest_id, source_reference)`, so retries and replicas cannot
//! double-issue.

use std::collections::HashMap;
use std::time::Duration;

use chrono::{Datelike, NaiveDate, Utc};
use serde_json::json;

use super::models::{AudienceGuest, EmailCampaign};
use super::repository::CommunicationsRepository as Repo;
use super::tokens;
use super::validation::{self, html_escape};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::services::audit::AuditLog;

const POLL_INTERVAL: Duration = Duration::from_secs(60);
const EXPANSION_BATCH: i64 = 200;

fn public_base_url() -> String {
    std::env::var("PUBLIC_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "http://localhost:3000".to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Standard per-guest variables available to campaign templates.
fn guest_vars(guest: &AudienceGuest) -> HashMap<String, String> {
    HashMap::from([
        ("first_name".to_string(), guest.first_name.clone()),
        ("full_name".to_string(), guest.full_name.clone()),
        ("email".to_string(), guest.email.clone()),
    ])
}

fn unsubscribe_footer_html(guest_id: i64) -> String {
    match tokens::sign_unsubscribe_token(guest_id) {
        Ok(token) => format!(
            "<p style=\"font-size:12px;color:#888\"><a href=\"{}/unsubscribe/{}\">Unsubscribe</a></p>",
            public_base_url(),
            token
        ),
        Err(_) => String::new(),
    }
}

pub fn spawn(pool: DbPool) {
    tokio::spawn(async move {
        log::info!(
            "Communications scheduler started (polling every {}s)",
            POLL_INTERVAL.as_secs()
        );
        let mut last_birthday_run: Option<NaiveDate> = None;
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if let Err(e) = tick_campaigns(&pool).await {
                log::warn!("Campaign scheduler tick failed: {e}");
            }
            match tick_birthdays(&pool, &mut last_birthday_run).await {
                Ok(issued) if issued > 0 => {
                    log::info!("Birthday scheduler issued {issued} voucher(s)")
                }
                Ok(_) => {}
                Err(e) => log::warn!("Birthday scheduler tick failed: {e}"),
            }
        }
    });
}

// ----------------------------------------------------------------------
// Campaign fan-out
// ----------------------------------------------------------------------

pub async fn tick_campaigns(pool: &DbPool) -> Result<usize, ApiError> {
    let due = Repo::due_scheduled_campaigns(pool).await?;
    let mut expanded = 0;
    for campaign in due {
        if !Repo::mark_campaign_running(pool, campaign.id).await? {
            continue; // another instance won the transition
        }
        expanded += expand_campaign(pool, &campaign).await?;
    }
    Ok(expanded)
}

/// Renders the per-guest body for a campaign delivery. Template render
/// failures fall back to the campaign's own body — one odd template must not
/// sink the whole send.
async fn campaign_body_for_guest(
    pool: &DbPool,
    campaign: &EmailCampaign,
    guest: &AudienceGuest,
) -> String {
    let base = match campaign.template_id {
        Some(template_id) => match Repo::get_template(pool, template_id).await {
            Ok(Some(template)) => validation::render_template(
                &template.body_html,
                &guest_vars(guest),
                &template.variables,
            )
            .unwrap_or_else(|_| campaign.body_html.clone()),
            _ => campaign.body_html.clone(),
        },
        None => campaign.body_html.clone(),
    };
    format!("{base}{}", unsubscribe_footer_html(guest.id))
}

async fn expand_campaign(pool: &DbPool, campaign: &EmailCampaign) -> Result<usize, ApiError> {
    let mut total = 0;
    loop {
        let batch =
            Repo::audience_batch(pool, &campaign.topic, campaign.id, EXPANSION_BATCH).await?;
        if batch.is_empty() {
            break;
        }
        for guest in &batch {
            let body_html = campaign_body_for_guest(pool, campaign, guest).await;
            let idempotency_key = format!("campaign:{}:guest:{}", campaign.id, guest.id);
            let mut tx = pool.begin().await.map_err(ApiError::from)?;
            Repo::insert_delivery_tx(
                &mut tx,
                Some(campaign.id),
                "campaign",
                guest.id,
                &campaign.topic,
                &guest.email,
                &campaign.subject,
                &body_html,
                campaign.body_text.as_deref(),
                None,
                &idempotency_key,
            )
            .await?;
            tx.commit().await.map_err(ApiError::from)?;
            total += 1;
        }
    }
    Repo::refresh_campaign_total(pool, campaign.id).await?;
    // A campaign with zero recipients completes immediately once running.
    Repo::complete_campaign_if_done(pool, campaign.id).await?;
    log::info!("Campaign {} expanded to {total} recipient(s)", campaign.id);
    Ok(total)
}

// ----------------------------------------------------------------------
// Birthday vouchers
// ----------------------------------------------------------------------

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Month/day pairs honoured today. On Feb 28 of a non-leap year this also
/// covers Feb-29 birthdays (recommended default policy).
fn birthday_match_pairs(today: NaiveDate) -> ((i32, i32), (i32, i32)) {
    let primary = (today.month() as i32, today.day() as i32);
    if today.month() == 2 && today.day() == 28 && !is_leap_year(today.year()) {
        (primary, (2, 29))
    } else {
        (primary, primary)
    }
}

fn generate_birthday_voucher_code() -> String {
    let random = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .to_ascii_uppercase();
    format!("BDY{}", &random[..20])
}

pub async fn tick_birthdays(
    pool: &DbPool,
    last_run: &mut Option<NaiveDate>,
) -> Result<usize, ApiError> {
    if settings_cache::get_string(pool, "birthday_voucher_enabled", "false").await != "true" {
        return Ok(0);
    }
    let today = Repo::hotel_local_date(pool).await?;
    if *last_run == Some(today) {
        return Ok(0);
    }

    let promotion_id = settings_cache::get_i32(pool, "birthday_promotion_id", 0).await as i64;
    if promotion_id <= 0 {
        log::warn!("Birthday vouchers enabled but 'birthday_promotion_id' is not configured");
        *last_run = Some(today);
        return Ok(0);
    }
    match Repo::promotion_status(pool, promotion_id).await? {
        Some(status) if status == "published" => {}
        Some(status) => {
            log::warn!(
                "Birthday promotion {promotion_id} is '{status}', not 'published'; skipping issuance"
            );
            *last_run = Some(today);
            return Ok(0);
        }
        None => {
            log::warn!("Birthday promotion {promotion_id} does not exist; skipping issuance");
            *last_run = Some(today);
            return Ok(0);
        }
    }
    let expiry_days =
        settings_cache::get_positive_i32(pool, "birthday_voucher_expiry_days", 30).await as i64;
    let promotion_name = Repo::promotion_name(pool, promotion_id)
        .await?
        .unwrap_or_else(|| "your birthday reward".to_string());
    let hotel_name = settings_cache::get_string(pool, "hotel_name", "our hotel").await;
    let source_reference = format!("birthday:{}", today.year());
    let ((m1, d1), (m2, d2)) = birthday_match_pairs(today);

    let mut issued = 0;
    loop {
        let targets =
            Repo::birthday_targets(pool, m1, d1, m2, d2, &source_reference, EXPANSION_BATCH)
                .await?;
        if targets.is_empty() {
            break;
        }
        for guest in &targets {
            issued += issue_birthday_voucher(
                pool,
                guest,
                promotion_id,
                &promotion_name,
                &hotel_name,
                expiry_days,
                &source_reference,
            )
            .await?;
        }
    }
    *last_run = Some(today);
    Ok(issued)
}

/// One transaction per guest: voucher + audit + queued email. If the voucher
/// insert conflicts (already issued this year, or this promotion already gave
/// this guest a voucher in a previous year), nothing is written.
async fn issue_birthday_voucher(
    pool: &DbPool,
    guest: &AudienceGuest,
    promotion_id: i64,
    promotion_name: &str,
    hotel_name: &str,
    expiry_days: i64,
    source_reference: &str,
) -> Result<usize, ApiError> {
    let code = generate_birthday_voucher_code();
    let expires_at = Utc::now() + chrono::Duration::days(expiry_days);
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let Some(voucher_id) = Repo::insert_birthday_voucher_tx(
        &mut tx,
        promotion_id,
        guest.id,
        &code,
        expires_at,
        source_reference,
    )
    .await?
    else {
        tx.commit().await.map_err(ApiError::from)?;
        log::warn!(
            "Birthday voucher skipped for guest {}: voucher uniqueness conflict \
             (already issued this year, or promotion {promotion_id} previously issued to this guest)",
            guest.id
        );
        return Ok(0);
    };

    let expiry_text = expires_at.format("%Y-%m-%d").to_string();
    let subject = format!("Happy birthday from {hotel_name}!");
    let body_html = format!(
        "<p>Dear {first},</p>\
         <p>Happy birthday! As a thank-you for staying with us, here is your gift: \
         <strong>{promo}</strong>.</p>\
         <p>Your voucher code: <strong>{code}</strong> (valid until {expiry}). \
         You can also find it in your guest portal wallet.</p>\
         <p>Warm wishes,<br>{hotel}</p>{footer}",
        first = html_escape(&guest.first_name),
        promo = html_escape(promotion_name),
        code = html_escape(&code),
        expiry = expiry_text,
        hotel = html_escape(hotel_name),
        footer = unsubscribe_footer_html(guest.id),
    );

    AuditLog::log_event_tx(
        &mut tx,
        None,
        "voucher.birthday_issued",
        "voucher",
        Some(voucher_id),
        Some(json!({
            "guest_id": guest.id,
            "promotion_id": promotion_id,
            "source_reference": source_reference,
        })),
        None,
        None,
    )
    .await?;

    Repo::insert_delivery_tx(
        &mut tx,
        None,
        "birthday_voucher",
        guest.id,
        "birthday_voucher",
        &guest.email,
        &subject,
        &body_html,
        None,
        Some(voucher_id),
        &format!("{source_reference}:guest:{}", guest.id),
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feb29_policy_matches_feb28_in_non_leap_years() {
        let non_leap = NaiveDate::from_ymd_opt(2026, 2, 28).unwrap();
        assert_eq!(birthday_match_pairs(non_leap), ((2, 28), (2, 29)));

        let leap_feb28 = NaiveDate::from_ymd_opt(2028, 2, 28).unwrap();
        assert_eq!(birthday_match_pairs(leap_feb28), ((2, 28), (2, 28)));

        let leap_feb29 = NaiveDate::from_ymd_opt(2028, 2, 29).unwrap();
        assert_eq!(birthday_match_pairs(leap_feb29), ((2, 29), (2, 29)));

        let ordinary = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        assert_eq!(birthday_match_pairs(ordinary), ((7, 15), (7, 15)));
    }

    #[test]
    fn century_leap_rules() {
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(2026));
    }

    #[test]
    fn birthday_codes_have_distinct_prefix() {
        let code = generate_birthday_voucher_code();
        assert!(code.starts_with("BDY"));
        assert_eq!(code.len(), 23);
    }
}
