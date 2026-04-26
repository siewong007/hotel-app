use crate::models::*;
use validator::{Validate, ValidationError};

/// Validates phone numbers in E.164 format
fn validate_phone(phone: &str) -> Result<(), ValidationError> {
    let re = regex::Regex::new(r"^\+?[1-9]\d{7,14}$").unwrap();
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
    #[validate(length(min = 1, max = 100), custom(function = validate_not_empty))]
    pub first_name: String,

    #[validate(length(min = 1, max = 100), custom(function = validate_not_empty))]
    pub last_name: String,

    #[validate(email)]
    pub email: Option<String>,

    #[validate(custom(function = validate_phone))]
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
    use validator::Validate;

    #[test]
    fn test_validate_phone_valid() {
        assert!(validate_phone("+14155552671").is_ok());
        assert!(validate_phone("+442071234567").is_ok());
        assert!(validate_phone("14155552671").is_ok());
    }

    #[test]
    fn test_validate_phone_invalid() {
        assert!(validate_phone("123").is_err());
        assert!(validate_phone("invalid").is_err());
        assert!(validate_phone("").is_err());
        assert!(validate_phone("+0123456789").is_err());
        assert!(validate_phone("+1415555267123456").is_err());
    }

    #[test]
    fn test_validate_not_empty() {
        assert!(validate_not_empty("test").is_ok());
        assert!(validate_not_empty("   ").is_err());
        assert!(validate_not_empty("").is_err());
    }

    #[test]
    fn test_guest_input_validation_accepts_valid_optional_fields() {
        let input = ValidatedGuestInput {
            first_name: "Ada".to_string(),
            last_name: "Lovelace".to_string(),
            email: Some("ada@example.com".to_string()),
            phone: Some("+14155552671".to_string()),
            address_line1: None,
            city: None,
            state_province: None,
            postal_code: None,
            country: None,
        };

        assert!(input.validate().is_ok());
    }

    #[test]
    fn test_guest_input_validation_rejects_blank_names_and_bad_contact_fields() {
        let input = ValidatedGuestInput {
            first_name: "   ".to_string(),
            last_name: "".to_string(),
            email: Some("not-an-email".to_string()),
            phone: Some("123".to_string()),
            address_line1: None,
            city: None,
            state_province: None,
            postal_code: None,
            country: None,
        };

        let errors = input
            .validate()
            .expect_err("invalid guest input should fail validation");

        assert!(errors.field_errors().contains_key("first_name"));
        assert!(errors.field_errors().contains_key("last_name"));
        assert!(errors.field_errors().contains_key("email"));
        assert!(errors.field_errors().contains_key("phone"));
    }

    #[test]
    fn test_room_event_validation_rejects_overlong_notes() {
        let input = ValidatedRoomEventInput {
            event_type: "maintenance".to_string(),
            status: "open".to_string(),
            priority: Some("high".to_string()),
            notes: Some("x".repeat(1001)),
        };

        let errors = input
            .validate()
            .expect_err("notes over 1000 chars should fail");

        assert!(errors.field_errors().contains_key("notes"));
    }
}
