//! Guest segments: named JSONB rule sets evaluated dynamically over the
//! `guests` table — membership is never materialized. Used by email-campaign
//! audience targeting (`email_campaigns.segment_id`) and the /segments admin
//! workspace.

pub mod models;
pub mod rules;
