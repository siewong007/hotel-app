//! Role-Based Access Control models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::user::{User, UserResponse};

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

/// Bulk input for replacing a role's permissions
#[derive(Debug, Serialize, Deserialize)]
pub struct RolePermissionIdsInput {
    pub permission_ids: Vec<i64>,
}

/// Bulk input for replacing a user's roles
#[derive(Debug, Serialize, Deserialize)]
pub struct UserRoleIdsInput {
    pub role_ids: Vec<i64>,
}

/// Role-permission join row
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RolePermissionAssignment {
    pub role_id: i64,
    pub permission_id: i64,
}

/// User-role join row
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserRoleAssignment {
    pub user_id: i64,
    pub role_id: i64,
}

/// Snapshot used by the RBAC management UI to avoid N+1 loading
#[derive(Debug, Serialize, Deserialize)]
pub struct RbacSnapshot {
    pub roles: Vec<Role>,
    pub permissions: Vec<Permission>,
    pub users: Vec<UserResponse>,
    pub role_permissions: Vec<RolePermissionAssignment>,
    pub user_roles: Vec<UserRoleAssignment>,
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
