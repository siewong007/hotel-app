//! Global search models

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct GlobalSearchQuery {
    pub q: Option<String>,
    /// Comma-separated domain filter: `bookings,guests,ledgers,rooms`. Empty = all.
    pub types: Option<String>,
    /// Max results per group.
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub id: i64,
    pub title: String,
    pub subtitle: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
pub struct SearchGroup {
    /// Stable key: `bookings` | `guests` | `ledgers` | `rooms`.
    pub r#type: String,
    pub label: String,
    pub results: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub groups: Vec<SearchGroup>,
}
