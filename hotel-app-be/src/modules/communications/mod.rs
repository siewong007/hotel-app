//! Communications domain: per-topic notification subscriptions with consent
//! history, staff-composed email campaigns, a durable delivery outbox, and
//! global suppressions. Customers are identified by guest_id throughout.

pub mod handlers;
pub mod models;
pub mod repository;
pub mod routes;
pub mod scheduler;
pub mod service;
pub mod tokens;
pub mod transport;
pub mod validation;
pub mod worker;
