use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;

pub const SUPPORT_CATEGORIES: &[&str] = &[
    "booking",
    "stay",
    "billing",
    "loyalty",
    "technical",
    "other",
];
pub const SUPPORT_PRIORITIES: &[&str] = &["low", "normal", "high", "urgent"];
pub const SUPPORT_STATUSES: &[&str] = &[
    "waiting_for_staff",
    "waiting_for_guest",
    "resolved",
    "closed",
];
pub const SUPPORT_ACTIONS: &[&str] = &[
    "claim",
    "assign",
    "release",
    "set_priority",
    "escalate",
    "resolve",
    "close",
    "reopen",
    "add_internal_note",
];

pub const MAX_MESSAGE_CHARS: usize = 4_000;
pub const MAX_REASON_CHARS: usize = 2_000;
pub const MAX_RESOLUTION_CODE_CHARS: usize = 100;

pub fn normalized_choice(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

pub fn validate_category(value: &str) -> Result<String, ApiError> {
    let normalized = normalized_choice(value);
    if SUPPORT_CATEGORIES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest("Unsupported support category".to_string()))
    }
}

pub fn validate_priority(value: &str) -> Result<String, ApiError> {
    let normalized = normalized_choice(value);
    if SUPPORT_PRIORITIES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest("Unsupported support priority".to_string()))
    }
}

pub fn validate_status(value: &str) -> Result<String, ApiError> {
    let normalized = normalized_choice(value);
    if SUPPORT_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest("Unsupported support status".to_string()))
    }
}

pub fn validate_action(value: &str) -> Result<String, ApiError> {
    let normalized = normalized_choice(value);
    if SUPPORT_ACTIONS.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest("Unsupported support action".to_string()))
    }
}

pub fn sanitize_required_message(value: &str) -> Result<String, ApiError> {
    let sanitized = Sanitizer::sanitize_notes(value).trim().to_string();
    if sanitized.is_empty() {
        return Err(ApiError::BadRequest("A support message is required".to_string()));
    }
    if sanitized.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Support messages cannot exceed {MAX_MESSAGE_CHARS} characters"
        )));
    }
    Ok(sanitized)
}

pub fn sanitize_optional_reason(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let sanitized = Sanitizer::sanitize_notes(&value).trim().to_string();
    if sanitized.is_empty() {
        return Ok(None);
    }
    if sanitized.chars().count() > MAX_REASON_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Support notes cannot exceed {MAX_REASON_CHARS} characters"
        )));
    }
    Ok(Some(sanitized))
}

pub fn sanitize_resolution_code(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let normalized = normalized_choice(&value);
    if normalized.is_empty() {
        return Ok(None);
    }
    if normalized.chars().count() > MAX_RESOLUTION_CODE_CHARS
        || !normalized.chars().all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err(ApiError::BadRequest("Invalid resolution code".to_string()));
    }
    Ok(Some(normalized))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_normalized_categories() {
        assert_eq!(validate_category(" STAY ").unwrap(), "stay");
        assert!(validate_category("maintenance").is_err());
    }

    #[test]
    fn strips_control_content_from_messages() {
        assert_eq!(sanitize_required_message(" Hello\u{0000} guest ").unwrap(), "Hello guest");
    }

    #[test]
    fn rejects_empty_messages() {
        assert!(sanitize_required_message(" \n ").is_err());
    }
}
