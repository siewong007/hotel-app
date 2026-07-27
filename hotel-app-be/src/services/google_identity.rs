/// A verified Google identity claim suitable for guest-account resolution.
#[allow(dead_code)]
#[derive(Clone, PartialEq, Eq)]
pub struct GoogleIdentity {
    pub subject: String,
    pub email: String,
    pub email_verified: bool,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
}

/// The required guest-contact fields that still need to be supplied.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileCompletion {
    pub complete: bool,
    pub missing_fields: Vec<&'static str>,
}

#[allow(dead_code)]
impl ProfileCompletion {
    pub fn missing(missing_fields: Vec<&'static str>) -> Self {
        Self {
            complete: false,
            missing_fields,
        }
    }
}

#[allow(dead_code)]
pub fn profile_completion(
    first_name: Option<&str>,
    last_name: Option<&str>,
    phone: Option<&str>,
) -> ProfileCompletion {
    let mut missing_fields = Vec::new();
    if first_name.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("first_name");
    }
    if last_name.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("last_name");
    }
    if phone.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("phone");
    }

    ProfileCompletion {
        complete: missing_fields.is_empty(),
        missing_fields,
    }
}

/// Creates a lowercase username that satisfies the database username constraint.
#[allow(dead_code)]
pub fn google_username(email: &str, subject: &str) -> String {
    let local_part = email.split_once('@').map_or(email, |(local, _)| local);
    let normalized = local_part
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let base = normalized.trim_matches('_');
    let base = if base.is_empty() { "guest" } else { base };
    let suffix = subject
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect::<String>();
    let suffix = suffix
        .chars()
        .rev()
        .take(6)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let suffix = if suffix.is_empty() { "google" } else { &suffix };
    let base_limit = 100 - suffix.len() - 1;

    format!("{}_{}", &base[..base.len().min(base_limit)], suffix)
}

#[cfg(test)]
mod tests {
    use super::{ProfileCompletion, google_username, profile_completion};

    #[test]
    fn profile_completion_requires_first_name_last_name_and_phone() {
        assert_eq!(
            profile_completion(Some("Aisha"), Some("Rahman"), None),
            ProfileCompletion::missing(vec!["phone"]),
        );
    }

    #[test]
    fn profile_completion_does_not_require_an_address() {
        assert!(profile_completion(Some("Aisha"), Some("Rahman"), Some("+60123456789")).complete);
    }

    #[test]
    fn google_username_is_lowercase_and_database_safe() {
        assert_eq!(
            google_username("Aisha.Rahman@gmail.com", "10987654321"),
            "aisha_rahman_654321"
        );
    }
}
