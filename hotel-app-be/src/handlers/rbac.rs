//! RBAC (Role-Based Access Control) handlers
//!
//! Handles roles, permissions, and user access management.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::audit::AuditLog;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use sqlx::{PgPool, Row};

pub async fn get_roles_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<Role>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, description, created_at FROM roles ORDER BY name"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut roles = Vec::new();
    for row in rows {
        roles.push(Role {
            id: row.get(0),
            name: row.get(1),
            description: row.get(2),
            created_at: row.get(3),
        });
    }

    Ok(Json(roles))
}

pub async fn create_role_handler(
    State(pool): State<PgPool>,
    Json(input): Json<RoleInput>,
) -> Result<Json<Role>, ApiError> {
    let row = sqlx::query(
        r#"
        INSERT INTO roles (name, description)
        VALUES ($1, $2)
        RETURNING id, name, description, created_at
        "#
    )
    .bind(&input.name)
    .bind(&input.description)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Role {
        id: row.get(0),
        name: row.get(1),
        description: row.get(2),
        created_at: row.get(3),
    }))
}

pub async fn get_permissions_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<Permission>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, resource, action, description, created_at FROM permissions ORDER BY resource, action"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut permissions = Vec::new();
    for row in rows {
        permissions.push(Permission {
            id: row.get(0),
            name: row.get(1),
            resource: row.get(2),
            action: row.get(3),
            description: row.get(4),
            created_at: row.get(5),
        });
    }

    Ok(Json(permissions))
}

pub async fn create_permission_handler(
    State(pool): State<PgPool>,
    Json(input): Json<PermissionInput>,
) -> Result<Json<Permission>, ApiError> {
    let row = sqlx::query(
        r#"
        INSERT INTO permissions (name, resource, action, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, resource, action, description, created_at
        "#
    )
    .bind(&input.name)
    .bind(&input.resource)
    .bind(&input.action)
    .bind(&input.description)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Permission {
        id: row.get(0),
        name: row.get(1),
        resource: row.get(2),
        action: row.get(3),
        description: row.get(4),
        created_at: row.get(5),
    }))
}

