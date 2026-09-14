use std::collections::HashSet;

use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;

use super::models::{GuestPreferenceEntry, GuestPreferencesPut};

/// Allowed `guest_notes.interaction_type` values — mirrors the
/// `guest_notes_interaction_type_check` constraint added by patch
/// `0023_guest_relations.sql`. Keep in sync with the CHECK expression.
pub const INTERACTION_TYPES: &[&str] = &["note", "call", "email", "in_person", "follow_up"];
pub const DEFAULT_INTERACTION_TYPE: &str = "note";

/// Controlled vocabulary for `guest_preferences.category`. The column
/// (varchar(50)) has no CHECK constraint, so this allowlist is enforced at
/// the API boundary.
pub const PREFERENCE_CATEGORIES: &[&str] = &[
    "room",
    "bed",
    "floor",
    "dietary",
    "communication",
    "occasion",
    "other",
];

/// `guest_notes.subject` varchar(255).
pub const MAX_SUBJECT_CHARS: usize = 255;
/// `guest_notes.content` is an unbounded `text` column — capped like support
/// messages (`modules::support::validation::MAX_MESSAGE_CHARS`).
pub const MAX_CONTENT_CHARS: usize = 4_000;
/// `guest_preferences.preference_key` varchar(100).
pub const MAX_PREFERENCE_KEY_CHARS: usize = 100;
/// `guest_preferences.preference_value` is `text` — bounded product-side.
pub const MAX_PREFERENCE_VALUE_CHARS: usize = 2_000;
/// Batch bound for `PUT /guests/{id}/preferences` upserts.
pub const MAX_PREFERENCE_ENTRIES: usize = 100;
/// `guest_reviews.response` is `text` — capped like support reasons.
pub const MAX_REVIEW_RESPONSE_CHARS: usize = 2_000;

fn normalized_choice(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

/// Normalize and validate `guest_notes.interaction_type`. `None` or blank
/// falls back to the column default (`note`) — correct for creates. For
/// updates, where `None` must keep its "leave unchanged" meaning, call as
/// `input.interaction_type.as_deref().map(|v| validate_interaction_type(Some(v))).transpose()`.
pub fn validate_interaction_type(value: Option<&str>) -> Result<String, ApiError> {
    let normalized = value.map(normalized_choice).unwrap_or_default();
    if normalized.is_empty() {
        return Ok(DEFAULT_INTERACTION_TYPE.to_string());
    }
    if INTERACTION_TYPES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest(
            "Unsupported interaction type".to_string(),
        ))
    }
}

/// Normalize (lowercase) and validate `guest_preferences.category` against
/// the controlled vocabulary.
pub fn validate_preference_category(value: &str) -> Result<String, ApiError> {
    let normalized = normalized_choice(value);
    if PREFERENCE_CATEGORIES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::BadRequest(
            "Unsupported preference category".to_string(),
        ))
    }
}

/// `guest_preferences.preference_key` varchar(100): sanitized, non-empty.
pub fn validate_key(value: &str) -> Result<String, ApiError> {
    let key = Sanitizer::sanitize_text(value).trim().to_string();
    if key.is_empty() {
        return Err(ApiError::BadRequest(
            "Preference key is required".to_string(),
        ));
    }
    if key.chars().count() > MAX_PREFERENCE_KEY_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Preference keys cannot exceed {MAX_PREFERENCE_KEY_CHARS} characters"
        )));
    }
    Ok(key)
}

/// `guest_preferences.preference_value` text: sanitized, non-empty, bounded.
pub fn validate_value(value: &str) -> Result<String, ApiError> {
    let sanitized = Sanitizer::sanitize_text(value).trim().to_string();
    if sanitized.is_empty() {
        return Err(ApiError::BadRequest(
            "Preference value is required".to_string(),
        ));
    }
    if sanitized.chars().count() > MAX_PREFERENCE_VALUE_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Preference values cannot exceed {MAX_PREFERENCE_VALUE_CHARS} characters"
        )));
    }
    Ok(sanitized)
}

/// `guest_notes.subject` varchar(255): optional free text; blank sanitizes
/// to `None` (clears the column).
pub fn sanitize_subject(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let sanitized = Sanitizer::sanitize_text(&value).trim().to_string();
    if sanitized.is_empty() {
        return Ok(None);
    }
    if sanitized.chars().count() > MAX_SUBJECT_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Subjects cannot exceed {MAX_SUBJECT_CHARS} characters"
        )));
    }
    Ok(Some(sanitized))
}

/// `guest_notes.content` text: the required body of a note/interaction.
pub fn validate_content(value: &str) -> Result<String, ApiError> {
    let sanitized = Sanitizer::sanitize_notes(value).trim().to_string();
    if sanitized.is_empty() {
        return Err(ApiError::BadRequest("Note content is required".to_string()));
    }
    if sanitized.chars().count() > MAX_CONTENT_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Note content cannot exceed {MAX_CONTENT_CHARS} characters"
        )));
    }
    Ok(sanitized)
}

/// `guest_reviews.response` text: required when staff post a response.
pub fn validate_review_response(value: &str) -> Result<String, ApiError> {
    let sanitized = Sanitizer::sanitize_notes(value).trim().to_string();
    if sanitized.is_empty() {
        return Err(ApiError::BadRequest(
            "A review response is required".to_string(),
        ));
    }
    if sanitized.chars().count() > MAX_REVIEW_RESPONSE_CHARS {
        return Err(ApiError::BadRequest(format!(
            "Review responses cannot exceed {MAX_REVIEW_RESPONSE_CHARS} characters"
        )));
    }
    Ok(sanitized)
}

