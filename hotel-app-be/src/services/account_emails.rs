//! Account-lifecycle email: the address-verification message.
//!
//! This exists because minting a verification token and sending it were
//! separate concerns, and only the minting half was ever written.
//! `AuthService::create_email_verification_token` wrote a token to
//! `users.email_verification_token` and nothing anywhere composed a mail — so
//! every account created with an email address sat at `is_verified = false`
//! forever, `login` refused it (`SKIP_EMAIL_VERIFICATION` must be false in
//! production), and `resend_verification` answered "a new email has been sent"
//! while sending nothing.
//!
//! [`send_email_verification`] therefore does BOTH: no caller can mint a token
//! without queueing the mail that carries it.
//!
//! ## Why the delivery is filed as `booking_confirmation`
//!
//! `email_deliveries.kind` and `.topic` are closed CHECK lists, and extending
//! them costs a catalog patch registered in four places. This module follows
//! the workaround `booking_emails` already documents and reuses an allowed
//! pair. The consequences are benign and deliberate:
//!
//! - `booking_confirmation` is in `validation::TRANSACTIONAL_KINDS`, so the
//!   worker sends it without a per-topic subscription — correct for a mail the
//!   guest cannot opt out of and still reach their account. Hard suppressions
//!   (bounce, complaint, manual) still apply, which is also correct.
//! - No `notification_subscriptions` row can exist for that topic (it is not in
//!   `validation::TOPICS`), so nothing about it appears in guest preferences.
//!
//! The one real cost is the label: an admin reading the notification centre
//! sees these rows under the transactional tier tagged `booking_confirmation`.
//! Give them their own `email_verification` kind when a schema patch is being
//! written for other reasons.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::i18n::{DEFAULT_LOCALE, DEFAULT_LOCALE_SETTING_KEY, Locale};
use crate::core::settings_cache;
use crate::modules::communications::email_layout::{self, Cta, GuestEmail};
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::validation::html_escape;

/// The account fields a verification mail needs, resolved in one read.
#[derive(sqlx::FromRow)]
struct VerificationRecipient {
    guest_id: Option<i64>,
    email: Option<String>,
    full_name: Option<String>,
    guest_locale: Option<String>,
}

/// Mint an email-verification token for `user_id` and queue the mail carrying it.
///
/// Best-effort by contract: returns `Ok(())` without sending when the account
/// has no deliverable address or no guest profile to file the delivery against
/// (`email_deliveries.guest_id` is NOT NULL). Registration must not fail
/// because a mail could not be composed — the account is already committed, and
/// the guest can ask for another link.
pub async fn send_email_verification(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
    let recipient = sqlx::query_as::<_, VerificationRecipient>(
        "SELECT u.guest_id, u.email, u.full_name, g.language_preference AS guest_locale \
         FROM users u LEFT JOIN guests g ON g.id = u.guest_id \
         WHERE u.id = $1 AND u.deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;

    let Some(recipient) = recipient else {
        return Ok(());
    };

    // Accounts registered without an address carry a reserved, non-deliverable
    // one (`<username>@no-email.invalid`) and are already `is_verified = true`,
    // so there is nothing to verify and nowhere to send it.
    let Some(email) = recipient
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.ends_with("@no-email.invalid"))
    else {
        return Ok(());
    };

    let Some(guest_id) = recipient.guest_id else {
        log::warn!(
            "Skipping verification email for user {user_id}: no guest profile to file it against"
        );
        return Ok(());
    };

    let hotel_default =
        settings_cache::get_string(pool, DEFAULT_LOCALE_SETTING_KEY, DEFAULT_LOCALE).await;
    let locale = Locale::resolve([recipient.guest_locale.as_deref(), Some(&hotel_default)]);

    // Minted last, so a token only ever exists alongside a queued mail.
    let token = AuthService::create_email_verification_token(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;
    let verify_url = email_layout::absolute_url(&format!("/verify-email?token={token}"));

    let (subject, body_html, body_text) = verification_mail(
        locale,
        recipient.full_name.as_deref().unwrap_or_default(),
        &verify_url,
    );

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: email,
            subject: &subject,
            body_html: &body_html,
            body_text: Some(&body_text),
            voucher_id: None,
            // Unique per send: each call mints a fresh token, so a resend must
            // produce a fresh mail rather than being swallowed as a duplicate.
            // Deliberately carries no token material — this column is stored in
            // the clear and is readable from the admin notification centre.
            idempotency_key: &format!(
                "email-verification:{user_id}:{}",
                chrono::Utc::now().timestamp_millis()
            ),
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)
}

/// Best-effort wrapper for callers that must not fail on a mail problem.
pub async fn try_send_email_verification(pool: &DbPool, user_id: i64) {
    if let Err(error) = send_email_verification(pool, user_id).await {
        log::error!("Failed to queue verification email for user {user_id}: {error}");
    }
}

/// Render the verification mail. Pure, so the link and the wording are testable
/// without a database.
fn verification_mail(
    locale: Locale,
    full_name: &str,
    verify_url: &str,
) -> (String, String, String) {
    let hotel = email_layout::hotel_display_name();
    let subject = locale.format("email.verifyEmail.subject", &[("hotel", &hotel)]);
    let greeting = locale.format("email.greeting", &[("name", &html_escape(full_name))]);
    let inner_html = format!(
        "<p>{greeting}</p><p>{}</p>",
        locale.message("email.verifyEmail.bodyHtml")
    );
    let inner_text = format!(
        "{}\n{}",
        locale.format("email.greeting", &[("name", full_name)]),
        locale.message("email.verifyEmail.bodyText")
    );

    let rendered = email_layout::render(GuestEmail {
        preheader: &locale.format("email.verifyEmail.preheader", &[("hotel", &hotel)]),
        heading: locale.message("email.verifyEmail.heading"),
        inner_html: &inner_html,
        inner_text: &inner_text,
        cta: Some(Cta {
            label: locale.message("email.cta.verifyEmail"),
            url: verify_url,
        }),
    });

    (subject, rendered.html, rendered.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locale(tag: &str) -> Locale {
        Locale::parse(tag).expect("test locale is supported")
    }

    #[test]
    fn verification_mail_carries_the_tokenised_link_in_both_parts() {
        let url = "https://saliminn.my/verify-email?token=deadbeefcafebabe";
        let (subject, html, text) = verification_mail(locale("en"), "Aisha Rahman", url);

        assert!(subject.contains("Verify"), "unexpected subject: {subject}");
        assert!(html.contains(url), "the HTML part must carry the link");
        assert!(
            text.contains(url),
            "the plain-text part must carry it too — a text-only client is \
             otherwise handed an account it can never activate"
        );
    }

    #[test]
    fn verification_mail_is_localised() {
        let url = "https://saliminn.my/verify-email?token=deadbeefcafebabe";
        let (subject_en, ..) = verification_mail(locale("en"), "Aisha", url);
        let (subject_ms, _, text_ms) = verification_mail(locale("ms"), "Aisha", url);

        assert_ne!(
            subject_en, subject_ms,
            "a Malay-speaking guest must not be sent the English subject"
        );
        assert!(text_ms.contains(url));
    }

    #[test]
    fn verification_mail_escapes_a_name_carrying_markup() {
        let url = "https://saliminn.my/verify-email?token=deadbeefcafebabe";
        let (_, html, _) = verification_mail(locale("en"), "<script>alert(1)</script>", url);
        assert!(
            !html.contains("<script>"),
            "a guest-supplied name must not reach the HTML body unescaped"
        );
    }
}
