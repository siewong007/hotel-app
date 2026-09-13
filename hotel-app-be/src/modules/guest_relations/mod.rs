//! Guest Relations — the staff-facing guest 360 workspace.
//!
//! Phase 1 aggregates existing per-guest data (interaction notes on
//! `guest_notes`, `guest_preferences`, reviews, loyalty, vouchers,
//! communications, support conversations) behind the `/guests/{id}/...`
//! endpoints described in
//! `docs/superpowers/specs/2026-09-13-guest-relations-design.md`.
//!
//! Layered build: this task lands `models` + `validation` only. `repository`
//! arrives with Task 5 and `service`/`handlers`/`routes` with Task 6. Until
//! callers exist, the allows below keep the bin target (where `mod modules`
//! is private) free of dead-code warnings.

#[allow(dead_code)]
pub mod models;
#[allow(dead_code)]
pub mod repository;
#[allow(dead_code)]
pub mod validation;
