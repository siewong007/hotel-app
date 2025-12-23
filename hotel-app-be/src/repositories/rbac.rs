//! RBAC (Role-Based Access Control) repository for database operations

use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::{Role, Permission};

pub struct RbacRepository;

impl RbacRepository {
    /// Find all roles
    pub async fn find_all_roles(pool: &PgPool) -> Result<Vec<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT id, name, description, created_at
            FROM roles
            ORDER BY name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find role by ID
    pub async fn find_role_by_id(pool: &PgPool, id: i64) -> Result<Option<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            "SELECT id, name, description, created_at FROM roles WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find role by name
    pub async fn find_role_by_name(pool: &PgPool, name: &str) -> Result<Option<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            "SELECT id, name, description, created_at FROM roles WHERE name = $1"
        )
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a new role
    pub async fn create_role(pool: &PgPool, name: &str, description: Option<&str>) -> Result<Role, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            INSERT INTO roles (name, description)
            VALUES ($1, $2)
            RETURNING id, name, description, created_at
            "#
        )
        .bind(name)
        .bind(description)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find all permissions
    pub async fn find_all_permissions(pool: &PgPool) -> Result<Vec<Permission>, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT id, name, resource, action, description, created_at
            FROM permissions
            ORDER BY resource, action
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get permissions for a role
    pub async fn get_role_permissions(pool: &PgPool, role_id: i64) -> Result<Vec<Permission>, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT p.id, p.name, p.resource, p.action, p.description, p.created_at
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = $1
            ORDER BY p.resource, p.action
            "#
        )
        .bind(role_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Assign role to user
    pub async fn assign_role_to_user(pool: &PgPool, user_id: i64, role_id: i64) -> Result<(), ApiError> {
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        )
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Remove role from user
    pub async fn remove_role_from_user(pool: &PgPool, user_id: i64, role_id: i64) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2")
            .bind(user_id)
            .bind(role_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Assign permission to role
    pub async fn assign_permission_to_role(pool: &PgPool, role_id: i64, permission_id: i64) -> Result<(), ApiError> {
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        )
        .bind(role_id)
        .bind(permission_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Remove permission from role
    pub async fn remove_permission_from_role(pool: &PgPool, role_id: i64, permission_id: i64) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2")
            .bind(role_id)
            .bind(permission_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Get roles for a user
    pub async fn get_user_roles(pool: &PgPool, user_id: i64) -> Result<Vec<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT r.id, r.name, r.description, r.created_at
            FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
            ORDER BY r.name
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }
}
