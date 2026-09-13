//! Guest-facing booking lifecycle emails queued from staff actions.
//!
//! Two triggers live here:
//!
//! * a booking becoming `confirmed` (staff create, or a staff edit that moves
//!   the status into `confirmed`), and
//! * a payment being confirmed for a booking (staff approving a pending
//!   bank-transfer claim).
//!
//! Both reuse the `booking_confirmation` kind/topic: the schema's
//! `email_deliveries_kind_check` / `email_deliveries_topic_check` allow that
//! pair with `campaign_id IS NULL` (see `database/postgres/patches/0008`), so
//! neither trigger needs a schema change. Each carries a stable idempotency
//! key, so a repeated staff action queues exactly one email.
//!
//! Every sender is a no-op when the guest has no email on file — that is the
//! "(if available)" contract, not an error.
//!
//! Both are written in the guest's own language. The worker sends these
//! minutes after the staff action that queued them, with no request and no
//! session to consult, so the language is resolved here at render time from
//! `guests.language_preference` and frozen into the stored subject and body.
//! See `core::i18n`.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::i18n::{DEFAULT_LOCALE, DEFAULT_LOCALE_SETTING_KEY, Locale};
use crate::core::settings_cache;
use crate::modules::communications::email_layout::{self, Cta, GuestEmail};
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::validation::html_escape;
use crate::services::guest_portal;

/// Booking + guest fields shared by both emails.
#[derive(sqlx::FromRow)]
struct BookingEmailSource {
    guest_id: i64,
    /// The booking nickname. Legal name, when it exists, lives in the two
    /// fields below and wins — see `display_guest_name`.
    guest_name: Option<String>,
    guest_first_name: Option<String>,
    guest_last_name: Option<String>,
    guest_email: Option<String>,
    booking_number: Option<String>,
    check_in_date: chrono::NaiveDate,
    check_out_date: chrono::NaiveDate,
    total_amount: rust_decimal::Decimal,
    tourism_tax_amount: rust_decimal::Decimal,
    extra_bed_charge: rust_decimal::Decimal,
    currency: Option<String>,
    room_number: Option<String>,
    room_type: Option<String>,
    /// `guests.language_preference`. Unvalidated free text as far as this
    /// struct is concerned — `Locale::parse` decides whether it names a
    /// language we still ship.
    guest_locale: Option<String>,
}

impl BookingEmailSource {
    /// Mail goes out both before and after check-in, so this follows the same
    /// rule as invoices: the legal name once check-in has supplied both halves,
    /// the booking nickname until then.
    fn guest_name(&self, locale: Locale) -> String {
        let display = crate::models::guest::display_guest_name(
            self.guest_name.as_deref().unwrap_or_default(),
            self.guest_first_name.as_deref(),
            self.guest_last_name.as_deref(),
        );
        if display.is_empty() {
            locale.message("email.fallback.guest").to_string()
        } else {
            display
        }
    }

    fn booking_label(&self, locale: Locale) -> &str {
        self.booking_number
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| locale.message("email.fallback.booking"))
    }

    fn nights(&self) -> i64 {
        (self.check_out_date - self.check_in_date).num_days().max(0)
    }

    /// `"MYR 250.00"` — the booking's own currency, falling back to a bare
    /// amount when the column is null.
    fn money(&self, amount: rust_decimal::Decimal) -> String {
        match self
            .currency
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(currency) => format!("{} {}", currency, amount.round_dp(2)),
            None => amount.round_dp(2).to_string(),
        }
    }

    fn stay_block_html(&self, locale: Locale) -> String {
        let room = format!(
            "{} ({})",
            self.room_number.as_deref().unwrap_or("-"),
            self.room_type.as_deref().unwrap_or("-"),
        );
        let stay = locale.format(
            "email.stay.range",
            &[
                ("from", &locale.format_date(self.check_in_date)),
                ("to", &locale.format_date(self.check_out_date)),
                ("nights", &self.nights().to_string()),
            ],
        );
        let total = self.money(self.total_amount);
        email_layout::details_table(&[
            (
                locale.message("email.labels.booking"),
                self.booking_label(locale),
            ),
            (locale.message("email.labels.room"), &room),
            (locale.message("email.labels.stay"), &stay),
            (locale.message("email.labels.total"), &total),
        ])
    }

    fn stay_block_text(&self, locale: Locale) -> String {
        locale.format(
            "email.stay.text",
            &[
                ("booking", self.booking_label(locale)),
                ("room", self.room_number.as_deref().unwrap_or("-")),
                ("roomType", self.room_type.as_deref().unwrap_or("-")),
                ("from", &locale.format_date(self.check_in_date)),
                ("to", &locale.format_date(self.check_out_date)),
                ("nights", &self.nights().to_string()),
                ("total", &self.money(self.total_amount)),
            ],
        )
    }
}

