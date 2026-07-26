//! Common models shared across domains

use serde::{Deserialize, Serialize};

/// Search query parameters for room searches
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub room_type: Option<String>,
    pub max_price: Option<f64>,
    pub check_in_date: Option<String>,
    pub check_out_date: Option<String>,
    pub exclude_booking_id: Option<i64>,
}
