use validator::{Validate, ValidationError};
use crate::models::*;

/// Validates phone numbers in E.164 format
fn validate_phone(phone: &str) -> Result<(), ValidationError> {
    let re = regex::Regex::new(r"^\+?[1-9]\d{1,14}$").unwrap();
    if re.is_match(phone) {
        Ok(())
    } else {
        Err(ValidationError::new("invalid_phone_format"))
    }
}

/// Validates that a string doesn't contain only whitespace
fn validate_not_empty(value: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        Err(ValidationError::new("cannot_be_empty"))
    } else {
        Ok(())
    }
}

/// Validated guest input with comprehensive validation rules
#[derive(Debug, Validate)]
pub struct ValidatedGuestInput {
    #[validate(length(min = 1, max = 100), custom = "validate_not_empty")]
    pub first_name: String,

    #[validate(length(min = 1, max = 100), custom = "validate_not_empty")]
    pub last_name: String,

    #[validate(email)]
    pub email: Option<String>,

    #[validate(custom = "validate_phone")]
    pub phone: Option<String>,

    #[validate(length(max = 255))]
    pub address_line1: Option<String>,

    #[validate(length(max = 100))]
    pub city: Option<String>,

    #[validate(length(max = 100))]
    pub state_province: Option<String>,

    #[validate(length(max = 20))]
    pub postal_code: Option<String>,

    #[validate(length(max = 100))]
    pub country: Option<String>,
}

/// Validated room event input
#[derive(Debug, Validate)]
pub struct ValidatedRoomEventInput {
    #[validate(length(min = 1, max = 50))]
    pub event_type: String,

    #[validate(length(min = 1, max = 50))]
    pub status: String,

    #[validate(length(max = 20))]
    pub priority: Option<String>,

    #[validate(length(max = 1000))]
    pub notes: Option<String>,
}

/// Validated room status update
#[derive(Debug, Validate)]
pub struct ValidatedRoomStatusInput {
    #[validate(length(min = 1, max = 50))]
    pub status: String,

    #[validate(length(max = 1000))]
    pub notes: Option<String>,
}

/// Helper function to convert GuestInput to ValidatedGuestInput
impl ValidatedGuestInput {
    pub fn from_guest_input(input: GuestInput) -> Self {
        ValidatedGuestInput {
            first_name: input.first_name,
            last_name: input.last_name,
            email: input.email,
            phone: input.phone,
            address_line1: input.address_line1,
            city: input.city,
            state_province: input.state_province,
            postal_code: input.postal_code,
            country: input.country,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_phone_valid() {
        assert!(validate_phone("+14155552671").is_ok());
        assert!(validate_phone("+442071234567").is_ok());
    }

    #[test]
    fn test_validate_phone_invalid() {
        assert!(validate_phone("123").is_err());
        assert!(validate_phone("invalid").is_err());
        assert!(validate_phone("").is_err());
    }

    #[test]
    fn test_validate_not_empty() {
        assert!(validate_not_empty("test").is_ok());
        assert!(validate_not_empty("   ").is_err());
        assert!(validate_not_empty("").is_err());
    }
}
