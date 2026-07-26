//! Team data access. No Axum types here.

use super::models::*;
use crate::core::db::DbPool;
use crate::core::error::ApiError;

pub struct TeamRepository;

impl TeamRepository {
    pub async fn list(pool: &DbPool, include_inactive: bool) -> Result<Vec<TeamSummary>, ApiError> {
        sqlx::query_as::<_, TeamSummary>(
            r#"
            SELECT t.id, t.code, t.name, t.description, t.is_active,
                   t.created_at, t.updated_at,
                   (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
                   (SELECT COUNT(*) FROM team_roles tr WHERE tr.team_id = t.id) AS role_count
            FROM teams t
            WHERE t.deleted_at IS NULL
              AND ($1 OR t.is_active)
            ORDER BY t.name
            "#,
        )
        .bind(include_inactive)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find(pool: &DbPool, team_id: i64) -> Result<Option<Team>, ApiError> {
        sqlx::query_as::<_, Team>(
            "SELECT id, code, name, description, is_active, created_at, updated_at \
             FROM teams WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(team_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn create(
        pool: &DbPool,
        input: &TeamCreateInput,
        actor_user_id: i64,
    ) -> Result<Team, ApiError> {
        sqlx::query_as::<_, Team>(
            r#"
            INSERT INTO teams (code, name, description, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $4)
            RETURNING id, code, name, description, is_active, created_at, updated_at
            "#,
        )
        .bind(&input.code)
        .bind(&input.name)
        .bind(input.description.as_deref())
        .bind(actor_user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            if e.to_string().contains("teams_code_live_key") {
                ApiError::BadRequest(format!("A team with code '{}' already exists", input.code))
            } else {
                ApiError::Database(e.to_string())
            }
        })
    }

    /// COALESCE-style partial update: an omitted field keeps its current value.
    pub async fn update(
        pool: &DbPool,
        team_id: i64,
        input: &TeamUpdateInput,
        actor_user_id: i64,
    ) -> Result<Team, ApiError> {
        sqlx::query_as::<_, Team>(
            r#"
            UPDATE teams
            SET name        = COALESCE($2, name),
                description = COALESCE($3, description),
                is_active   = COALESCE($4, is_active),
                updated_by  = $5,
                updated_at  = CURRENT_TIMESTAMP
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING id, code, name, description, is_active, created_at, updated_at
            "#,
        )
        .bind(team_id)
        .bind(input.name.as_deref())
        .bind(input.description.as_deref())
        .bind(input.is_active)
        .bind(actor_user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Team not found".to_string()))
    }

    /// Soft delete, mirroring `users.deleted_at`. The partial unique index on
    /// `code` is scoped to live rows, so the code becomes reusable afterwards.
    pub async fn soft_delete(
        pool: &DbPool,
        team_id: i64,
        actor_user_id: i64,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query(
            "UPDATE teams SET deleted_at = CURRENT_TIMESTAMP, is_active = false, \
             updated_by = $2, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(team_id)
        .bind(actor_user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn members(pool: &DbPool, team_id: i64) -> Result<Vec<TeamMember>, ApiError> {
        sqlx::query_as::<_, TeamMember>(
            r#"
            SELECT tm.user_id, u.username, u.full_name, u.email,
                   tm.is_lead, tm.joined_at, tm.expires_at, tm.added_by
            FROM team_members tm
            INNER JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = $1 AND u.deleted_at IS NULL
            ORDER BY tm.is_lead DESC, u.username
            "#,
        )
        .bind(team_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn roles(pool: &DbPool, team_id: i64) -> Result<Vec<TeamRole>, ApiError> {
        sqlx::query_as::<_, TeamRole>(
            r#"
            SELECT tr.role_id, r.name, r.display_name, r.priority::BIGINT AS priority,
                   tr.granted_at, tr.granted_by
            FROM team_roles tr
            INNER JOIN roles r ON r.id = tr.role_id
            WHERE tr.team_id = $1
            ORDER BY r.priority DESC, r.name
            "#,
        )
        .bind(team_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Upsert a membership. `added_by` is always written — the whole point of
    /// this column is that "who put this person here" stays answerable.
    pub async fn upsert_member(
        pool: &DbPool,
        team_id: i64,
        input: &TeamMemberInput,
        actor_user_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO team_members (team_id, user_id, is_lead, added_by, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (team_id, user_id) DO UPDATE SET
                is_lead    = EXCLUDED.is_lead,
                added_by   = EXCLUDED.added_by,
                expires_at = EXCLUDED.expires_at
            "#,
        )
        .bind(team_id)
        .bind(input.user_id)
        .bind(input.is_lead)
        .bind(actor_user_id)
        .bind(input.expires_at)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn remove_member(
        pool: &DbPool,
        team_id: i64,
        user_id: i64,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2")
            .bind(team_id)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(result.rows_affected() > 0)
    }

    /// True when the user currently leads this team (an expired membership
    /// does not lead anything).
    pub async fn is_lead(pool: &DbPool, team_id: i64, user_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS ( \
                SELECT 1 FROM team_members \
                WHERE team_id = $1 AND user_id = $2 AND is_lead \
                  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) \
             )",
        )
        .bind(team_id)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn role_ids(pool: &DbPool, team_id: i64) -> Result<Vec<i64>, ApiError> {
        sqlx::query_scalar("SELECT role_id FROM team_roles WHERE team_id = $1")
            .bind(team_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Replace a team's conferred roles in one transaction, writing
    /// `granted_by` for every surviving row.
    pub async fn replace_roles(
        pool: &DbPool,
        team_id: i64,
        role_ids: &[i64],
        actor_user_id: i64,
    ) -> Result<(), ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM team_roles WHERE team_id = $1")
            .bind(team_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in role_ids {
            sqlx::query(
                "INSERT INTO team_roles (team_id, role_id, granted_by) VALUES ($1, $2, $3) \
                 ON CONFLICT DO NOTHING",
            )
            .bind(team_id)
            .bind(role_id)
            .bind(actor_user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }
}
