//! Locale negotiation and the server-side message catalog.
//!
//! The backend needs languages for one reason the frontend cannot cover: text
//! that leaves the browser. A booking confirmation is rendered here, queued in
//! `email_deliveries`, and sent by the worker minutes later — by which time
//! there is no session, no `Accept-Language`, and no React tree to ask. So the
//! language has to be resolved and applied at render time, from what the guest
//! record says.
//!
//! Resolution order for guest mail is `guests.language_preference`, then the
//! hotel's `default_locale` setting, then [`DEFAULT_LOCALE`]. Anything
//! unrecognised is ignored rather than rejected: a locale we stopped shipping
//! must degrade to English, never fail a send.
//!
//! Catalog entries use `{{name}}` placeholders — the same spelling as the
//! communications module's `render_template` and the web client's translation
//! bundles, so a string can move between the three without rewriting.
//!
//! ## HTML safety
//!
//! Catalog values are developer-authored and may contain markup (`<strong>`),
//! so they are emitted verbatim. Interpolated values are NOT escaped here —
//! callers building HTML must pass values already through
//! `communications::validation::html_escape`, exactly as they did when these
//! strings were inline `format!` calls.

use std::collections::HashMap;
use std::sync::OnceLock;

/// Language served when nothing better is known.
pub const DEFAULT_LOCALE: &str = "en";

/// Every language the platform speaks.
///
/// Must stay in step with the web client's `src/i18n/locales.ts` registry and
/// with the `consent_records.locale` check constraint — a locale offered in
/// the switcher but rejected on write would fail a guest's consent submission.
pub const SUPPORTED_LOCALES: &[&str] = &["en", "ms"];

/// `system_settings` key holding the hotel's preferred default language.
///
/// Read through `settings_cache` with [`DEFAULT_LOCALE`] as the fallback, so a
/// database without the row behaves exactly as one that has it set to `en`.
pub const DEFAULT_LOCALE_SETTING_KEY: &str = "default_locale";

/// A supported language.
///
/// Constructed only through [`Locale::parse`] and friends, so the inner tag is
/// always one of [`SUPPORTED_LOCALES`] and lookups never need to re-validate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Locale(&'static str);

impl Locale {
    /// The platform default, `en`.
    pub fn default_locale() -> Self {
        Locale(DEFAULT_LOCALE)
    }