pub async fn assign_role_to_user_handler(
    State(pool): State<PgPool>,
    Json(input): Json<AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query(
        r#"
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        "#
    )
    .bind(input.user_id)
    .bind(input.role_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log role assignment (no admin_id available in this handler)
    let _ = AuditLog::log_role_assignment(&pool, 0, input.user_id, input.role_id).await;

    Ok(Json(serde_json::json!({"message": "Role assigned successfully"})))
}

pub async fn remove_role_from_user_handler(
    State(pool): State<PgPool>,
    Path((user_id, role_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2")
        .bind(user_id)
        .bind(role_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log role removal (no admin_id available in this handler)
    let _ = AuditLog::log_role_removal(&pool, 0, user_id, role_id).await;

    Ok(Json(serde_json::json!({"message": "Role removed successfully"})))
}

pub async fn assign_permission_to_role_handler(
    State(pool): State<PgPool>,
    Json(input): Json<AssignPermissionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query(
        r#"
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT (role_id, permission_id) DO NOTHING
        "#
    )
    .bind(input.role_id)
    .bind(input.permission_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Permission assigned successfully"})))
}

pub async fn remove_permission_from_role_handler(
    State(pool): State<PgPool>,
    Path((role_id, permission_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query("DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2")
        .bind(role_id)
        .bind(permission_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Permission removed successfully"})))
}

pub async fn get_role_permissions_handler(
    State(pool): State<PgPool>,
    Path(role_id): Path<i64>,
) -> Result<Json<RoleWithPermissions>, ApiError> {
    let role_row = sqlx::query(
        "SELECT id, name, description, created_at FROM roles WHERE id = $1"
    )
    .bind(role_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Role not found".to_string()))?;

    let role = Role {
        id: role_row.get(0),
        name: role_row.get(1),
        description: role_row.get(2),
        created_at: role_row.get(3),
    };

    let permission_rows = sqlx::query(
        r#"
        SELECT p.id, p.name, p.resource, p.action, p.description, p.created_at
        FROM permissions p
        INNER JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.resource, p.action
        "#
    )
    .bind(role_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut permissions = Vec::new();
    for row in permission_rows {
        permissions.push(Permission {
            id: row.get(0),
            name: row.get(1),
            resource: row.get(2),
            action: row.get(3),
            description: row.get(4),
            created_at: row.get(5),
        });
    }

    Ok(Json(RoleWithPermissions { role, permissions }))
}

pub async fn get_users_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<UserResponse>>, ApiError> {
    let users = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY username"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_responses: Vec<UserResponse> = users.into_iter().map(|u| u.into()).collect();
    Ok(Json(user_responses))
}

pub async fn create_user_handler(
    State(pool): State<PgPool>,
    Extension(admin_user_id): Extension<i64>,
    Json(input): Json<UserCreateInput>,
) -> Result<Json<UserResponse>, ApiError> {
    let is_super_admin = AuthService::check_role(&pool, admin_user_id, "super_admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_super_admin {
        return Err(ApiError::Unauthorized("Only super admins can create users".to_string()));
    }

    AuthService::validate_password(&input.password)
        .map_err(|e| ApiError::BadRequest(e))?;

    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    let existing_user: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1"
    )
    .bind(&input.username)
    .bind(&input.email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing_user.is_some() {
        return Err(ApiError::BadRequest("Username or email already exists".to_string()));
    }

    let mut tx = pool.begin().await.map_err(|e| ApiError::Database(e.to_string()))?;

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, full_name, phone, is_active, is_verified)
        VALUES ($1, $2, $3, $4, $5, true, true)
        RETURNING id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at
        "#
    )
    .bind(&input.username)
    .bind(&input.email)
    .bind(&password_hash)
    .bind(&input.full_name)
    .bind(&input.phone)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(role_ids) = &input.role_ids {
        for role_id in role_ids {
            let role_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)")
                .bind(role_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            if !role_exists {
                tx.rollback().await.ok();
                return Err(ApiError::BadRequest(format!("Role with id {} does not exist", role_id)));
            }

            let role_name: String = sqlx::query_scalar("SELECT name FROM roles WHERE id = $1")
                .bind(role_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            if (role_name == "super_admin" || role_name == "admin") && !is_super_admin {
                tx.rollback().await.ok();
                return Err(ApiError::Unauthorized("Only super admins can assign admin or super_admin roles".to_string()));
            }

            sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                .bind(user.id)
                .bind(role_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }
    }

    tx.commit().await.map_err(|e| ApiError::Database(e.to_string()))?;

    // Log user creation
    let _ = AuditLog::log_event(
        &pool,
        Some(admin_user_id),
        "user_created",
        "user",
        Some(user.id),
        Some(serde_json::json!({"username": &input.username, "email": &input.email})),
        None,
        None,
    ).await;

    Ok(Json(user.into()))
}

pub async fn get_user_roles_permissions_handler(
    State(pool): State<PgPool>,
    Path(user_id): Path<i64>,
) -> Result<Json<UserWithRolesAndPermissions>, ApiError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    let role_rows = sqlx::query(
        r#"
        SELECT r.id, r.name, r.description, r.created_at
        FROM roles r
        INNER JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = $1
        ORDER BY r.name
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut roles = Vec::new();
    for row in role_rows {
        roles.push(Role {
            id: row.get(0),
            name: row.get(1),
            description: row.get(2),
            created_at: row.get(3),
        });
    }

    let permission_rows = sqlx::query(
        r#"
        SELECT DISTINCT p.id, p.name, p.resource, p.action, p.description, p.created_at
        FROM permissions p
        INNER JOIN role_permissions rp ON p.id = rp.permission_id
        INNER JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1
        ORDER BY p.resource, p.action
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut permissions = Vec::new();
    for row in permission_rows {
        permissions.push(Permission {
            id: row.get(0),
            name: row.get(1),
            resource: row.get(2),
            action: row.get(3),
            description: row.get(4),
            created_at: row.get(5),
        });
    }

    Ok(Json(UserWithRolesAndPermissions { user, roles, permissions }))
}

/// Update an existing role
pub async fn update_role_handler(
    State(pool): State<PgPool>,
    Path(role_id): Path<i64>,
    Json(input): Json<RoleInput>,
) -> Result<Json<Role>, ApiError> {
    // Check if role exists
    let existing: Option<bool> = sqlx::query_scalar(
        "SELECT is_system_role FROM roles WHERE id = $1"
    )
    .bind(role_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match existing {
        None => return Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => return Err(ApiError::BadRequest("Cannot modify system roles".to_string())),
        Some(false) => {}
    }

    let row = sqlx::query(
        r#"
        UPDATE roles
        SET name = $1, description = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, description, created_at
        "#
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(role_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Role {
        id: row.get(0),
        name: row.get(1),
        description: row.get(2),
        created_at: row.get(3),
    }))
}

/// Delete a role
pub async fn delete_role_handler(
    State(pool): State<PgPool>,
    Path(role_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Check if role exists and is not a system role
    let existing: Option<bool> = sqlx::query_scalar(
        "SELECT is_system_role FROM roles WHERE id = $1"
    )
    .bind(role_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match existing {
        None => return Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => return Err(ApiError::BadRequest("Cannot delete system roles".to_string())),
        Some(false) => {}
    }

    // Check if role is assigned to any users
    let user_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_roles WHERE role_id = $1"
    )
    .bind(role_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if user_count > 0 {
        return Err(ApiError::BadRequest(
            format!("Cannot delete role: {} user(s) still have this role assigned", user_count)
        ));
    }

    // Delete role permissions first (cascade should handle this, but being explicit)
    sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
        .bind(role_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete the role
    sqlx::query("DELETE FROM roles WHERE id = $1")
        .bind(role_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Role deleted successfully"})))
}

/// Update an existing permission
pub async fn update_permission_handler(
    State(pool): State<PgPool>,
    Path(permission_id): Path<i64>,
    Json(input): Json<PermissionInput>,
) -> Result<Json<Permission>, ApiError> {
    // Check if permission exists
    let existing: Option<bool> = sqlx::query_scalar(
        "SELECT is_system_permission FROM permissions WHERE id = $1"
    )
    .bind(permission_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match existing {
        None => return Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => return Err(ApiError::BadRequest("Cannot modify system permissions".to_string())),
        Some(false) => {}
    }

    let row = sqlx::query(
        r#"
        UPDATE permissions
        SET name = $1, resource = $2, action = $3, description = $4
        WHERE id = $5
        RETURNING id, name, resource, action, description, created_at
        "#
    )
    .bind(&input.name)
    .bind(&input.resource)
    .bind(&input.action)
    .bind(&input.description)
    .bind(permission_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Permission {
        id: row.get(0),
        name: row.get(1),
        resource: row.get(2),
        action: row.get(3),
        description: row.get(4),
        created_at: row.get(5),
    }))
}

/// Delete a permission
pub async fn delete_permission_handler(
    State(pool): State<PgPool>,
    Path(permission_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Check if permission exists and is not a system permission
    let existing: Option<bool> = sqlx::query_scalar(
        "SELECT is_system_permission FROM permissions WHERE id = $1"
    )
    .bind(permission_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match existing {
        None => return Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => return Err(ApiError::BadRequest("Cannot delete system permissions".to_string())),
        Some(false) => {}
    }

    // Check if permission is assigned to any roles
    let role_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM role_permissions WHERE permission_id = $1"
    )
    .bind(permission_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if role_count > 0 {
        return Err(ApiError::BadRequest(
            format!("Cannot delete permission: {} role(s) still have this permission assigned", role_count)
        ));
    }

    // Delete the permission
    sqlx::query("DELETE FROM permissions WHERE id = $1")
        .bind(permission_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Permission deleted successfully"})))
}