/// Load the booking's guest-mail context. Returns `None` when the booking is
/// gone or the guest has no usable email address, so callers can treat both as
/// "nothing to send".
async fn load_source(
    pool: &DbPool,
    booking_id: i64,
) -> Result<Option<(BookingEmailSource, String)>, ApiError> {
    let source = sqlx::query_as::<_, BookingEmailSource>(
        r#"
        SELECT g.id AS guest_id,
               g.nick_name AS guest_name,
               g.first_name AS guest_first_name,
               g.last_name AS guest_last_name,
               g.email AS guest_email,
               b.booking_number,
               b.check_in_date,
               b.check_out_date,
               b.total_amount,
               COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) AS extra_bed_charge,
               b.currency,
               r.room_number,
               rt.name AS room_type,
               g.language_preference AS guest_locale
        FROM bookings b
        JOIN guests g ON g.id = b.guest_id
        LEFT JOIN rooms r ON r.id = b.room_id
        LEFT JOIN room_types rt ON rt.id = r.room_type_id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;

    let Some(source) = source else {
        return Ok(None);
    };
    let Some(recipient) = source
        .guest_email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return Ok(None);
    };

    Ok(Some((source, recipient)))
}

/// Decide which language this guest's mail is written in.
///
/// The guest's own `language_preference` wins; a hotel that has configured a
/// `default_locale` supplies the house language for guests who never chose;
/// English is the floor. A stored value naming a language we no longer ship
/// falls through rather than failing the send.
async fn resolve_locale(pool: &DbPool, source: &BookingEmailSource) -> Locale {
    let hotel_default =
        settings_cache::get_string(pool, DEFAULT_LOCALE_SETTING_KEY, DEFAULT_LOCALE).await;
    Locale::resolve([source.guest_locale.as_deref(), Some(hotel_default.as_str())])
}

/// Queue one `email_deliveries` row in its own transaction. Callers run after
/// their own work has committed, so a mail failure can never roll back the
/// booking or payment change it describes.
async fn queue(
    pool: &DbPool,
    guest_id: i64,
    recipient: &str,
    subject: &str,
    body_html: &str,
    body_text: &str,
    idempotency_key: &str,
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: recipient,
            subject,
            body_html,
            body_text: Some(body_text),
            voucher_id: None,
            idempotency_key,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)
}

/// Guest-facing confirmation for a booking that has just become `confirmed`.
pub async fn queue_booking_confirmation_email(
    pool: &DbPool,
    booking_id: i64,
) -> Result<(), ApiError> {
    let Some((source, recipient)) = load_source(pool, booking_id).await? else {
        return Ok(());
    };

    let locale = resolve_locale(pool, &source).await;
    let hotel = email_layout::hotel_display_name();
    let booking = source.booking_label(locale);
    let subject = locale.format(
        "email.bookingConfirmed.subject",
        &[("hotel", &hotel), ("booking", booking)],
    );
    let portal = email_layout::absolute_url("/portal");
    // Values interpolated into the HTML body are escaped first; catalog
    // entries are developer-authored and carry their own markup.
    let inner_html = format!(
        "<p>{}</p><p>{}</p>{}<p>{}</p>",
        locale.format(
            "email.greeting",
            &[("name", &html_escape(&source.guest_name(locale)))]
        ),
        locale.format(
            "email.bookingConfirmed.bodyHtml",
            &[("booking", &html_escape(booking))]
        ),
        source.stay_block_html(locale),
        locale.message("email.bookingConfirmed.portalNote"),
    );
    let inner_text = format!(
        "{}\n{}\n{}\n{}",
        locale.format("email.greeting", &[("name", &source.guest_name(locale))]),
        locale.format("email.bookingConfirmed.bodyText", &[("booking", booking)]),
        source.stay_block_text(locale),
        locale.message("email.bookingConfirmed.portalNote"),
    );
    let preheader = locale.format(
        "email.bookingConfirmed.preheader",
        &[("hotel", &hotel), ("booking", booking)],
    );
    let rendered = email_layout::render(GuestEmail {
        preheader: &preheader,
        heading: locale.message("email.bookingConfirmed.heading"),
        inner_html: &inner_html,
        inner_text: &inner_text,
        cta: Some(Cta {
            label: locale.message("email.cta.viewBooking"),
            url: &portal,
        }),
    });

    queue(
        pool,
        source.guest_id,
        &recipient,
        &subject,
        &rendered.html,
        &rendered.text,
        &format!("booking-confirmed:{booking_id}"),
    )
    .await
}

