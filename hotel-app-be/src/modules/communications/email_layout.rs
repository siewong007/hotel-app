//! Shared chrome for guest-facing transactional email.
//!
//! Gmail and Outlook strip `<style>` blocks and most CSS. The layout is
//! table-based with inline styles so the branded header still renders.

use super::validation::html_escape;

pub struct Cta<'a> {
    pub label: &'a str,
    pub url: &'a str,
}

pub struct GuestEmail<'a> {
    pub preheader: &'a str,
    pub heading: &'a str,
    pub inner_html: &'a str,
    pub inner_text: &'a str,
    pub cta: Option<Cta<'a>>,
}

pub struct RenderedEmail {
    pub html: String,
    pub text: String,
}

pub fn hotel_display_name() -> String {
    std::env::var("SMTP_FROM_NAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Salim Inn".to_string())
}

pub fn public_base_url() -> String {
    std::env::var("PUBLIC_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://localhost:3000".to_string())
        .trim_end_matches('/')
        .to_string()
}

pub fn absolute_url(path: &str) -> String {
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{}{path}", public_base_url())
}

/// Host portion of the configured public base URL, e.g. `saliminn.my`.
///
/// Shown in the identity seal so a guest can compare what the mail claims
/// against the address they reach by typing the hotel's name themselves.
pub fn canonical_host() -> String {
    host_of(&public_base_url())
}

/// Pure form of [`canonical_host`].
///
/// Split out so tests never have to mutate `PUBLIC_BASE_URL`: the lib tests
/// share one process, so an env-var assertion races every other test that
/// reads the same variable.
fn host_of(base: &str) -> String {
    let without_scheme = base.split_once("://").map(|(_, rest)| rest).unwrap_or(base);
    without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(without_scheme)
        .to_string()
}

/// A visual identity block naming the hotel and its canonical host.
///
/// This is an identity *cue*, not proof. The markup is ordinary HTML and
/// anyone can copy it, so the seal says so in as many words and points the
/// guest at the two controls that actually establish authenticity: the
/// sender-domain authentication their mail provider checks, and reaching the
/// hotel by typing its address rather than following a link. Claiming more
/// than that -- "verified", "certified", a delivery guarantee -- would teach
/// guests to trust a graphic a phisher can reproduce in an afternoon.
pub fn identity_seal_html() -> String {
    seal_html_for(&hotel_display_name(), &canonical_host())
}

fn seal_html_for(hotel_name: &str, host_name: &str) -> String {
    let hotel = html_escape(hotel_name);
    let host = html_escape(host_name);
    format!(
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" \
         style=\"margin:26px 0 4px;border-collapse:collapse;\">\
           <tr>\
             <td style=\"padding:14px 16px;background:#fffdf7;border:1px solid #d9b572;\
                  border-radius:10px;font-family:Arial,Helvetica,sans-serif;\">\
               <div style=\"font-family:Georgia,'Times New Roman',serif;font-size:15px;\
                    letter-spacing:0.06em;color:#102a21;\">{hotel}</div>\
               <div style=\"font-size:12px;color:#5b7268;padding-top:2px;\">{host}</div>\
               <div style=\"font-size:11px;color:#5b7268;line-height:1.5;padding-top:8px;\">\
                 This seal is a visual cue only and can be copied. What actually proves \
                 this mail is ours is your provider's sender-domain check, and reaching \
                 {host} by typing it yourself rather than following a link.\
               </div>\
             </td>\
           </tr>\
         </table>"
    )
}

/// Plain-text counterpart of [`identity_seal_html`], carrying the same caveat.
pub fn identity_seal_text() -> String {
    seal_text_for(&hotel_display_name(), &canonical_host())
}

fn seal_text_for(hotel: &str, host: &str) -> String {
    format!(
        "-- {hotel} ({host}) --\n\
         This seal is a visual cue only and can be copied. What actually proves this mail \
         is ours is your provider's sender-domain check, and reaching {host} by typing it \
         yourself rather than following a link.\n"
    )
}

