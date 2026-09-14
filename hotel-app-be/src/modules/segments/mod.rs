//! Guest segments: named JSONB rule sets evaluated dynamically over the
//! `guests` table — membership is never materialized. Used by email-campaign
//! audience targeting (`email_campaigns.segment_id`) and the /segments admin
//! workspace.

pub mod handlers;
pub mod models;
pub mod repository;
pub mod routes;
pub mod rules;
pub mod service;
