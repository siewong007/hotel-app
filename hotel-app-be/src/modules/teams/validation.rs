//! Team input validation.
//!
//! The database enforces `valid_team_code` and the length limits; validating
//! here turns a 500-shaped constraint violation into a 400 with a usable
//! message, and keeps free text out of the database unsanitized.

use super::models::{TeamCreateInput, TeamUpdateInput};
use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;

/// Mirrors the `valid_team_code` CHECK in the baseline: lowercase, starts with
/// a letter, then letters/digits/underscores.
fn validate_code(code: &str) -> Result<(), ApiError> {
    let valid = !code.is_empty()
        && code.len() <= 50
        && code.starts_with(|c: char| c.is_ascii_lowercase())
        && code
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');

    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Team code must be lowercase, start with a letter, and contain only \
             letters, digits and underscores (max 50 characters)"
                .to_string(),
        ))
    }
}

fn validate_name(name: &str) -> Result<(), ApiError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 100 {
        return Err(ApiError::BadRequest(
            "Team name is required and must be at most 100 characters".to_string(),
        ));
    }
    Ok(())
}

/// Validates and sanitizes in place, so the caller cannot forget to use the
/// cleaned value.
pub fn validate_create(input: &mut TeamCreateInput) -> Result<(), ApiError> {
    validate_code(&input.code)?;
    validate_name(&input.name)?;
    input.name = Sanitizer::sanitize_text(input.name.trim());
    input.description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(Sanitizer::sanitize_text);
    Ok(())
}

pub fn validate_update(input: &mut TeamUpdateInput) -> Result<(), ApiError> {
    if let Some(name) = input.name.as_deref() {
        validate_name(name)?;
        input.name = Some(Sanitizer::sanitize_text(name.trim()));
    }
    input.description = input
        .description
        .as_deref()
        .map(str::trim)
        .map(Sanitizer::sanitize_text);
    Ok(())
}
