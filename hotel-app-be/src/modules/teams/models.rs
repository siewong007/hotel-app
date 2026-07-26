//! Team domain types.
//!
//! Every `timestamptz` column is decoded as `DateTime<Utc>`; decoding one as
//! `NaiveDateTime` is a runtime-only failure that no compile step catches.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A department / working team.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Team {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A team plus the counts an index page needs, so the list view is one query.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TeamSummary {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub member_count: i64,
    pub role_count: i64,
}

/// One membership row, joined to the user it names.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TeamMember {
    pub user_id: i64,
    pub username: String,
    pub full_name: Option<String>,
    pub email: String,
    pub is_lead: bool,
    pub joined_at: DateTime<Utc>,
    /// Membership lapses at this instant. Honoured by permission resolution.
    pub expires_at: Option<DateTime<Utc>>,
    /// Who added this member. Written on every insert, unlike the older
    /// `user_roles.assigned_by`, which exists but was never populated.
    pub added_by: Option<i64>,
}

/// A role this team confers on its current members.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TeamRole {
    pub role_id: i64,
    pub name: String,
    pub display_name: String,
    pub priority: i64,
    pub granted_at: DateTime<Utc>,
    pub granted_by: Option<i64>,
}

/// Full team view: the team, who is on it, and what it confers.
#[derive(Debug, Clone, Serialize)]
pub struct TeamDetail {
    pub team: Team,
    pub members: Vec<TeamMember>,
    pub roles: Vec<TeamRole>,
}

#[derive(Debug, Deserialize)]
pub struct TeamCreateInput {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TeamUpdateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TeamMemberInput {
    pub user_id: i64,
    #[serde(default)]
    pub is_lead: bool,
    /// Optional lapse instant for a temporary assignment (a contractor, a
    /// covering shift). Unlike `user_roles.expires_at`, this one is enforced.
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct TeamRoleIdsInput {
    pub role_ids: Vec<i64>,
}