    /// The language tag, as stored and sent on the wire.
    pub fn as_str(&self) -> &'static str {
        self.0
    }

    /// Resolve a tag to a supported locale, matching on the primary subtag.
    ///
    /// Accepts anything a client may send — `ms`, `ms-MY`, `en_US`, `EN` —
    /// and returns `None` for anything unsupported, so callers can keep
    /// walking their own preference chain rather than being handed a default
    /// too early.
    pub fn parse(tag: &str) -> Option<Self> {
        let primary = tag
            .trim()
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if primary.is_empty() {
            return None;
        }
        SUPPORTED_LOCALES
            .iter()
            .find(|candidate| **candidate == primary)
            .map(|candidate| Locale(candidate))
    }

    /// Best supported locale named by an `Accept-Language` header.
    ///
    /// Honours q-values (`ms;q=0.9, en;q=0.8`), ignores `*`, and returns
    /// `None` when the header names nothing we speak. Entries with `q=0` are
    /// an explicit refusal and are skipped.
    ///
    /// Not yet read by a request handler: the web client sends the header on
    /// every call (`src/api/client.ts`), and this is the entry point for the
    /// handler that will record a first-time guest's language. Exercised by
    /// this module's tests.
    #[allow(dead_code)]
    pub fn from_accept_language(header: &str) -> Option<Self> {
        let mut best: Option<(f32, Locale)> = None;
        for entry in header.split(',') {
            let mut parts = entry.split(';');
            let tag = parts.next().unwrap_or_default().trim();
            if tag.is_empty() || tag == "*" {
                continue;
            }
            let quality = parts
                .find_map(|part| {
                    let part = part.trim();
                    part.strip_prefix("q=").and_then(|q| q.trim().parse().ok())
                })
                .unwrap_or(1.0_f32);
            if quality <= 0.0 {
                continue;
            }
            let Some(locale) = Locale::parse(tag) else {
                continue;
            };
            if best.is_none_or(|(best_quality, _)| quality > best_quality) {
                best = Some((quality, locale));
            }
        }
        best.map(|(_, locale)| locale)
    }

    /// Walk a preference chain, most specific first, ending at the default.
    ///
    /// Every candidate is an optional raw tag — a guest's stored preference, a
    /// header, a hotel setting — and the first one that names a supported
    /// language wins.
    pub fn resolve<'a>(candidates: impl IntoIterator<Item = Option<&'a str>>) -> Self {
        candidates
            .into_iter()
            .flatten()
            .find_map(Locale::parse)
            .unwrap_or_else(Locale::default_locale)
    }

    /// Look up a catalog entry, falling back to English and finally to the key
    /// itself. Never panics, and never renders blank for a key that exists in
    /// either catalog.
    ///
    /// The returned lifetime is the key's: catalog hits are `'static` (the
    /// catalogs live in a process-lifetime `OnceLock`) and coerce down, while
    /// a miss borrows the key the caller passed in.
    pub fn message<'a>(&self, key: &'a str) -> &'a str {
        catalog(self.0)
            .get(key)
            .or_else(|| catalog(DEFAULT_LOCALE).get(key))
            .map(String::as_str)
            .unwrap_or(key)
    }

    /// Render a calendar date in this language, as `26 Jul 2026`.
    ///
    /// Month abbreviations come from the catalog rather than from chrono's
    /// `%b`, which is English-only: four of the twelve Malay abbreviations
    /// differ (Mac, Mei, Ogo, Okt, Dis), and a guest reading a Malay
    /// confirmation should not find English months inside it.
    pub fn format_date(&self, date: chrono::NaiveDate) -> String {
        use chrono::Datelike;
        let month_key = format!("email.months.{:02}", date.month());
        format!(
            "{:02} {} {}",
            date.day(),
            self.message(&month_key),
            date.year()
        )
    }

    /// Look up a catalog entry and substitute `{{name}}` placeholders.
    ///
    /// An unresolved placeholder is left verbatim: a visible `{{name}}` in a
    /// test or a support ticket is traceable, where a silent gap is not.
    pub fn format(&self, key: &str, vars: &[(&str, &str)]) -> String {
        interpolate(self.message(key), vars)
    }
}

impl Default for Locale {
    fn default() -> Self {
        Locale::default_locale()
    }
}

impl std::fmt::Display for Locale {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

type Catalog = HashMap<String, String>;

static CATALOGS: OnceLock<HashMap<&'static str, Catalog>> = OnceLock::new();

const EN_SOURCE: &str = include_str!("locales/en.json");
const MS_SOURCE: &str = include_str!("locales/ms.json");

fn source_for(locale: &str) -> &'static str {
    match locale {
        "ms" => MS_SOURCE,
        _ => EN_SOURCE,
    }
}

/// Flatten nested JSON objects into dotted keys (`email.labels.room`).
///
/// Bundles are authored nested because that is how humans group them; lookups
/// want a flat map. Non-string leaves are dropped rather than stringified, so
/// a malformed entry can never render as `{"a":1}` in a guest's inbox.
fn flatten(prefix: &str, value: &serde_json::Value, out: &mut Catalog) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten(&path, child, out);
            }
        }
        serde_json::Value::String(text) => {
            out.insert(prefix.to_string(), text.clone());
        }
        _ => {}
    }
}

fn catalog(locale: &str) -> &'static Catalog {
    let catalogs = CATALOGS.get_or_init(|| {
        let mut all = HashMap::new();
        for locale in SUPPORTED_LOCALES {
            let mut entries = Catalog::new();
            // A malformed bundle is a build-time authoring error, not a
            // runtime condition: an empty catalog degrades to English, and
            // English degrades to rendering the keys, so a send never fails.
            match serde_json::from_str::<serde_json::Value>(source_for(locale)) {
                Ok(parsed) => flatten("", &parsed, &mut entries),
                Err(error) => {
                    log::error!("Failed to parse the '{locale}' message catalog: {error}");
                }
            }
            all.insert(*locale, entries);
        }
        all
    });
    catalogs
        .get(locale)
        .or_else(|| catalogs.get(DEFAULT_LOCALE))
        .expect("the default catalog is always registered")
}

