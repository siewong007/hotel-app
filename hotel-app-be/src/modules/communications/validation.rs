//! Input validation and template rendering for the communications module.

use std::collections::HashMap;

use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;

use super::models::{CampaignInput, SuppressionInput, TemplateInput};

pub const TOPICS: [&str; 3] = ["announcement", "promotion", "birthday_voucher"];
pub const CAMPAIGN_TYPES: [&str; 2] = ["announcement", "promotion"];
pub const SUPPRESSION_REASONS: [&str; 4] = ["unsubscribe", "bounce", "complaint", "manual"];

const MAX_BODY_CHARS: usize = 200_000;

#[derive(Debug, Clone)]
pub struct CampaignDraft {
    pub name: String,
    pub campaign_type: String,
    pub topic: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub template_id: Option<i64>,
    pub promotion_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct TemplateDraft {
    pub code: String,
    pub name: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub variables: Vec<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct SuppressionDraft {
    pub email: String,
    pub reason: String,
    pub notes: Option<String>,
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

/// Body HTML is authored by staff holding communications:compose; it is
/// intentionally NOT stripped, only bounded. Variable VALUES substituted into
/// it are always HTML-escaped by [`render_template`].
fn validate_body(value: &str, field: &str) -> Result<String, ApiError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} is required")));
    }
    if value.chars().count() > MAX_BODY_CHARS {
        return Err(ApiError::BadRequest(format!(
            "{field} cannot exceed {MAX_BODY_CHARS} characters"
        )));
    }
    Ok(value)
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn validate_topic(topic: &str) -> Result<String, ApiError> {
    let topic = topic.trim().to_ascii_lowercase();
    if TOPICS.contains(&topic.as_str()) {
        Ok(topic)
    } else {
        Err(ApiError::BadRequest(
            "Unsupported notification topic".to_string(),
        ))
    }
}

pub fn validate_email(value: &str) -> Result<String, ApiError> {
    let email = value.trim().to_ascii_lowercase();
    let len = email.chars().count();
    let shape_ok = (3..=255).contains(&len)
        && !email.contains(char::is_whitespace)
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'));
    if shape_ok {
        Ok(email)
    } else {
        Err(ApiError::BadRequest("Invalid email address".to_string()))
    }
}

pub fn validate_campaign_input(input: CampaignInput) -> Result<CampaignDraft, ApiError> {
    let campaign_type = input.campaign_type.trim().to_ascii_lowercase();
    if !CAMPAIGN_TYPES.contains(&campaign_type.as_str()) {
        return Err(ApiError::BadRequest(
            "Unsupported campaign type".to_string(),
        ));
    }
    let promotion_id = match (campaign_type.as_str(), input.promotion_id) {
        ("promotion", Some(promotion_id)) if promotion_id > 0 => Some(promotion_id),
        ("promotion", _) => {
            return Err(ApiError::BadRequest(
                "Promotion campaigns require a valid promotion".to_string(),
            ));
        }
        _ => None,
    };
    Ok(CampaignDraft {
        name: sanitize_required_text(&input.name, "name", 1, 160)?,
        topic: campaign_type.clone(),
        campaign_type,
        subject: sanitize_required_text(&input.subject, "subject", 1, 255)?,
        body_html: validate_body(&input.body_html, "body_html")?,
        body_text: sanitize_optional_text(input.body_text, "body_text", MAX_BODY_CHARS)?,
        template_id: input.template_id,
        promotion_id,
    })
}

pub fn validate_template_input(input: TemplateInput) -> Result<TemplateDraft, ApiError> {
    let code = input.code.trim().to_ascii_lowercase();
    if code.is_empty() || code.chars().count() > 50 || !is_identifier(&code) {
        return Err(ApiError::BadRequest(
            "Template code must be lowercase letters, digits, or underscores (max 50)".to_string(),
        ));
    }
    let variables = input.variables.unwrap_or_default();
    for variable in &variables {
        if !is_identifier(variable) || variable.chars().count() > 50 {
            return Err(ApiError::BadRequest(format!(
                "Invalid template variable name: {variable}"
            )));
        }
    }
    Ok(TemplateDraft {
        code,
        name: sanitize_required_text(&input.name, "name", 1, 100)?,
        subject: sanitize_required_text(&input.subject, "subject", 1, 255)?,
        body_html: validate_body(&input.body_html, "body_html")?,
        body_text: sanitize_optional_text(input.body_text, "body_text", MAX_BODY_CHARS)?,
        variables,
        is_active: input.is_active.unwrap_or(true),
    })
}

pub fn validate_suppression_input(input: SuppressionInput) -> Result<SuppressionDraft, ApiError> {
    let reason = input.reason.trim().to_ascii_lowercase();
    if !SUPPRESSION_REASONS.contains(&reason.as_str()) {
        return Err(ApiError::BadRequest(
            "Unsupported suppression reason".to_string(),
        ));
    }
    Ok(SuppressionDraft {
        email: validate_email(&input.email)?,
        reason,
        notes: sanitize_optional_text(input.notes, "notes", 1000)?,
    })
}

pub fn html_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

/// Substitutes `{{variable}}` tokens in `body`. Every referenced variable must
/// be in `allowed` and have a value in `vars`; values are HTML-escaped so a
/// substituted value can never inject markup.
pub fn render_template(
    body: &str,
    vars: &HashMap<String, String>,
    allowed: &[String],
) -> Result<String, ApiError> {
    let mut rendered = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(start) = rest.find("{{") {
        rendered.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return Err(ApiError::BadRequest(
                "Unterminated template variable".to_string(),
            ));
        };
        let name = after[..end].trim();
        if !allowed.iter().any(|a| a == name) {
            return Err(ApiError::BadRequest(format!(
                "Unknown template variable: {name}"
            )));
        }
        let Some(value) = vars.get(name) else {
            return Err(ApiError::BadRequest(format!(
                "Missing value for template variable: {name}"
            )));
        };
        rendered.push_str(&html_escape(value));
        rest = &after[end + 2..];
    }
    rendered.push_str(rest);
    Ok(rendered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn campaign_input(campaign_type: &str, promotion_id: Option<i64>) -> CampaignInput {
        CampaignInput {
            name: "Guest update".to_string(),
            campaign_type: campaign_type.to_string(),
            subject: "Your upcoming stay".to_string(),
            body_html: "<p>Welcome</p>".to_string(),
            body_text: None,
            template_id: None,
            promotion_id,
        }
    }

    #[test]
    fn announcement_discards_an_irrelevant_promotion_id() {
        let draft = validate_campaign_input(campaign_input("announcement", Some(999))).unwrap();

        assert_eq!(draft.campaign_type, "announcement");
        assert_eq!(draft.promotion_id, None);
    }

    #[test]
    fn promotion_requires_a_positive_promotion_id() {
        for promotion_id in [None, Some(0), Some(-1)] {
            assert!(validate_campaign_input(campaign_input("promotion", promotion_id)).is_err());
        }
        assert_eq!(
            validate_campaign_input(campaign_input("promotion", Some(4)))
                .unwrap()
                .promotion_id,
            Some(4)
        );
    }

    #[test]
    fn render_substitutes_and_escapes() {
        let vars = HashMap::from([("name".to_string(), "<b>Amy & Co</b>".to_string())]);
        let allowed = vec!["name".to_string()];
        let out = render_template("Hi {{name}}!", &vars, &allowed).unwrap();
        assert_eq!(out, "Hi &lt;b&gt;Amy &amp; Co&lt;/b&gt;!");
    }

    #[test]
    fn render_rejects_unknown_variable() {
        let vars = HashMap::new();
        assert!(render_template("{{evil}}", &vars, &[]).is_err());
    }

    #[test]
    fn render_rejects_unterminated_token() {
        let vars = HashMap::new();
        assert!(render_template("Hi {{name", &vars, &["name".to_string()]).is_err());
    }

    #[test]
    fn email_validation_normalizes() {
        assert_eq!(
            validate_email(" Jane@Example.COM ").unwrap(),
            "jane@example.com"
        );
        assert!(validate_email("nope").is_err());
        assert!(validate_email("a b@x.com").is_err());
    }
}
