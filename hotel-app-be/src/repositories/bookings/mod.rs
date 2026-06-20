//! Booking repository compatibility layer
//!
//! Query-heavy booking workflows preserved behind the service/handler boundary.

mod checkin_advisory;
mod complimentary;
mod credits;
mod lifecycle;

pub use checkin_advisory::*;
pub use complimentary::*;
pub use credits::*;
pub use lifecycle::*;
