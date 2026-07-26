//! Teams (departments).
//!
//! A team confers **roles** on its current members: effective permissions are
//! the union of a user's direct `user_roles` and the roles granted to every
//! active team they belong to (see `core::rbac_cache::resolve`). Granting a
//! team a role clears the same permission-superset bar as granting it to a
//! user directly, so teams cannot be used to launder an escalation.
//!
//! Membership carries exactly one scoped capability: a team lead may change
//! their own team's membership without holding global `teams:assign`.

pub mod handlers;
pub mod models;
pub mod repository;
pub mod routes;
pub mod service;
pub mod validation;