/// Validate a bulk preference upsert: bounds the batch, normalizes every
/// entry through the field validators, validates `replace_categories`, and
/// rejects duplicate `(category, preference_key)` pairs — a repeated pair
/// would hit `uq_guest_preferences_key` twice inside one upsert statement.
pub fn validate_preferences_put(
    input: GuestPreferencesPut,
) -> Result<GuestPreferencesPut, ApiError> {
    if input.entries.len() > MAX_PREFERENCE_ENTRIES {
        return Err(ApiError::BadRequest(format!(
            "Preference updates cannot contain more than {MAX_PREFERENCE_ENTRIES} entries"
        )));
    }
    let mut seen: HashSet<(String, String)> = HashSet::with_capacity(input.entries.len());
    let mut entries = Vec::with_capacity(input.entries.len());
    for entry in input.entries {
        let normalized = GuestPreferenceEntry {
            category: validate_preference_category(&entry.category)?,
            preference_key: validate_key(&entry.preference_key)?,
            preference_value: validate_value(&entry.preference_value)?,
        };
        if !seen.insert((
            normalized.category.clone(),
            normalized.preference_key.clone(),
        )) {
            return Err(ApiError::BadRequest(
                "Duplicate preference entry for category/key".to_string(),
            ));
        }
        entries.push(normalized);
    }
    let replace_categories = input
        .replace_categories
        .map(|categories| {
            categories
                .iter()
                .map(|category| validate_preference_category(category))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    Ok(GuestPreferencesPut {
        entries,
        replace_categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_interaction_type_to_note() {
        assert_eq!(validate_interaction_type(None).unwrap(), "note");
        assert_eq!(validate_interaction_type(Some("  ")).unwrap(), "note");
    }

    #[test]
    fn normalizes_interaction_type() {
        assert_eq!(
            validate_interaction_type(Some("In Person")).unwrap(),
            "in_person"
        );
        assert_eq!(
            validate_interaction_type(Some("follow-up")).unwrap(),
            "follow_up"
        );
        assert!(validate_interaction_type(Some("sms")).is_err());
    }

    #[test]
    fn validates_normalized_preference_categories() {
        assert_eq!(validate_preference_category(" DIETARY ").unwrap(), "dietary");
        assert!(validate_preference_category("room_service").is_err());
        assert!(validate_preference_category("").is_err());
    }

    #[test]
    fn validates_key_bounds() {
        assert!(validate_key("  ").is_err());
        assert_eq!(validate_key(" pillow ").unwrap(), "pillow");
        assert!(validate_key(&"k".repeat(100)).is_ok());
        assert!(validate_key(&"k".repeat(101)).is_err());
    }

    #[test]
    fn validates_value_bounds_and_strips_control_chars() {
        assert!(validate_value(" \n ").is_err());
        assert_eq!(
            validate_value(" soft\u{0000} pillows ").unwrap(),
            "soft pillows"
        );
        assert!(validate_value(&"v".repeat(2001)).is_err());
        assert!(validate_value(&"v".repeat(2000)).is_ok());
    }

    #[test]
    fn validates_content_bounds() {
        assert!(validate_content("  ").is_err());
        assert_eq!(
            validate_content(" Called\u{0007} guest ").unwrap(),
            "Called guest"
        );
        assert!(validate_content(&"c".repeat(4001)).is_err());
    }

    #[test]
    fn sanitizes_optional_subject() {
        assert_eq!(sanitize_subject(None).unwrap(), None);
        assert_eq!(sanitize_subject(Some("  ".to_string())).unwrap(), None);
        assert_eq!(
            sanitize_subject(Some(" VIP\u{0000} arrival ".to_string())).unwrap(),
            Some("VIP arrival".to_string())
        );
        assert!(sanitize_subject(Some("s".repeat(256))).is_err());
    }

    #[test]
    fn validates_review_response() {
        assert!(validate_review_response("  ").is_err());
        assert!(validate_review_response(&"r".repeat(2001)).is_err());
        assert_eq!(validate_review_response(" Thank you ").unwrap(), "Thank you");
    }

    #[test]
    fn rejects_duplicate_preference_pairs() {
        let entry = |category: &str, key: &str, value: &str| GuestPreferenceEntry {
            category: category.to_string(),
            preference_key: key.to_string(),
            preference_value: value.to_string(),
        };
        let input = GuestPreferencesPut {
            entries: vec![
                entry("room", "pillow", "soft"),
                entry("ROOM", " pillow ", "firm"),
            ],
            replace_categories: None,
        };
        assert!(validate_preferences_put(input).is_err());
    }

    #[test]
    fn normalizes_preference_batch() {
        let input = GuestPreferencesPut {
            entries: vec![GuestPreferenceEntry {
                category: "Bed".to_string(),
                preference_key: " type ".to_string(),
                preference_value: "king".to_string(),
            }],
            replace_categories: Some(vec![" ROOM ".to_string()]),
        };
        let out = validate_preferences_put(input).unwrap();
        assert_eq!(out.entries[0].category, "bed");
        assert_eq!(out.entries[0].preference_key, "type");
        assert_eq!(out.replace_categories.unwrap(), vec!["room".to_string()]);
    }

    #[test]
    fn preserves_absent_replace_categories() {
        let input = GuestPreferencesPut {
            entries: vec![],
            replace_categories: None,
        };
        let out = validate_preferences_put(input).unwrap();
        assert!(out.replace_categories.is_none());
    }
}
