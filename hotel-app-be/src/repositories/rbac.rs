//! RBAC (Role-Based Access Control) repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    Permission, Role, RolePermissionAssignment, User, UserCreateInput, UserRoleAssignment,
    UserWithRolesAndPermissions,
};

pub struct RbacRepository;

impl RbacRepository {
    /// Find all roles
    pub async fn find_all_roles(pool: &DbPool) -> Result<Vec<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT id, name, description, created_at
            FROM roles
            ORDER BY name
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find role by ID
    pub async fn find_role_by_id(pool: &DbPool, id: i64) -> Result<Option<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            "SELECT id, name, description, created_at FROM roles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find role by name
    pub async fn find_role_by_name(pool: &DbPool, name: &str) -> Result<Option<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            "SELECT id, name, description, created_at FROM roles WHERE name = $1",
        )
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a new role
    pub async fn create_role(
        pool: &DbPool,
        name: &str,
        description: Option<&str>,
    ) -> Result<Role, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            INSERT INTO roles (name, description)
            VALUES ($1, $2)
            RETURNING id, name, description, created_at
            "#,
        )
        .bind(name)
        .bind(description)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find all permissions
    pub async fn find_all_permissions(pool: &DbPool) -> Result<Vec<Permission>, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT id, name, resource, action, description, created_at
            FROM permissions
            ORDER BY resource, action
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get permissions for a role
    pub async fn get_role_permissions(
        pool: &DbPool,
        role_id: i64,
    ) -> Result<Vec<Permission>, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT p.id, p.name, p.resource, p.action, p.description, p.created_at
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = $1
            ORDER BY p.resource, p.action
            "#,
        )
        .bind(role_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Assign role to user
    pub async fn assign_role_to_user(
        pool: &DbPool,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Remove role from user
    pub async fn remove_role_from_user(
        pool: &DbPool,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2")
            .bind(user_id)
            .bind(role_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Assign permission to role
    pub async fn assign_permission_to_role(
        pool: &DbPool,
        role_id: i64,
        permission_id: i64,
    ) -> Result<(), ApiError> {
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
    pub async fn remove_permission_from_role(
        pool: &DbPool,
        role_id: i64,
        permission_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2")
            .bind(role_id)
            .bind(permission_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Get roles for a user
    pub async fn get_user_roles(pool: &DbPool, user_id: i64) -> Result<Vec<Role>, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT r.id, r.name, r.description, r.created_at
            FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
            ORDER BY r.name
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn create_permission(
        pool: &DbPool,
        name: &str,
        resource: &str,
        action: &str,
        description: Option<&str>,
    ) -> Result<Permission, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            INSERT INTO permissions (name, resource, action, description)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, resource, action, description, created_at
            "#,
        )
        .bind(name)
        .bind(resource)
        .bind(action)
        .bind(description)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_users(pool: &DbPool) -> Result<Vec<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE deleted_at IS NULL ORDER BY username"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn role_permission_assignments(
        pool: &DbPool,
    ) -> Result<Vec<RolePermissionAssignment>, ApiError> {
        sqlx::query_as::<_, RolePermissionAssignment>(
            "SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn user_role_assignments(pool: &DbPool) -> Result<Vec<UserRoleAssignment>, ApiError> {
        sqlx::query_as::<_, UserRoleAssignment>(
            "SELECT user_id, role_id FROM user_roles ORDER BY user_id, role_id",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn role_exists(pool: &DbPool, role_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> = sqlx::query_scalar("SELECT id FROM roles WHERE id = $1")
            .bind(role_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    pub async fn user_exists(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    pub async fn user_role_ids(pool: &DbPool, user_id: i64) -> Result<Vec<i64>, ApiError> {
        sqlx::query_scalar("SELECT role_id FROM user_roles WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn replace_role_permissions(
        pool: &DbPool,
        role_id: i64,
        permission_ids: &[i64],
    ) -> Result<(), ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        for permission_id in permission_ids {
            sqlx::query(
                r#"
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES ($1, $2)
                ON CONFLICT (role_id, permission_id) DO NOTHING
                "#,
            )
            .bind(role_id)
            .bind(permission_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn replace_user_roles(
        pool: &DbPool,
        user_id: i64,
        role_ids: &[i64],
    ) -> Result<(), ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in role_ids {
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(user_id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_user_by_id(pool: &DbPool, user_id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn get_user_permissions(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<Permission>, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT DISTINCT p.id, p.name, p.resource, p.action, p.description, p.created_at
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            INNER JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1
            ORDER BY p.resource, p.action
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn user_with_roles_permissions(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<UserWithRolesAndPermissions, ApiError> {
        let user = Self::find_user_by_id(pool, user_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;
        let roles = Self::get_user_roles(pool, user_id).await?;
        let permissions = Self::get_user_permissions(pool, user_id).await?;

        Ok(UserWithRolesAndPermissions {
            user,
            roles,
            permissions,
        })
    }

    pub async fn role_system_status(pool: &DbPool, role_id: i64) -> Result<Option<bool>, ApiError> {
        sqlx::query_scalar("SELECT is_system_role FROM roles WHERE id = $1")
            .bind(role_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_role(
        pool: &DbPool,
        role_id: i64,
        name: &str,
        description: Option<&str>,
    ) -> Result<Role, ApiError> {
        sqlx::query_as::<_, Role>(
            r#"
            UPDATE roles
            SET name = $1, description = $2, updated_at = NOW()
            WHERE id = $3
            RETURNING id, name, description, created_at
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(role_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn user_count_for_role(pool: &DbPool, role_id: i64) -> Result<i64, ApiError> {
        sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE role_id = $1")
            .bind(role_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn delete_role(pool: &DbPool, role_id: i64) -> Result<(), ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM roles WHERE id = $1")
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn permission_system_status(
        pool: &DbPool,
        permission_id: i64,
    ) -> Result<Option<bool>, ApiError> {
        sqlx::query_scalar("SELECT is_system_permission FROM permissions WHERE id = $1")
            .bind(permission_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_permission(
        pool: &DbPool,
        permission_id: i64,
        name: &str,
        resource: &str,
        action: &str,
        description: Option<&str>,
    ) -> Result<Permission, ApiError> {
        sqlx::query_as::<_, Permission>(
            r#"
            UPDATE permissions
            SET name = $1, resource = $2, action = $3, description = $4
            WHERE id = $5
            RETURNING id, name, resource, action, description, created_at
            "#,
        )
        .bind(name)
        .bind(resource)
        .bind(action)
        .bind(description)
        .bind(permission_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn role_count_for_permission(
        pool: &DbPool,
        permission_id: i64,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar("SELECT COUNT(*) FROM role_permissions WHERE permission_id = $1")
            .bind(permission_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn delete_permission(pool: &DbPool, permission_id: i64) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM permissions WHERE id = $1")
            .bind(permission_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn role_name_by_id(pool: &DbPool, role_id: i64) -> Result<Option<String>, ApiError> {
        sqlx::query_scalar("SELECT name FROM roles WHERE id = $1")
            .bind(role_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn create_user_with_roles(
        pool: &DbPool,
        input: &UserCreateInput,
        password_hash: &str,
        role_ids: &[i64],
    ) -> Result<User, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (username, email, password_hash, full_name, phone, is_active, is_verified)
            VALUES ($1, $2, $3, $4, $5, true, true)
            RETURNING id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at
            "#,
        )
        .bind(&input.username)
        .bind(&input.email)
        .bind(password_hash)
        .bind(&input.full_name)
        .bind(&input.phone)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in role_ids {
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(user.id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(user)
    }
}
