//! Guards the consent vocabulary against schema drift.
//!
//! `consent_records.document_type`, `locale` and `source` are CHECK-constrained
//! in the V1 baseline. The Rust enums in `modules/consent/models.rs` are the
//! wire contract with the frontend. If one side gains a value the other does
//! not, a guest can submit a consent the database will refuse.

use hotel_app_be::modules::consent::models::{ConsentDocument, ConsentSource};

const POSTGRES_SCHEMA: &str = include_str!("../database/postgres/migrations/0001_v1_baseline.sql");

fn check_array_for(constraint: &str) -> Vec<String> {
    let marker = format!("CONSTRAINT {constraint} CHECK");
    let start = POSTGRES_SCHEMA
        .find(&marker)
        .unwrap_or_else(|| panic!("baseline is missing {constraint}"));
    let window = &POSTGRES_SCHEMA[start..start + 800];
    window
        .split('\'')
        .enumerate()
        .filter_map(|(index, part)| {
            if index % 2 == 1 && part.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
                Some(part.to_string())
            } else {
                None
            }
        })
        .collect()
}

#[test]
fn consent_vocabulary_matches_schema() {
    let documents = check_array_for("consent_records_document_type_check");
    let locales = check_array_for("consent_records_locale_check");
    let sources = check_array_for("consent_records_source_check");

    let rust_documents = [
        ConsentDocument::TermsOfService.as_str(),
        ConsentDocument::PrivacyNotice.as_str(),
        ConsentDocument::PaymentTerms.as_str(),
        ConsentDocument::EkycBiometric.as_str(),
    ];
    let rust_sources = [
        ConsentSource::Registration.as_str(),
        ConsentSource::OnlineBooking.as_str(),
        ConsentSource::Payment.as_str(),
        ConsentSource::Ekyc.as_str(),
        ConsentSource::GuestPortal.as_str(),
        ConsentSource::FrontDesk.as_str(),
    ];

    for document in rust_documents {
        assert!(
            documents.iter().any(|value| value == document),
            "schema is missing document_type '{document}'"
        );
    }
    for source in rust_sources {
        assert!(
            sources.iter().any(|value| value == source),
            "schema is missing source '{source}'"
        );
    }
    assert!(locales.iter().any(|value| value == "en"));
    assert!(locales.iter().any(|value| value == "ms"));
}
