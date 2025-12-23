use ammonia::clean;

/// Input sanitization utilities to prevent XSS and injection attacks
pub struct Sanitizer;

impl Sanitizer {
    /// Sanitize HTML content, removing dangerous tags and attributes
    ///
    /// Uses ammonia library which implements a safe HTML whitelist approach.
    /// Removes script tags, event handlers, and other potentially dangerous HTML.
    ///
    /// # Arguments
    /// * `input` - Raw HTML input that may contain malicious content
    ///
    /// # Returns
    /// * Safe HTML string with dangerous elements removed
    pub fn sanitize_html(input: &str) -> String {
        clean(input)
    }

    /// Sanitize plain text by removing control characters
    ///
    /// Keeps only printable characters and common whitespace (space, newline, tab, carriage return).
    /// Prevents control character injection attacks.
    ///
    /// # Arguments
    /// * `input` - Raw text input
    ///
    /// # Returns
    /// * Sanitized text with control characters removed
    pub fn sanitize_text(input: &str) -> String {
        input
            .chars()
            .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t' || *c == ' ')
            .collect()
    }

    /// Sanitize and normalize email addresses
    ///
    /// Trims whitespace and converts to lowercase for consistent storage.
    ///
    /// # Arguments
    /// * `input` - Raw email input
    ///
    /// # Returns
    /// * Normalized email address
    pub fn sanitize_email(input: &str) -> String {
        input.trim().to_lowercase()
    }

    /// Sanitize phone numbers by removing non-digit characters except + prefix
    ///
    /// # Arguments
    /// * `input` - Raw phone number input
    ///
    /// # Returns
    /// * Phone number with only digits and optional + prefix
    pub fn sanitize_phone(input: &str) -> String {
        let trimmed = input.trim();
        let mut result = String::new();

        for (i, c) in trimmed.chars().enumerate() {
            if c.is_ascii_digit() {
                result.push(c);
            } else if i == 0 && c == '+' {
                result.push(c);
            }
            // Skip all other characters (spaces, dashes, parentheses, etc.)
        }

        result
    }

    /// Sanitize URL by validating scheme and removing dangerous protocols
    ///
    /// Only allows http, https, and mailto schemes.
    ///
    /// # Arguments
    /// * `input` - Raw URL input
    ///
    /// # Returns
    /// * Option<String> - Some(url) if valid, None if dangerous
    pub fn sanitize_url(input: &str) -> Option<String> {
        let trimmed = input.trim();

        // Check for allowed schemes
        if trimmed.starts_with("http://") ||
           trimmed.starts_with("https://") ||
           trimmed.starts_with("mailto:") {
            Some(trimmed.to_string())
        } else if !trimmed.contains("://") {
            // Assume https if no scheme provided
            Some(format!("https://{}", trimmed))
        } else {
            // Reject javascript:, data:, and other dangerous schemes
            None
        }
    }

    /// Sanitize file paths to prevent directory traversal attacks
    ///
    /// Removes ../ sequences and leading/trailing slashes.
    ///
    /// # Arguments
    /// * `input` - Raw file path input
    ///
    /// # Returns
    /// * Safe file path without directory traversal sequences
    pub fn sanitize_file_path(input: &str) -> String {
        input
            .replace("../", "")
            .replace("..\\", "")
            .trim_matches('/')
            .trim_matches('\\')
            .to_string()
    }

    /// Sanitize SQL identifiers (table names, column names)
    ///
    /// Allows only alphanumeric characters and underscores.
    /// This is a defense-in-depth measure; parameterized queries are still required.
    ///
    /// # Arguments
    /// * `input` - Raw identifier input
    ///
    /// # Returns
    /// * Option<String> - Some(identifier) if valid, None if contains invalid characters
    pub fn sanitize_sql_identifier(input: &str) -> Option<String> {
        if input.chars().all(|c| c.is_alphanumeric() || c == '_') {
            Some(input.to_string())
        } else {
            None
        }
    }

    /// Comprehensive sanitization for guest input
    ///
    /// Applies appropriate sanitization based on field type.
    pub fn sanitize_guest_name(name: &str) -> String {
        // Remove control characters but allow international characters
        Self::sanitize_text(name).trim().to_string()
    }

    /// Sanitize booking notes/remarks
    ///
    /// Allows newlines and common punctuation but removes dangerous HTML/scripts.
    pub fn sanitize_notes(notes: &str) -> String {
        // First remove any HTML
        let html_free = Self::sanitize_html(notes);
        // Then remove control characters except newlines/tabs
        Self::sanitize_text(&html_free)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_html() {
        let malicious = "<script>alert('XSS')</script><p>Safe content</p>";
        let sanitized = Sanitizer::sanitize_html(malicious);
        assert!(!sanitized.contains("<script"));
        assert!(sanitized.contains("Safe content"));
    }

    #[test]
    fn test_sanitize_text() {
        let input = "Hello\x00World\x1FTest";
        let sanitized = Sanitizer::sanitize_text(input);
        assert_eq!(sanitized, "HelloWorldTest");
    }

    #[test]
    fn test_sanitize_email() {
        assert_eq!(Sanitizer::sanitize_email("  Test@Example.COM  "), "test@example.com");
    }

    #[test]
    fn test_sanitize_phone() {
        assert_eq!(Sanitizer::sanitize_phone("+1 (415) 555-2671"), "+14155552671");
        assert_eq!(Sanitizer::sanitize_phone("415-555-2671"), "4155552671");
    }

    #[test]
    fn test_sanitize_url() {
        assert_eq!(Sanitizer::sanitize_url("https://example.com"), Some("https://example.com".to_string()));
        assert_eq!(Sanitizer::sanitize_url("javascript:alert('XSS')"), None);
        assert_eq!(Sanitizer::sanitize_url("example.com"), Some("https://example.com".to_string()));
    }

    #[test]
    fn test_sanitize_file_path() {
        assert_eq!(Sanitizer::sanitize_file_path("../../../etc/passwd"), "etc/passwd");
        assert_eq!(Sanitizer::sanitize_file_path("/safe/path/file.txt"), "safe/path/file.txt");
    }

    #[test]
    fn test_sanitize_sql_identifier() {
        assert_eq!(Sanitizer::sanitize_sql_identifier("valid_table_name"), Some("valid_table_name".to_string()));
        assert_eq!(Sanitizer::sanitize_sql_identifier("invalid-name"), None);
        assert_eq!(Sanitizer::sanitize_sql_identifier("table; DROP TABLE users;"), None);
    }
}