/// Best-effort wrapper: a notification failure must never surface as a failed
/// booking confirmation that has already been committed.
pub async fn try_queue_booking_confirmation_email(pool: &DbPool, booking_id: i64) {
    if let Err(error) = queue_booking_confirmation_email(pool, booking_id).await {
        log::error!("Failed to queue booking confirmation email for booking {booking_id}: {error}");
    }
}

/// Guest-facing notification that a payment has been confirmed against a
/// booking, with the resulting paid/outstanding position.
/// Where the payment-confirmation mail's single call-to-action points.
///
/// With a booking token the guest goes straight into the pre-check-in wizard;
/// without one they go to the portal. The split follows the account, not the
/// booking: `/portal` is a sign-in wall to someone who never made an account,
/// and the wizard is the only pre-arrival surface reachable without one.
fn payment_confirmation_cta(locale: Locale, access_token: Option<&str>) -> (String, &'static str) {
    match access_token
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        Some(token) => (
            email_layout::absolute_url(&format!("/guest-checkin/form?token={token}")),
            locale.message("email.cta.preCheckIn"),
        ),
        None => (
            email_layout::absolute_url("/portal"),
            locale.message("email.cta.viewBooking"),
        ),
    }
}

pub async fn queue_payment_confirmation_email(
    pool: &DbPool,
    booking_id: i64,
    payment_id: i64,
) -> Result<(), ApiError> {
    let Some((source, recipient)) = load_source(pool, booking_id).await? else {
        return Ok(());
    };

    #[derive(sqlx::FromRow)]
    struct PaymentRow {
        amount: rust_decimal::Decimal,
        payment_method: String,
    }

    let Some(payment) = sqlx::query_as::<_, PaymentRow>(
        "SELECT amount, payment_method FROM payments WHERE id = $1 AND booking_id = $2",
    )
    .bind(payment_id)
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?
    else {
        return Ok(());
    };

    // Running position across every non-refund, non-deposit completed
    // payment, so the guest sees the balance that remains on their billable
    // charges rather than only this one instalment. Held deposits are
    // collateral, not charge payments.
    let paid = sqlx::query_scalar::<_, rust_decimal::Decimal>(
        r#"
        SELECT COALESCE(SUM(amount) FILTER (
            WHERE status = 'completed'
              AND COALESCE(payment_type, 'booking') NOT IN ('refund', 'deposit')
        ), 0)
        FROM payments
        WHERE booking_id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;

    let billable_total =
        source.total_amount + source.tourism_tax_amount + source.extra_bed_charge;
    let balance = (billable_total - paid).max(rust_decimal::Decimal::ZERO);
    let method = payment.payment_method.replace('_', " ");
    let locale = resolve_locale(pool, &source).await;
    let closing = if balance.is_zero() {
        locale.message("email.paymentConfirmed.settled")
    } else {
        locale.message("email.paymentConfirmed.outstanding")
    };

    let hotel = email_layout::hotel_display_name();
    let booking = source.booking_label(locale);
    let subject = locale.format(
        "email.paymentConfirmed.subject",
        &[("hotel", &hotel), ("booking", booking)],
    );
    // A guest with no portal account cannot use `/portal` at all — they would
    // arrive at a sign-in wall for an account they never created. Mint a
    // booking token for them instead; `payment_confirmation_cta` turns it into
    // a link to the one surface that works without an account.
    let access_token = if guest_portal::guest_has_portal_account(pool, source.guest_id).await {
        None
    } else {
        guest_portal::issue_booking_access_token(pool, booking_id, source.check_in_date).await
    };
    let (cta_url, cta_label) = payment_confirmation_cta(locale, access_token.as_deref());
    let paid_label = source.money(paid);
    let balance_label = source.money(balance);
    let amount_label = source.money(payment.amount);
    let extra = email_layout::details_table(&[
        (locale.message("email.labels.payment"), &amount_label),
        (locale.message("email.labels.method"), &method),
        (locale.message("email.labels.paymentsReceived"), &paid_label),
        (locale.message("email.labels.balance"), &balance_label),
    ]);
    let inner_html = format!(
        "<p>{}</p><p>{}</p>{}{}<p>{}</p>",
        locale.format(
            "email.greeting",
            &[("name", &html_escape(&source.guest_name(locale)))]
        ),
        locale.format(
            "email.paymentConfirmed.bodyHtml",
            &[
                ("amount", &html_escape(&amount_label)),
                ("method", &html_escape(&method)),
                ("booking", &html_escape(booking)),
            ]
        ),
        source.stay_block_html(locale),
        extra,
        closing,
    );
    let inner_text = format!(
        "{}\n{}\n{}\n{}: {}\n{}: {}\n{}",
        locale.format("email.greeting", &[("name", &source.guest_name(locale))]),
        locale.format(
            "email.paymentConfirmed.bodyText",
            &[
                ("amount", &amount_label),
                ("method", &method),
                ("booking", booking),
            ]
        ),
        source.stay_block_text(locale),
        locale.message("email.labels.paymentsReceived"),
        paid_label,
        locale.message("email.labels.balance"),
        balance_label,
        closing,
    );
    let preheader = locale.format(
        "email.paymentConfirmed.preheader",
        &[("hotel", &hotel), ("booking", booking)],
    );
    let rendered = email_layout::render(GuestEmail {
        preheader: &preheader,
        heading: locale.message("email.paymentConfirmed.heading"),
        inner_html: &inner_html,
        inner_text: &inner_text,
        cta: Some(Cta {
            label: cta_label,
            url: &cta_url,
        }),
    });

    queue(
        pool,
        source.guest_id,
        &recipient,
        &subject,
        &rendered.html,
        &rendered.text,
        &format!("payment-confirmed:{payment_id}"),
    )
    .await
}

/// Best-effort wrapper: a notification failure must never undo a staff payment
/// approval that has already been committed.
pub async fn try_queue_payment_confirmation_email(pool: &DbPool, booking_id: i64, payment_id: i64) {
    if let Err(error) = queue_payment_confirmation_email(pool, booking_id, payment_id).await {
        log::error!(
            "Failed to queue payment confirmation email for payment {payment_id} (booking {booking_id}): {error}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn source() -> BookingEmailSource {
        BookingEmailSource {
            guest_id: 1,
            guest_name: Some("Aisha Rahman".to_string()),
            guest_first_name: None,
            guest_last_name: None,
            guest_email: Some("aisha@example.com".to_string()),
            booking_number: Some("BK-2026-0042".to_string()),
            check_in_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 5).expect("valid date"),
            check_out_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 8).expect("valid date"),
            total_amount: Decimal::new(45000, 2),
            tourism_tax_amount: Decimal::ZERO,
            extra_bed_charge: Decimal::ZERO,
            currency: Some("MYR".to_string()),
            room_number: Some("1203".to_string()),
            room_type: Some("Deluxe King".to_string()),
            guest_locale: Some("ms".to_string()),
        }
    }

    fn locale(tag: &str) -> Locale {
        Locale::parse(tag).expect("test locale is supported")
    }

    #[test]
    fn stay_details_render_in_the_guest_s_language() {
        let source = source();
        let malay = source.stay_block_html(locale("ms"));

        assert!(
            malay.contains("Tempahan"),
            "missing the Malay 'Booking' label: {malay}"
        );
        assert!(
            malay.contains("Bilik"),
            "missing the Malay 'Room' label: {malay}"
        );
        assert!(
            malay.contains("Penginapan"),
            "missing the Malay 'Stay' label: {malay}"
        );
        assert!(
            malay.contains("Jumlah"),
            "missing the Malay 'Total' label: {malay}"
        );
        // August abbreviates to "Ogo" in Malay, not "Aug".
        assert!(
            malay.contains("05 Ogo 2026"),
            "check-in not localised: {malay}"
        );
        assert!(
            malay.contains("08 Ogo 2026"),
            "check-out not localised: {malay}"
        );
        assert!(
            !malay.contains("Aug"),
            "English month leaked into the Malay email: {malay}"
        );
    }

    #[test]
    fn stay_details_still_render_in_english_by_default() {
        let english = source().stay_block_html(Locale::default_locale());
        assert!(english.contains("Booking"));
        assert!(english.contains("05 Aug 2026"));
        assert!(english.contains("08 Aug 2026"));
    }

    #[test]
    fn plain_text_stay_block_is_localised_and_carries_every_field() {
        let text = source().stay_block_text(locale("ms"));
        for expected in [
            "Tempahan: BK-2026-0042",
            "Bilik: 1203 (Deluxe King)",
            "05 Ogo 2026",
            "08 Ogo 2026",
            "MYR 450.00",
        ] {
            assert!(text.contains(expected), "missing {expected:?} in: {text}");
        }
        assert!(
            !text.contains("{{"),
            "an unresolved placeholder reached the body: {text}"
        );
    }

    #[test]
    fn nights_are_counted_from_the_stay_dates() {
        assert_eq!(source().nights(), 3);
    }

    #[test]
    fn missing_guest_and_booking_names_fall_back_in_the_right_language() {
        let mut anonymous = source();
        anonymous.guest_name = None;
        anonymous.booking_number = Some("   ".to_string());

        assert_eq!(anonymous.guest_name(locale("ms")), "Tetamu");
        assert_eq!(anonymous.booking_label(locale("ms")), "tempahan anda");
        assert_eq!(anonymous.guest_name(Locale::default_locale()), "Guest");
        assert_eq!(
            anonymous.booking_label(Locale::default_locale()),
            "your booking"
        );
    }

    #[test]
    fn an_unsupported_stored_preference_degrades_to_english() {
        // A guest row holding a language we no longer ship must still receive
        // mail, in English — never a failed send.
        let resolved = Locale::resolve([Some("de-DE"), Some(DEFAULT_LOCALE)]);
        assert_eq!(resolved.as_str(), "en");
    }

    #[test]
    fn a_blank_stored_preference_falls_through_to_the_hotel_default() {
        let resolved = Locale::resolve([Some(""), Some("ms")]);
        assert_eq!(resolved.as_str(), "ms");
    }

    #[test]
    fn money_keeps_the_bookings_own_currency_regardless_of_language() {
        // Currency follows the booking, not the reader's interface language.
        let source = source();
        assert_eq!(source.money(Decimal::new(45000, 2)), "MYR 450.00");
        let mut no_currency = source;
        no_currency.currency = None;
        assert_eq!(no_currency.money(Decimal::new(12550, 2)), "125.50");
    }

    #[test]
    fn payment_confirmation_sends_an_account_holder_to_the_portal() {
        let (url, label) = payment_confirmation_cta(locale("en"), None);
        assert!(url.ends_with("/portal"), "unexpected CTA url: {url}");
        assert_eq!(label, "View your booking");
    }

    #[test]
    fn payment_confirmation_sends_an_accountless_guest_into_pre_check_in() {
        let (url, label) = payment_confirmation_cta(locale("en"), Some("deadbeefcafebabe"));
        assert!(
            url.ends_with("/guest-checkin/form?token=deadbeefcafebabe"),
            "an accountless guest must land in the wizard, not a sign-in wall: {url}"
        );
        assert_eq!(label, "Start online check-in");
    }

    #[test]
    fn payment_confirmation_cta_is_localised() {
        let (_, label) = payment_confirmation_cta(locale("ms"), Some("deadbeefcafebabe"));
        assert_eq!(label, "Mula daftar masuk dalam talian");
    }

    #[test]
    fn payment_confirmation_ignores_a_blank_token() {
        // A blank token would render `?token=` and send the guest to a page
        // that can only fail; the portal link is the safer fallback.
        let (url, _) = payment_confirmation_cta(locale("en"), Some("   "));
        assert!(url.ends_with("/portal"), "unexpected CTA url: {url}");
    }
}
