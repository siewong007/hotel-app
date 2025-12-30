//! Common models shared across domains

use serde::{Deserialize, Serialize};

/// Search query parameters for room searches
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub room_type: Option<String>,
    pub max_price: Option<f64>,
    pub check_in_date: Option<String>,
    pub check_out_date: Option<String>,
}

/// Pagination parameters
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginationParams {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

impl PaginationParams {
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(100).min(500) as i64
    }

    pub fn offset(&self) -> i64 {
        self.offset.unwrap_or(0) as i64
    }
}
