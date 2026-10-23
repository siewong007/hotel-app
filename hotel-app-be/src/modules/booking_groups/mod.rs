//! Multi-room guest bookings.
//!
//! A booking group is one guest booking that holds several rooms. Each room is
//! still an ordinary single-room `bookings` row (room status, night audit,
//! folio, ledgers and the same-room overlap constraint work per room);
//! `bookings.booking_group_id` ties the rooms to a `booking_groups` parent
//! that carries the shared payment status, totals and unpaid-hold expiry.
//!
//! Money split across rooms (fixed vouchers pro-rata, complimentary credits
//! per room-night) is decided once at creation by [`allocation`] and persisted
//! on each member booking, so a later single-room cancel/refund never has to
//! recompute the group.

pub mod allocation;
pub mod models;
pub mod repository;

/// Most rooms a guest may put in one portal booking.
pub const MAX_ROOMS_PER_GUEST_BOOKING: usize = 5;