/// Substitute `{{name}}` placeholders, leaving unknown ones verbatim.
fn interpolate(template: &str, vars: &[(&str, &str)]) -> String {
    if !template.contains("{{") {
        return template.to_string();
    }
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            // Unbalanced braces: emit the remainder as written.
            out.push_str(&rest[start..]);
            return out;
        };
        let name = after[..end].trim();
        match vars.iter().find(|(key, _)| *key == name) {
            Some((_, value)) => out.push_str(value),
            None => {
                out.push_str("{{");
                out.push_str(&after[..end]);
                out.push_str("}}");
            }
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_tags_and_regional_variants() {
        assert_eq!(Locale::parse("en").map(|l| l.as_str()), Some("en"));
        assert_eq!(Locale::parse("ms").map(|l| l.as_str()), Some("ms"));
        assert_eq!(Locale::parse("ms-MY").map(|l| l.as_str()), Some("ms"));
        assert_eq!(Locale::parse("en_US").map(|l| l.as_str()), Some("en"));
        assert_eq!(Locale::parse("  MS-my  ").map(|l| l.as_str()), Some("ms"));
    }

    #[test]
    fn rejects_unsupported_and_empty_tags() {
        assert!(Locale::parse("de-DE").is_none());
        assert!(Locale::parse("").is_none());
        assert!(Locale::parse("   ").is_none());
        assert!(Locale::parse("-").is_none());
    }

    #[test]
    fn accept_language_picks_the_highest_quality_supported_entry() {
        assert_eq!(
            Locale::from_accept_language("de-DE,ms-MY;q=0.9,en;q=0.5").map(|l| l.as_str()),
            Some("ms")
        );
        assert_eq!(
            Locale::from_accept_language("ms;q=0.4, en;q=0.8").map(|l| l.as_str()),
            Some("en")
        );
        // No q-value means q=1.
        assert_eq!(
            Locale::from_accept_language("ms, en;q=0.9").map(|l| l.as_str()),
            Some("ms")
        );
    }

    #[test]
    fn accept_language_skips_wildcards_refusals_and_unknown_languages() {
        assert!(Locale::from_accept_language("*").is_none());
        assert!(Locale::from_accept_language("de, fr;q=0.7").is_none());
        assert!(Locale::from_accept_language("").is_none());
        // q=0 is an explicit refusal of that language.
        assert_eq!(
            Locale::from_accept_language("ms;q=0, en;q=0.3").map(|l| l.as_str()),
            Some("en")
        );
    }

    #[test]
    fn accept_language_tolerates_malformed_quality_values() {
        assert_eq!(
            Locale::from_accept_language("ms;q=notanumber").map(|l| l.as_str()),
            Some("ms")
        );
        assert_eq!(
            Locale::from_accept_language("ms;;;q=0.9").map(|l| l.as_str()),
            Some("ms")
        );
    }

    #[test]
    fn resolve_walks_the_preference_chain_in_order() {
        assert_eq!(
            Locale::resolve([Some("ms"), Some("en")]).as_str(),
            "ms",
            "the first supported candidate wins"
        );
        assert_eq!(
            Locale::resolve([None, Some(""), Some("de"), Some("ms")]).as_str(),
            "ms",
            "empty and unsupported candidates are skipped, not fatal"
        );
        assert_eq!(
            Locale::resolve([None, None]).as_str(),
            DEFAULT_LOCALE,
            "an exhausted chain lands on the default"
        );
        assert_eq!(
            Locale::resolve(Vec::<Option<&str>>::new()).as_str(),
            DEFAULT_LOCALE
        );
    }

    #[test]
    fn every_supported_locale_has_a_catalog() {
        for locale in SUPPORTED_LOCALES {
            assert!(
                !catalog(locale).is_empty(),
                "the '{locale}' catalog failed to load or is empty"
            );
        }
    }

    #[test]
    fn translated_catalogs_cover_every_english_key() {
        // A missing key falls back to English rather than failing, which is
        // exactly why it needs asserting: a half-translated catalog would ship
        // silently and read correctly to an English-speaking reviewer.
        let english = catalog(DEFAULT_LOCALE);
        for locale in SUPPORTED_LOCALES {
            let translated = catalog(locale);
            for key in english.keys() {
                assert!(
                    translated.contains_key(key),
                    "the '{locale}' catalog is missing '{key}'"
                );
            }
            for key in translated.keys() {
                assert!(
                    english.contains_key(key),
                    "the '{locale}' catalog defines '{key}', which English does not"
                );
            }
        }
    }

    #[test]
    fn translations_only_use_placeholders_the_english_source_provides() {
        // A translator typo like `{{nama}}` for `{{name}}` would render literal
        // braces into a guest's inbox. Nothing else would catch it.
        fn placeholders(text: &str) -> Vec<String> {
            let mut found = Vec::new();
            let mut rest = text;
            while let Some(start) = rest.find("{{") {
                let after = &rest[start + 2..];
                let Some(end) = after.find("}}") else { break };
                found.push(after[..end].trim().to_string());
                rest = &after[end + 2..];
            }
            found
        }

        let english = catalog(DEFAULT_LOCALE);
        for locale in SUPPORTED_LOCALES {
            for (key, value) in catalog(locale) {
                let Some(source) = english.get(key) else {
                    continue;
                };
                let allowed = placeholders(source);
                for used in placeholders(value) {
                    assert!(
                        allowed.contains(&used),
                        "{locale} '{key}' interpolates '{{{{{used}}}}}', \
                         which the English source does not provide"
                    );
                }
            }
        }
    }

    #[test]
    fn no_catalog_entry_is_blank() {
        for locale in SUPPORTED_LOCALES {
            for (key, value) in catalog(locale) {
                assert!(!value.trim().is_empty(), "{locale} '{key}' is blank");
            }
        }
    }

    #[test]
    fn message_falls_back_to_english_then_to_the_key() {
        let malay = Locale::parse("ms").expect("ms is supported");
        assert_eq!(malay.message("email.labels.room"), "Bilik");
        assert_eq!(
            malay.message("no.such.key"),
            "no.such.key",
            "an unknown key renders traceably rather than blank"
        );
    }

    #[test]
    fn format_substitutes_placeholders() {
        let english = Locale::default_locale();
        assert_eq!(
            english.format("email.greeting", &[("name", "Aisha")]),
            "Dear Aisha,"
        );
        let malay = Locale::parse("ms").expect("ms is supported");
        assert_eq!(
            malay.format("email.greeting", &[("name", "Aisha")]),
            "Salam sejahtera Aisha,"
        );
    }

    #[test]
    fn interpolation_handles_missing_repeated_and_malformed_placeholders() {
        assert_eq!(interpolate("plain text", &[]), "plain text");
        assert_eq!(
            interpolate("{{a}} and {{a}}", &[("a", "x")]),
            "x and x",
            "a placeholder may repeat"
        );
        assert_eq!(
            interpolate("Hi {{name}}", &[]),
            "Hi {{name}}",
            "an unresolved placeholder stays visible"
        );
        assert_eq!(
            interpolate("Hi {{ name }}", &[("name", "Sam")]),
            "Hi Sam",
            "whitespace inside the braces is tolerated"
        );
        assert_eq!(
            interpolate("broken {{name", &[("name", "Sam")]),
            "broken {{name",
            "unbalanced braces are emitted as written"
        );
        assert_eq!(interpolate("", &[("a", "b")]), "");
    }

    #[test]
    fn format_date_uses_the_language_s_own_month_names() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 8, 5).expect("valid date");
        assert_eq!(Locale::default_locale().format_date(date), "05 Aug 2026");
        let malay = Locale::parse("ms").expect("ms is supported");
        assert_eq!(malay.format_date(date), "05 Ogo 2026");
    }

    #[test]
    fn format_date_covers_every_month_in_every_locale() {
        // A missing month key would silently render the lookup key itself
        // ("email.months.03") into a guest's confirmation email.
        for locale in SUPPORTED_LOCALES {
            let locale = Locale::parse(locale).expect("registered locale parses");
            for month in 1..=12u32 {
                let date = chrono::NaiveDate::from_ymd_opt(2026, month, 1).expect("valid date");
                let rendered = locale.format_date(date);
                assert!(
                    !rendered.contains("email.months"),
                    "{locale} has no month name for {month}: rendered {rendered}"
                );
            }
        }
    }

    #[test]
    fn supported_locales_fit_the_schema_column() {
        // `guests.language_preference` is character varying(10).
        for locale in SUPPORTED_LOCALES {
            assert!(locale.len() <= 10, "'{locale}' will not fit the column");
        }
    }

    #[test]
    fn the_default_locale_is_supported() {
        assert!(SUPPORTED_LOCALES.contains(&DEFAULT_LOCALE));
    }
}