/// Label/value rows as an email-safe table. Values are escaped.
pub fn details_table(rows: &[(&str, &str)]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut html = String::from(
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" \
         style=\"margin:20px 0;border-collapse:collapse;\">",
    );
    for (i, (label, value)) in rows.iter().enumerate() {
        let border = if i + 1 == rows.len() {
            "none"
        } else {
            "1px solid #e6eee9"
        };
        html.push_str(&format!(
            "<tr>\
               <td style=\"padding:10px 0;border-bottom:{border};width:38%;\
                    font-size:13px;color:#5b7268;font-family:Arial,Helvetica,sans-serif;\">{label}</td>\
               <td style=\"padding:10px 0;border-bottom:{border};\
                    font-size:14px;color:#102a21;font-weight:700;\
                    font-family:Arial,Helvetica,sans-serif;\">{value}</td>\
             </tr>",
            label = html_escape(label),
            value = html_escape(value),
        ));
    }
    html.push_str("</table>");
    html
}

pub fn render(email: GuestEmail<'_>) -> RenderedEmail {
    let hotel = hotel_display_name();
    let hotel_html = html_escape(&hotel);
    let heading = html_escape(email.heading);
    let preheader = html_escape(email.preheader);
    let site = public_base_url();
    let cta_html = match email.cta {
        Some(Cta { label, url }) => format!(
            "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin:28px 0 8px;\">\
               <tr>\
                 <td bgcolor=\"#0E8C6A\" style=\"border-radius:8px;\">\
                   <a href=\"{url}\" style=\"display:inline-block;padding:12px 22px;color:#ffffff;\
                      text-decoration:none;font-weight:700;font-size:14px;\
                      font-family:Arial,Helvetica,sans-serif;\">{label}</a>\
                 </td>\
               </tr>\
             </table>",
            url = html_escape(url),
            label = html_escape(label),
        ),
        None => String::new(),
    };
    let html = format!(
        "<!DOCTYPE html>\
<html lang=\"en\">\
<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head>\
<body style=\"margin:0;padding:0;background:#f4f7f4;\">\
  <div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;\">{preheader}</div>\
  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f4f7f4;\">\
    <tr>\
      <td align=\"center\" style=\"padding:24px 12px;\">\
        <table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" \
               style=\"max-width:600px;width:100%;background:#ffffff;border-radius:12px;\
                       overflow:hidden;border:1px solid #e6eee9;\">\
          <tr>\
            <td style=\"background:#102a21;padding:22px 28px;\">\
              <div style=\"font-family:Georgia,'Times New Roman',serif;font-size:22px;\
                          letter-spacing:0.08em;color:#fffdf7;\">{hotel_html}</div>\
            </td>\
          </tr>\
          <tr><td style=\"height:4px;background:#d9b572;font-size:0;line-height:0;\">&nbsp;</td></tr>\
          <tr>\
            <td style=\"padding:28px;font-family:Arial,Helvetica,sans-serif;color:#102a21;\
                        font-size:15px;line-height:1.55;\">\
              <h1 style=\"margin:0 0 16px;font-size:22px;font-weight:700;color:#102a21;\">{heading}</h1>\
              {inner}\
              {cta}\
            </td>\
          </tr>\
          <tr>\
            <td style=\"padding:16px 28px 24px;background:#f4f7f4;font-family:Arial,Helvetica,sans-serif;\
                        font-size:12px;line-height:1.5;color:#5b7268;\">\
              This message was sent by {hotel_html}.\
              <br><a href=\"{site}\" style=\"color:#0E8C6A;text-decoration:none;\">{site}</a>\
            </td>\
          </tr>\
        </table>\
      </td>\
    </tr>\
  </table>\
</body>\
</html>",
        inner = email.inner_html,
        cta = cta_html,
    );

    let mut text = format!("{hotel}\n{heading}\n\n{}\n", email.inner_text.trim());
    if let Some(Cta { label, url }) = email.cta {
        text.push_str(&format!("\n{label}: {url}\n"));
    }
    text.push_str(&format!("\nThis message was sent by {hotel}.\n{site}\n"));

    RenderedEmail { html, text }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> GuestEmail<'static> {
        GuestEmail {
            preheader: "Reservation BK-1 is pending payment",
            heading: "Reservation received",
            inner_html: "<p>Dear Guest,</p><p>Please pay.</p>",
            inner_text: "Dear Guest,\nPlease pay.",
            cta: Some(Cta {
                label: "Complete payment",
                url: "https://saliminn.my/guest-checkin",
            }),
        }
    }

    #[test]
    fn render_wraps_body_in_hotel_chrome() {
        let rendered = render(sample());
        assert!(
            rendered.html.contains("Salim Inn"),
            "html should show the hotel name: {}",
            rendered.html
        );
        assert!(
            rendered.html.contains("<table"),
            "html should use table layout for email clients"
        );
        assert!(rendered.html.contains("Dear Guest"));
        assert!(rendered.html.contains("Reservation received"));
        assert!(
            rendered
                .html
                .contains("Reservation BK-1 is pending payment")
        );
    }

    #[test]
    fn render_includes_cta_and_plain_text() {
        let rendered = render(sample());
        assert!(rendered.html.contains("https://saliminn.my/guest-checkin"));
        assert!(rendered.html.contains("Complete payment"));
        assert!(rendered.text.contains("Salim Inn"));
        assert!(rendered.text.contains("Dear Guest"));
        assert!(rendered.text.contains("Complete payment"));
        assert!(rendered.text.contains("https://saliminn.my/guest-checkin"));
        assert!(!rendered.text.contains("<table"));
    }

    #[test]
    fn render_escapes_heading_and_preheader() {
        let rendered = render(GuestEmail {
            preheader: "hi <script>",
            heading: "Stay <b>soon</b>",
            inner_html: "<p>ok</p>",
            inner_text: "ok",
            cta: None,
        });
        assert!(!rendered.html.contains("<script>"));
        assert!(rendered.html.contains("hi &lt;script&gt;"));
        assert!(rendered.html.contains("Stay &lt;b&gt;soon&lt;/b&gt;"));
    }

    #[test]
    fn details_table_escapes_values() {
        let html = details_table(&[("Room", "Deluxe <King>")]);
        assert!(html.contains("Deluxe &lt;King&gt;"));
        assert!(!html.contains("Deluxe <King>"));
        assert!(html.contains("Room"));
    }

    #[test]
    fn the_identity_seal_names_the_hotel_and_host_without_claiming_verification() {
        let html = seal_html_for("Salim Inn", "saliminn.my");
        let text = seal_text_for("Salim Inn", "saliminn.my");
        for rendered in [&html, &text] {
            assert!(rendered.contains("saliminn.my"), "seal must name the host");
            assert!(
                rendered.contains("can be copied"),
                "the seal must admit it is only a cue"
            );
            assert!(
                rendered.contains("sender-domain"),
                "the seal must point at the control that actually authenticates"
            );
        }

        // Overclaiming would teach guests to trust a graphic a phisher can
        // reproduce, which is worse than showing no seal at all.
        let lowered = format!("{html}{text}").to_lowercase();
        for forbidden in ["verified", "certified", "guaranteed", "authenticated by"] {
            assert!(
                !lowered.contains(forbidden),
                "the seal must not claim {forbidden}"
            );
        }
    }

    #[test]
    fn seal_escapes_a_hostile_hotel_name() {
        let html = seal_html_for("<script>x</script>", "example.test");
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn canonical_host_strips_scheme_path_and_query() {
        assert_eq!(host_of("https://example.test/booking?x=1"), "example.test");
        assert_eq!(host_of("https://saliminn.my/"), "saliminn.my");
        assert_eq!(host_of("http://localhost:3000"), "localhost:3000");
        assert_eq!(host_of("example.test"), "example.test");
    }

    #[test]
    fn absolute_url_joins_public_base() {
        unsafe {
            std::env::set_var("PUBLIC_BASE_URL", "https://saliminn.my/");
        }
        assert_eq!(
            absolute_url("/guest-checkin"),
            "https://saliminn.my/guest-checkin"
        );
        assert_eq!(absolute_url("portal"), "https://saliminn.my/portal");
    }
}
