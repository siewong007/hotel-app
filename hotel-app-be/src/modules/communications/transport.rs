//! Email transport abstraction.
//!
//! `Transport::from_env()` builds the configured provider (SMTP via lettre);
//! `Transport::fake()` records messages in memory for tests. Credentials come
//! exclusively from environment variables — never from system_settings or any
//! client-visible surface.

use std::sync::{Arc, Mutex};

use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::core::error::ApiError;

#[derive(Debug, Clone)]
pub struct OutgoingEmail {
    pub to: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from_email: String,
    pub from_name: Option<String>,
    /// "starttls" (default), "tls", or "none" (plain; local relays only).
    pub security: String,
}

impl SmtpConfig {
    /// None when SMTP_HOST or SMTP_FROM_EMAIL is unset/blank.
    pub fn from_env() -> Option<Self> {
        Self::from_values(|key| std::env::var(key).ok())
    }

    fn from_values(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let env = |key: &str| get(key).filter(|value| !value.trim().is_empty());
        Some(Self {
            host: env("SMTP_HOST")?,
            port: env("SMTP_PORT").and_then(|v| v.parse().ok()).unwrap_or(587),
            username: env("SMTP_USERNAME"),
            password: env("SMTP_PASSWORD"),
            from_email: env("SMTP_FROM_EMAIL")?,
            from_name: env("SMTP_FROM_NAME"),
            security: env("SMTP_SECURITY").unwrap_or_else(|| "starttls".to_string()),
        })
    }
}

#[derive(Debug, Default)]
pub struct FakeMailer {
    pub sent: Mutex<Vec<OutgoingEmail>>,
    /// When set, every send fails with this message (retry-path testing).
    pub fail_with: Option<String>,
}

pub enum Transport {
    Smtp(Box<SmtpMailer>),
    Fake(Arc<FakeMailer>),
}

pub struct SmtpMailer {
    mailer: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpMailer {
    fn build(config: &SmtpConfig) -> Result<Self, ApiError> {
        let internal =
            |m: String| ApiError::Internal(format!("SMTP transport configuration error: {m}"));
        let mut builder = match config.security.as_str() {
            "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
                .map_err(|e| internal(e.to_string()))?,
            "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host),
            _ => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                .map_err(|e| internal(e.to_string()))?,
        }
        .port(config.port);
        if let (Some(user), Some(pass)) = (&config.username, &config.password) {
            builder = builder.credentials(Credentials::new(user.clone(), pass.clone()));
        }
        let from: Mailbox = match &config.from_name {
            Some(name) => format!("{name} <{}>", config.from_email),
            None => config.from_email.clone(),
        }
        .parse()
        .map_err(|_| internal("invalid SMTP_FROM_EMAIL / SMTP_FROM_NAME".to_string()))?;
        Ok(Self {
            mailer: builder.build(),
            from,
        })
    }
}

impl Transport {
    /// The configured production transport, or None when SMTP is not set up.
    pub fn from_env() -> Result<Option<Self>, ApiError> {
        match SmtpConfig::from_env() {
            Some(config) => Ok(Some(Transport::Smtp(Box::new(SmtpMailer::build(&config)?)))),
            None => Ok(None),
        }
    }

    #[allow(dead_code)] // test helper
    pub fn fake() -> (Self, Arc<FakeMailer>) {
        let mailer = Arc::new(FakeMailer::default());
        (Transport::Fake(mailer.clone()), mailer)
    }

    /// Sends one message; returns a provider message id when available.
    /// Errors are returned as strings so callers can persist them as
    /// `last_error` without leaking typed internals.
    pub async fn send(&self, email: &OutgoingEmail) -> Result<Option<String>, String> {
        match self {
            Transport::Fake(fake) => {
                if let Some(reason) = &fake.fail_with {
                    return Err(reason.clone());
                }
                fake.sent
                    .lock()
                    .map_err(|_| "fake mailer poisoned".to_string())?
                    .push(email.clone());
                Ok(Some(format!("fake-{}", email.to.len())))
            }
            Transport::Smtp(smtp) => {
                let to: Mailbox = email
                    .to
                    .parse()
                    .map_err(|_| "invalid recipient address".to_string())?;
                let builder = Message::builder()
                    .from(smtp.from.clone())
                    .to(to)
                    .subject(&email.subject);
                let message = match &email.body_text {
                    Some(text) => builder.multipart(MultiPart::alternative_plain_html(
                        text.clone(),
                        email.body_html.clone(),
                    )),
                    None => builder
                        .header(lettre::message::header::ContentType::TEXT_HTML)
                        .body(email.body_html.clone()),
                }
                .map_err(|e| format!("message build failed: {e}"))?;
                let response = smtp
                    .mailer
                    .send(message)
                    .await
                    .map_err(|e| format!("smtp send failed: {e}"))?;
                Ok(response.message().next().map(ToOwned::to_owned))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SmtpConfig;

    #[test]
    fn smtp_config_requires_host_and_sender_identity() {
        let config = |host: Option<&str>, from_email: Option<&str>| {
            SmtpConfig::from_values(|key| match key {
                "SMTP_HOST" => host.map(str::to_owned),
                "SMTP_FROM_EMAIL" => from_email.map(str::to_owned),
                _ => None,
            })
        };

        assert!(config(None, Some("sender@example.com")).is_none());
        assert!(config(Some("smtp.example.com"), None).is_none());
        assert!(config(Some("   "), Some("sender@example.com")).is_none());

        let configured = config(Some("smtp.example.com"), Some("sender@example.com"))
            .expect("host and sender identity configure SMTP");
        assert_eq!(configured.host, "smtp.example.com");
        assert_eq!(configured.from_email, "sender@example.com");
        assert_eq!(configured.port, 587);
        assert_eq!(configured.security, "starttls");
    }
}
