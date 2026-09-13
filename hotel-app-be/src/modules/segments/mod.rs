//! Guest segments: named JSONB rule sets evaluated dynamically over the
//! `guests` table — membership is never materialized. Used by email-campaign
//! audience targeting (`email_campaigns.segment_id`) and the /segments admin
//! workspace.

// The workspace/handler layer lands in a follow-up phase; until then nothing in
// the bin target reaches these items and `clippy -D warnings` would fail.
#![allow(dead_code)]

pub mod models;
pub mod rules;
