//! Role-Based Access Control models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::user::User;

/// Role entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Role {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Input for creating/updating a role
#[derive(Debug, Serialize, Deserialize)]
pub struct RoleInput {
    pub name: String,
    pub description: Option<String>,
}

/// Permission entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Permission {
    pub id: i64,
    pub name: String,
    pub resource: String,
    pub action: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Input for creating a permission
#[derive(Debug, Serialize, Deserialize)]
pub struct PermissionInput {
    pub name: String,
    pub resource: String,
    pub action: String,
    pub description: Option<String>,
}

/// Input for assigning a role to a user
#[derive(Debug, Serialize, Deserialize)]
pub struct AssignRoleInput {
    pub user_id: i64,
    pub role_id: i64,
}

/// Input for assigning a permission to a role
#[derive(Debug, Serialize, Deserialize)]
pub struct AssignPermissionInput {
    pub role_id: i64,
    pub permission_id: i64,
}

/// Role with its permissions
#[derive(Debug, Serialize, Deserialize)]
pub struct RoleWithPermissions {
    pub role: Role,
    pub permissions: Vec<Permission>,
}

/// User with roles and permissions
#[derive(Debug, Serialize, Deserialize)]
pub struct UserWithRolesAndPermissions {
    pub user: User,
    pub roles: Vec<Role>,
    pub permissions: Vec<Permission>,
}
