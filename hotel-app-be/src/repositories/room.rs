//! Room repository compatibility layer.
//!
//! The legacy room workflows now live in `services::rooms`; this re-export keeps
//! older module paths compiling while callers move through the service layer.

#[allow(unused_imports)]
pub use crate::services::rooms::*;
