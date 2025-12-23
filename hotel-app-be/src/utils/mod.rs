//! Utility functions and helpers
//!
//! Common utilities used across the application.

pub mod sanitization;
pub mod validation;

pub use sanitization::Sanitizer;
pub use validation::{ValidatedGuestInput, ValidatedRoomEventInput, ValidatedRoomStatusInput};
