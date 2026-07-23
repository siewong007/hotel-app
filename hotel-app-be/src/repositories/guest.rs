//! Guest repository for database operations

use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    Guest, GuestBookingRow, GuestCreditRow, GuestPaginationParams, GuestProfileBooking,
    GuestRoomCreditRow, GuestSummary, GuestTourismTaxSignal, GuestUpdateState, GuestUpdateValues,
    LinkGuestInput, LinkedGuestCreditRow,
};
use crate::utils::pagination::Pagination;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::Row;

pub struct GuestRepository;

#[derive(Debug, Clone, Copy)]
pub struct GuestPortalAccountTransfer {
    pub user_id: i64,
    pub previous_guest_id: Option<i64>,
}

fn unique_violation_matches(error: &sqlx::Error, constraint_name: &str) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };

    let is_unique_violation = database_error.code().as_deref() == Some("23505")
        || database_error
            .message()
            .contains("UNIQUE constraint failed");

    is_unique_violation && database_error.message().contains(constraint_name)
}

struct GuestCreateValues<'a> {
    full_name: &'a str,
    first_name: &'a str,
    last_name: &'a str,
    email: Option<&'a str>,
    phone: Option<String>,
    ic_number: Option<String>,
    nationality: Option<String>,
    address_line1: Option<String>,
    city: Option<String>,
    state_province: Option<String>,
    postal_code: Option<String>,
    country: Option<String>,
    guest_type: &'a crate::constants::GuestType,
    tourism_type: &'a Option<crate::constants::TourismType>,
    discount_percentage: i32,
    company_name: Option<String>,
    created_by: i64,
}

impl GuestRepository {
    /// Find all guests
    pub async fn find_all(pool: &DbPool) -> Result<Vec<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE deleted_at IS NULL
            ORDER BY full_name
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guest by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<Guest>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                SELECT id, full_name, email, phone, ic_number, nationality,
                       address_line_1 as address_line1, city, state as state_province,
                       postal_code, country, title, alt_phone, true as is_active,
                       guest_type, tourism_type,
                       COALESCE(discount_percentage, 0) as discount_percentage,
                       company_name,
                       COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                       created_at, updated_at,
                       NULL::BIGINT as bookings_count,
                       NULL::DATE as last_stay_date
                FROM guests
                WHERE id = $1 AND deleted_at IS NULL
            "#,
            sqlite: r#"
                SELECT id, full_name, email, phone, ic_number, nationality,
                       address_line1, city, state_province, postal_code, country,
                       title, alt_phone, 1 as is_active,
                       CASE WHEN guest_type = 'member' THEN 'member' ELSE 'non_member' END as guest_type,
                       tourism_type,
                       COALESCE(discount_percentage, 0) as discount_percentage,
                       company_name,
                       COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                       created_at, updated_at,
                       NULL as bookings_count,
                       NULL as last_stay_date
                FROM guests
                WHERE id = ?1
            "#
        );

        sqlx::query_as::<_, Guest>(query)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guest by email
    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE email = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guests linked to a user
    pub async fn find_by_user_id(pool: &DbPool, user_id: i64) -> Result<Vec<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT g.id, g.full_name, g.email, g.phone, g.ic_number, g.nationality,
                   g.address_line1, g.city, g.state_province, g.postal_code, g.country,
                   g.title, g.alt_phone, g.is_active, g.created_at, g.updated_at
            FROM guests g
            JOIN user_guests ug ON g.id = ug.guest_id
            WHERE ug.user_id = $1 AND g.deleted_at IS NULL
            ORDER BY g.full_name
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a new guest
    pub async fn create(
        pool: &DbPool,
        full_name: &str,
        email: &str,
        phone: Option<&str>,
        ic_number: Option<&str>,
        nationality: Option<&str>,
    ) -> Result<Guest, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            INSERT INTO guests (full_name, email, phone, ic_number, nationality, is_active)
            VALUES ($1, $2, $3, $4, $5, true)
            RETURNING id, full_name, email, phone, ic_number, nationality,
                      address_line1, city, state_province, postal_code, country,
                      title, alt_phone, is_active, created_at, updated_at
            "#,
        )
        .bind(full_name)
        .bind(email)
        .bind(phone)
        .bind(ic_number)
        .bind(nationality)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Link guest to user
    pub async fn link_to_user(
        pool: &DbPool,
        user_id: i64,
        guest_id: i64,
        relationship_type: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify)
            VALUES ($1, $2, $3, true, true, false)
            ON CONFLICT (user_id, guest_id) DO NOTHING
            "#
        )
        .bind(user_id)
        .bind(guest_id)
        .bind(relationship_type)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Unlink guest from user
    pub async fn unlink_from_user(
        pool: &DbPool,
        user_id: i64,
        guest_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM user_guests WHERE user_id = $1 AND guest_id = $2")
            .bind(user_id)
            .bind(guest_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check if guest exists
    pub async fn exists(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1 AND deleted_at IS NULL)",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Soft delete a guest
    pub async fn delete(pool: &DbPool, id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE guests SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn find_paginated(
        pool: &DbPool,
        params: &GuestPaginationParams,
        pagination: Pagination,
    ) -> Result<(i64, Vec<Guest>), ApiError> {
        let search = params.search.as_deref().filter(|s| !s.trim().is_empty());
        let guest_type_filter = params
            .guest_type
            .as_deref()
            .filter(|s| !s.trim().is_empty());
        let tourism_type_filter = params
            .tourism_type
            .as_deref()
            .filter(|s| !s.trim().is_empty());
        let missing_tourism_filter = params.missing_tourism.unwrap_or(false);
        let missing_info_filter = params.missing_info.unwrap_or(false);

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let like_op = "LIKE";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let like_op = "ILIKE";

        let mut filter_clause = String::new();
        match guest_type_filter {
            Some("member") => filter_clause.push_str(" AND guest_type = 'member'"),
            Some("non_member") => {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                filter_clause.push_str(" AND (guest_type != 'member' OR guest_type IS NULL)");
                #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
                filter_clause.push_str(" AND (guest_type = 'non_member' OR guest_type IS NULL)");
            }
            _ => {}
        }
        match tourism_type_filter {
            Some("local") => filter_clause.push_str(" AND tourism_type = 'local'"),
            Some("foreign") => filter_clause.push_str(" AND tourism_type = 'foreign'"),
            _ => {}
        }
        if missing_tourism_filter {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            filter_clause.push_str(" AND NULLIF(TRIM(COALESCE(tourism_type, '')), '') IS NULL");
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            filter_clause.push_str(" AND tourism_type IS NULL");
        }
        if missing_info_filter {
            filter_clause.push_str(
                " AND ((NULLIF(TRIM(COALESCE(email, '')), '') IS NULL \
                 AND NULLIF(TRIM(COALESCE(phone, '')), '') IS NULL) \
                 OR NULLIF(TRIM(COALESCE(ic_number, '')), '') IS NULL)",
            );
        }

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let select_cols = r#"id, full_name, email, phone, ic_number, nationality,
            address_line_1 as address_line1, city, state as state_province,
            postal_code, country, title, alt_phone, true as is_active,
            guest_type, tourism_type,
            COALESCE(discount_percentage, 0) as discount_percentage, company_name,
            COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
            created_at, updated_at,
            (SELECT username FROM users u
                WHERE u.guest_id = guests.id
                  AND u.deleted_at IS NULL
                ORDER BY u.is_active DESC, u.id
                LIMIT 1) AS account_username,
            (SELECT is_active FROM users u
                WHERE u.guest_id = guests.id
                  AND u.deleted_at IS NULL
                ORDER BY u.is_active DESC, u.id
                LIMIT 1) AS account_is_active,
            (SELECT COUNT(*) FROM bookings b
                WHERE b.guest_id = guests.id AND b.status != 'voided') AS bookings_count,
            (SELECT MAX(b.check_in_date) FROM bookings b
                WHERE b.guest_id = guests.id
                  AND b.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed')
            ) AS last_stay_date"#;
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let select_cols = r#"id, full_name, email, phone, ic_number, nationality,
            address_line1, city, state_province, postal_code, country, title, alt_phone,
            1 as is_active,
            CASE WHEN guest_type = 'member' THEN 'member' ELSE 'non_member' END as guest_type,
            tourism_type,
            COALESCE(discount_percentage, 0) as discount_percentage, company_name,
            COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
            created_at, updated_at,
            (SELECT username FROM users u
                WHERE u.guest_id = guests.id
                  AND u.deleted_at IS NULL
                ORDER BY u.is_active DESC, u.id
                LIMIT 1) AS account_username,
            (SELECT is_active FROM users u
                WHERE u.guest_id = guests.id
                  AND u.deleted_at IS NULL
                ORDER BY u.is_active DESC, u.id
                LIMIT 1) AS account_is_active,
            (SELECT COUNT(*) FROM bookings b
                WHERE b.guest_id = guests.id AND b.status != 'voided') AS bookings_count,
            (SELECT MAX(b.check_in_date) FROM bookings b
                WHERE b.guest_id = guests.id
                  AND b.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed')
            ) AS last_stay_date"#;

        if let Some(q) = search {
            let pattern = format!("%{}%", q.trim());

            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let (p_search, p_limit, p_offset) = ("?1", "?2", "?3");
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let (p_search, p_limit, p_offset) = ("$1", "$2", "$3");

            let search_clause = format!(
                "(CAST(id AS TEXT) {like_op} {p_search} \
                 OR COALESCE(full_name, '') {like_op} {p_search} \
                 OR COALESCE(first_name, '') {like_op} {p_search} \
                 OR COALESCE(last_name, '') {like_op} {p_search} \
                 OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) {like_op} {p_search} \
                 OR COALESCE(email, '') {like_op} {p_search} \
                 OR COALESCE(phone, '') {like_op} {p_search} \
                 OR COALESCE(ic_number, '') {like_op} {p_search} \
                 OR COALESCE(company_name, '') {like_op} {p_search} \
                 OR EXISTS (SELECT 1 FROM users u \
                            WHERE u.guest_id = guests.id \
                              AND u.deleted_at IS NULL \
                              AND u.is_active = true \
                              AND u.username {like_op} {p_search}))"
            );

            let count_sql = format!(
                "SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{filter_clause} AND {search_clause}"
            );
            let data_sql = format!(
                "SELECT {select_cols} FROM guests \
                 WHERE deleted_at IS NULL{filter_clause} AND {search_clause} \
                 ORDER BY full_name LIMIT {p_limit} OFFSET {p_offset}"
            );

            let total = sqlx::query_scalar(&count_sql)
                .bind(&pattern)
                .fetch_one(pool)
                .await
                .unwrap_or(0);

            let guests = sqlx::query_as::<_, Guest>(&data_sql)
                .bind(&pattern)
                .bind(pagination.page_size)
                .bind(pagination.offset)
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;

            Ok((total, guests))
        } else {
            let count_sql =
                format!("SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{filter_clause}");
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let (p_limit, p_offset) = ("?1", "?2");
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let (p_limit, p_offset) = ("$1", "$2");
            let data_sql = format!(
                "SELECT {select_cols} FROM guests \
                 WHERE deleted_at IS NULL{filter_clause} \
                 ORDER BY full_name \
                 LIMIT {p_limit} OFFSET {p_offset}"
            );

            let total = sqlx::query_scalar(&count_sql)
                .fetch_one(pool)
                .await
                .unwrap_or(0);

            let guests = sqlx::query_as::<_, Guest>(&data_sql)
                .bind(pagination.page_size)
                .bind(pagination.offset)
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;

            Ok((total, guests))
        }
    }

    pub async fn full_name_conflict_id(
        pool: &DbPool,
        full_name: &str,
        exclude_guest_id: Option<i64>,
    ) -> Result<Option<i64>, ApiError> {
        let id: Option<i64> = if let Some(exclude_guest_id) = exclude_guest_id {
            let query = crate::sql_query!(
                postgres: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND deleted_at IS NULL AND id != $2 LIMIT 1",
                sqlite: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?1)) AND id != ?2 LIMIT 1"
            );

            sqlx::query_scalar(query)
                .bind(full_name)
                .bind(exclude_guest_id)
                .fetch_optional(pool)
                .await
                .map_err(ApiError::from)?
        } else {
            let query = crate::sql_query!(
                postgres: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND deleted_at IS NULL LIMIT 1",
                sqlite: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?1)) LIMIT 1"
            );

            sqlx::query_scalar(query)
                .bind(full_name)
                .fetch_optional(pool)
                .await
                .map_err(ApiError::from)?
        };

        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_detailed(
        pool: &DbPool,
        full_name: &str,
        first_name: &str,
        last_name: &str,
        email: Option<&str>,
        phone: Option<String>,
        ic_number: Option<String>,
        nationality: Option<String>,
        address_line1: Option<String>,
        city: Option<String>,
        state_province: Option<String>,
        postal_code: Option<String>,
        country: Option<String>,
        guest_type: &crate::constants::GuestType,
        tourism_type: &Option<crate::constants::TourismType>,
        discount_percentage: i32,
        company_name: Option<String>,
        created_by: i64,
    ) -> Result<Guest, ApiError> {
        let values = GuestCreateValues {
            full_name,
            first_name,
            last_name,
            email,
            phone,
            ic_number,
            nationality,
            address_line1,
            city,
            state_province,
            postal_code,
            country,
            guest_type,
            tourism_type,
            discount_percentage,
            company_name,
            created_by,
        };

        for attempt in 0..2 {
            let mut tx = pool.begin().await.map_err(ApiError::from)?;

            if let Some(conflicting_guest_id) =
                Self::full_name_conflict_id_tx(&mut tx, values.full_name, None).await?
            {
                tx.rollback().await.map_err(ApiError::from)?;
                return Err(Self::duplicate_guest_create_error(
                    values.full_name,
                    Some(conflicting_guest_id),
                ));
            }

            match Self::insert_detailed_tx(&mut tx, &values).await {
                Ok(guest) => {
                    tx.commit().await.map_err(ApiError::from)?;
                    return Ok(guest);
                }
                Err(error) => {
                    let is_name_conflict =
                        unique_violation_matches(&error, "idx_guests_full_name_unique");
                    let is_sequence_conflict = unique_violation_matches(&error, "guests_pkey");
                    let _ = tx.rollback().await;

                    if is_name_conflict {
                        let conflict_id =
                            Self::full_name_conflict_id(pool, values.full_name, None).await?;
                        return Err(Self::duplicate_guest_create_error(
                            values.full_name,
                            conflict_id,
                        ));
                    }

                    if is_sequence_conflict && attempt == 0 {
                        Self::repair_guest_id_sequence(pool).await?;
                        continue;
                    }

                    return Err(ApiError::from(error));
                }
            }
        }

        Err(ApiError::Internal(
            "Guest creation retry loop exited unexpectedly".to_string(),
        ))
    }

    async fn full_name_conflict_id_tx(
        tx: &mut DbTransaction<'_>,
        full_name: &str,
        exclude_guest_id: Option<i64>,
    ) -> Result<Option<i64>, ApiError> {
        let id: Option<i64> = if let Some(exclude_guest_id) = exclude_guest_id {
            let query = crate::sql_query!(
                postgres: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND deleted_at IS NULL AND id != $2 LIMIT 1",
                sqlite: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?1)) AND id != ?2 LIMIT 1"
            );

            sqlx::query_scalar(query)
                .bind(full_name)
                .bind(exclude_guest_id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(ApiError::from)?
        } else {
            let query = crate::sql_query!(
                postgres: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1)) AND deleted_at IS NULL LIMIT 1",
                sqlite: "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?1)) LIMIT 1"
            );

            sqlx::query_scalar(query)
                .bind(full_name)
                .fetch_optional(&mut **tx)
                .await
                .map_err(ApiError::from)?
        };

        Ok(id)
    }

    async fn insert_detailed_tx(
        tx: &mut DbTransaction<'_>,
        values: &GuestCreateValues<'_>,
    ) -> Result<Guest, sqlx::Error> {
        let query = crate::sql_query!(
            postgres: r#"
                INSERT INTO guests (full_name, first_name, last_name, email, phone, ic_number, nationality, address_line_1, city, state, postal_code, country, guest_type, tourism_type, discount_percentage, company_name, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING id, full_name, email, phone, ic_number, nationality,
                          address_line_1 as address_line1, city, state as state_province,
                          postal_code, country, title, alt_phone, true as is_active,
                          guest_type, tourism_type,
                          COALESCE(discount_percentage, 0) as discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                          created_at, updated_at,
                          NULL::BIGINT as bookings_count,
                          NULL::DATE as last_stay_date
            "#,
            sqlite: r#"
                INSERT INTO guests (full_name, first_name, last_name, email, phone, ic_number, nationality, address_line1, city, state_province, postal_code, country, guest_type, tourism_type, discount_percentage, company_name, created_by)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                RETURNING id, full_name, email, phone, ic_number, nationality,
                          address_line1, city, state_province, postal_code, country,
                          title, alt_phone, 1 as is_active,
                          CASE WHEN guest_type = 'member' THEN 'member' ELSE 'non_member' END as guest_type,
                          tourism_type,
                          COALESCE(discount_percentage, 0) as discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                          created_at, updated_at,
                          NULL as bookings_count,
                          NULL as last_stay_date
            "#
        );

        sqlx::query_as::<_, Guest>(query)
            .bind(values.full_name)
            .bind(values.first_name)
            .bind(values.last_name)
            .bind(values.email)
            .bind(values.phone.as_deref())
            .bind(values.ic_number.as_deref())
            .bind(values.nationality.as_deref())
            .bind(values.address_line1.as_deref())
            .bind(values.city.as_deref())
            .bind(values.state_province.as_deref())
            .bind(values.postal_code.as_deref())
            .bind(values.country.as_deref())
            .bind(values.guest_type)
            .bind(values.tourism_type)
            .bind(values.discount_percentage)
            .bind(values.company_name.as_deref())
            .bind(values.created_by)
            .fetch_one(&mut **tx)
            .await
    }

    async fn repair_guest_id_sequence(pool: &DbPool) -> Result<(), ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let _ = pool;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        {
            let mut tx = pool.begin().await.map_err(ApiError::from)?;

            sqlx::query("LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE")
                .execute(&mut *tx)
                .await
                .map_err(ApiError::from)?;

            sqlx::query(
                r#"
                WITH bounds AS (
                    SELECT COALESCE(MAX(id), 0) AS max_id FROM guests
                ),
                seq AS (
                    SELECT last_value, is_called FROM guests_id_seq
                )
                SELECT CASE
                    WHEN bounds.max_id = 0 AND NOT seq.is_called THEN setval('guests_id_seq', 1, false)
                    ELSE setval('guests_id_seq', GREATEST(seq.last_value, bounds.max_id), true)
                END
                FROM bounds, seq
                "#,
            )
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

            tx.commit().await.map_err(ApiError::from)?;
        }

        Ok(())
    }

    fn duplicate_guest_create_error(full_name: &str, conflict_id: Option<i64>) -> ApiError {
        let id_text = conflict_id
            .map(|id| format!(" (Guest ID #{})", id))
            .unwrap_or_default();

        ApiError::BadRequest(format!(
            "A guest with the name '{}' already exists{}. Please select the existing guest instead of creating a new one.",
            full_name, id_text
        ))
    }

    pub async fn update_state(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestUpdateState>, ApiError> {
        sqlx::query_as::<_, GuestUpdateState>(
            r#"
            SELECT first_name, last_name, email, phone, ic_number, nationality,
                   address_line_1 as address_line1, city, state as state_province,
                   postal_code, country, title, alt_phone, company_name,
                   guest_type, tourism_type, COALESCE(discount_percentage, 0) as discount_percentage
            FROM guests
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn update_detailed(
        pool: &DbPool,
        guest_id: i64,
        values: &GuestUpdateValues,
    ) -> Result<Guest, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            UPDATE guests
            SET full_name = $1,
                first_name = $2,
                last_name = $3,
                email = $4,
                phone = $5,
                ic_number = $6,
                nationality = $7,
                address_line_1 = $8,
                city = $9,
                state = $10,
                postal_code = $11,
                country = $12,
                title = $13,
                alt_phone = $14,
                guest_type = $15,
                tourism_type = $16,
                discount_percentage = $17,
                company_name = $18,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $19
            RETURNING id, full_name, email, phone, ic_number, nationality, address_line_1 as address_line1, city, state as state_province, postal_code, country, title, alt_phone, true as is_active, guest_type, tourism_type, COALESCE(discount_percentage, 0) as discount_percentage, company_name, COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit, created_at, updated_at, NULL::BIGINT as bookings_count, NULL::DATE as last_stay_date
            "#
        )
        .bind(&values.full_name)
        .bind(&values.first_name)
        .bind(&values.last_name)
        .bind(&values.email)
        .bind(&values.phone)
        .bind(&values.ic_number)
        .bind(&values.nationality)
        .bind(&values.address_line1)
        .bind(&values.city)
        .bind(&values.state_province)
        .bind(&values.postal_code)
        .bind(&values.country)
        .bind(&values.title)
        .bind(&values.alt_phone)
        .bind(&values.guest_type)
        .bind(&values.tourism_type)
        .bind(values.discount_percentage)
        .bind(&values.company_name)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn set_tourism_type(
        pool: &DbPool,
        guest_id: i64,
        tourism_type: &crate::constants::TourismType,
    ) -> Result<Guest, ApiError> {
        let tourism_type_text = match tourism_type {
            crate::constants::TourismType::Local => "local",
            crate::constants::TourismType::Foreign => "foreign",
        };

        let query = crate::sql_query!(
            postgres: r#"
                UPDATE guests
                SET tourism_type = $1::tourism_type,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND deleted_at IS NULL
                RETURNING id, full_name, email, phone, ic_number, nationality,
                          address_line_1 as address_line1, city, state as state_province,
                          postal_code, country, title, alt_phone, true as is_active,
                          guest_type, tourism_type,
                          COALESCE(discount_percentage, 0) as discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                          created_at, updated_at,
                          NULL::BIGINT as bookings_count,
                          NULL::DATE as last_stay_date
            "#,
            sqlite: r#"
                UPDATE guests
                SET tourism_type = ?1,
                    updated_at = datetime('now')
                WHERE id = ?2 AND deleted_at IS NULL
                RETURNING id, full_name, email, phone, ic_number, nationality,
                          address_line1, city, state_province, postal_code, country,
                          title, alt_phone, 1 as is_active,
                          CASE WHEN guest_type = 'member' THEN 'member' ELSE 'non_member' END as guest_type,
                          tourism_type,
                          COALESCE(discount_percentage, 0) as discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                          created_at, updated_at,
                          NULL as bookings_count,
                          NULL as last_stay_date
            "#
        );

        sqlx::query_as::<_, Guest>(query)
            .bind(tourism_type_text)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))
    }

    pub async fn last_check_in_tourism_tax_signal(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestTourismTaxSignal>, ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            if !Self::sqlite_table_has_column(pool, "bookings", "tourism_tax_amount").await? {
                return Err(ApiError::BadRequest(
                    "Tourism tax history is not available in this database".to_string(),
                ));
            }
        }

        let query = crate::sql_query!(
            postgres: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0)
                        - COALESCE(SUM(CASE
                            WHEN status = 'refunded' THEN COALESCE(refund_amount, amount)
                            ELSE COALESCE(refund_amount, 0)
                        END), 0) AS net_paid_amount
                    FROM payments
                    GROUP BY booking_id
                )
                SELECT
                    b.id AS booking_id,
                    b.booking_number,
                    b.check_in_date,
                    b.check_out_date,
                    COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount,
                    GREATEST(COALESCE(p.net_paid_amount, 0), 0) AS net_paid_amount
                FROM bookings b
                LEFT JOIN payment_totals p ON p.booking_id = b.id
                WHERE b.guest_id = $1
                  AND b.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed')
                ORDER BY
                    COALESCE(b.actual_check_in, b.created_at) DESC,
                    b.check_in_date DESC,
                    b.id DESC
                LIMIT 1
            "#,
            sqlite: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0)
                        - COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS net_paid_amount
                    FROM payments
                    GROUP BY booking_id
                )
                SELECT
                    b.id AS booking_id,
                    b.booking_number,
                    b.check_in_date,
                    b.check_out_date,
                    COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount,
                    MAX(COALESCE(p.net_paid_amount, 0), 0) AS net_paid_amount
                FROM bookings b
                LEFT JOIN payment_totals p ON p.booking_id = b.id
                WHERE b.guest_id = ?1
                  AND b.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed')
                ORDER BY
                    COALESCE(b.actual_check_in, b.created_at) DESC,
                    b.check_in_date DESC,
                    b.id DESC
                LIMIT 1
            "#
        );

        let row = sqlx::query(query)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;

        row.map(|row| {
            Ok(GuestTourismTaxSignal {
                booking_id: row.get("booking_id"),
                booking_number: row.try_get("booking_number").ok(),
                check_in_date: get_required_date(&row, "check_in_date")?,
                check_out_date: get_required_date(&row, "check_out_date")?,
                tourism_tax_amount: row_mappers::get_decimal(&row, "tourism_tax_amount"),
                net_paid_amount: row_mappers::get_decimal(&row, "net_paid_amount"),
            })
        })
        .transpose()
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    async fn sqlite_table_has_column(
        pool: &DbPool,
        table_name: &str,
        column_name: &str,
    ) -> Result<bool, ApiError> {
        let rows = sqlx::query(&format!("PRAGMA table_info({table_name})"))
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(rows.iter().any(|row| {
            row.try_get::<String, _>("name")
                .is_ok_and(|name| name == column_name)
        }))
    }

    pub async fn exists_any(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> = sqlx::query_scalar("SELECT id FROM guests WHERE id = $1")
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(id.is_some())
    }

    pub async fn has_checked_in_booking(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM bookings WHERE guest_id = $1 AND status = 'checked_in' LIMIT 1",
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(id.is_some())
    }

    pub async fn hard_delete(pool: &DbPool, guest_id: i64) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn guest_bookings(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestBookingRow>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
            SELECT
                b.id,
                b.booking_number,
                b.check_in_date,
                b.check_out_date,
                (b.check_out_date - b.check_in_date) as nights,
                b.status,
                b.total_amount,
                b.created_at,
                r.room_number,
                rt.name as room_type
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.guest_id = $1
            ORDER BY
                CASE
                    WHEN b.status IN ('checked_out', 'completed') THEN 0
                    WHEN b.status IN ('voided', 'comp_void') THEN 1
                    ELSE 2
                END,
                b.check_in_date ASC,
                b.check_out_date ASC,
                b.id ASC
            "#,
            sqlite: r#"
            SELECT
                b.id,
                b.booking_number,
                b.check_in_date,
                b.check_out_date,
                CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER) as nights,
                b.status,
                b.total_amount,
                b.created_at,
                r.room_number,
                rt.name as room_type
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.guest_id = ?1
            ORDER BY
                CASE
                    WHEN b.status IN ('checked_out', 'completed') THEN 0
                    WHEN b.status IN ('voided', 'comp_void') THEN 1
                    ELSE 2
                END,
                b.check_in_date ASC,
                b.check_out_date ASC,
                b.id ASC
            "#
        );
        let rows = sqlx::query(query)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(rows
            .iter()
            .map(|row| GuestBookingRow {
                id: row.get("id"),
                booking_number: row.try_get("booking_number").ok(),
                check_in_date: row.get("check_in_date"),
                check_out_date: row.get("check_out_date"),
                nights: row.try_get("nights").ok(),
                status: row.get("status"),
                total_amount: row_mappers::get_decimal(row, "total_amount"),
                created_at: row.get("created_at"),
                room_number: row.get("room_number"),
                room_type: row.try_get("room_type").unwrap_or_default(),
            })
            .collect())
    }

    pub async fn guest_summary(pool: &DbPool, guest_id: i64) -> Result<GuestSummary, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS total_paid,
                        COALESCE(SUM(CASE
                            WHEN status = 'refunded' THEN COALESCE(refund_amount, amount)
                            ELSE COALESCE(refund_amount, 0)
                        END), 0) AS total_refunded
                    FROM payments
                    GROUP BY booking_id
                ),
                guest_bookings AS (
                    SELECT
                        b.*,
                        COALESCE(p.total_paid, 0) AS total_paid,
                        COALESCE(p.total_refunded, 0) AS total_refunded
                    FROM bookings b
                    LEFT JOIN payment_totals p ON p.booking_id = b.id
                    WHERE b.guest_id = $1 AND b.status NOT IN ('voided', 'comp_void')
                )
                SELECT
                    COALESCE(SUM(CASE WHEN status IN ('checked_out', 'completed') THEN 1 ELSE 0 END), 0)::BIGINT AS completed_stays,
                    COALESCE(SUM(CASE WHEN status IN ('checked_out', 'completed') THEN nights ELSE 0 END), 0)::BIGINT AS total_nights,
                    COALESCE(SUM(CASE WHEN status IN ('checked_out', 'completed') THEN total_amount ELSE 0 END), 0) AS total_room_revenue,
                    MAX(CASE WHEN status IN ('checked_out', 'completed') THEN check_out_date END) AS last_stay_at,
                    MIN(CASE WHEN check_in_date >= CURRENT_DATE THEN check_in_date END) AS next_stay_at,
                    COALESCE(SUM(GREATEST(total_amount - total_paid + total_refunded, 0)), 0) AS outstanding_balance,
                    COUNT(*)::BIGINT AS total_bookings,
                    (
                        SELECT id FROM bookings
                        WHERE guest_id = $1 AND status IN ('checked_in', 'auto_checked_in')
                        ORDER BY check_in_date DESC, id DESC
                        LIMIT 1
                    ) AS active_booking_id,
                    (
                        SELECT booking_number FROM bookings
                        WHERE guest_id = $1 AND status IN ('checked_in', 'auto_checked_in')
                        ORDER BY check_in_date DESC, id DESC
                        LIMIT 1
                    ) AS active_booking_number
                FROM guest_bookings
            "#,
            sqlite: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS total_paid,
                        COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS total_refunded
                    FROM payments
                    GROUP BY booking_id
                ),
                guest_bookings AS (
                    SELECT
                        b.*,
                        COALESCE(p.total_paid, 0) AS total_paid,
                        COALESCE(p.total_refunded, 0) AS total_refunded
                    FROM bookings b
                    LEFT JOIN payment_totals p ON p.booking_id = b.id
                    WHERE b.guest_id = ?1 AND b.status NOT IN ('voided', 'comp_void')
                )
                SELECT
                    COALESCE(SUM(CASE WHEN status IN ('checked_out', 'completed') THEN 1 ELSE 0 END), 0) AS completed_stays,
                    COALESCE(SUM(CASE
                        WHEN status IN ('checked_out', 'completed')
                        THEN CAST(julianday(check_out_date) - julianday(check_in_date) AS INTEGER)
                        ELSE 0
                    END), 0) AS total_nights,
                    COALESCE(SUM(CASE WHEN status IN ('checked_out', 'completed') THEN total_amount ELSE 0 END), 0) AS total_room_revenue,
                    MAX(CASE WHEN status IN ('checked_out', 'completed') THEN check_out_date END) AS last_stay_at,
                    MIN(CASE WHEN date(check_in_date) >= date('now') THEN check_in_date END) AS next_stay_at,
                    COALESCE(SUM(MAX(total_amount - total_paid + total_refunded, 0)), 0) AS outstanding_balance,
                    COUNT(*) AS total_bookings,
                    (
                        SELECT id FROM bookings
                        WHERE guest_id = ?1 AND status IN ('checked_in', 'auto_checked_in')
                        ORDER BY check_in_date DESC, id DESC
                        LIMIT 1
                    ) AS active_booking_id,
                    (
                        SELECT booking_number FROM bookings
                        WHERE guest_id = ?1 AND status IN ('checked_in', 'auto_checked_in')
                        ORDER BY check_in_date DESC, id DESC
                        LIMIT 1
                    ) AS active_booking_number
                FROM guest_bookings
            "#
        );

        let row = sqlx::query(query)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(GuestSummary {
            completed_stays: row.try_get("completed_stays").unwrap_or(0),
            total_nights: row.try_get("total_nights").unwrap_or(0),
            total_room_revenue: row_mappers::get_decimal(&row, "total_room_revenue"),
            last_stay_at: get_optional_date(&row, "last_stay_at"),
            next_stay_at: get_optional_date(&row, "next_stay_at"),
            outstanding_balance: row_mappers::get_decimal(&row, "outstanding_balance"),
            total_bookings: row.try_get("total_bookings").unwrap_or(0),
            active_booking_id: row.try_get("active_booking_id").ok(),
            active_booking_number: row.try_get("active_booking_number").ok(),
        })
    }

    pub async fn guest_profile_bookings(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestProfileBooking>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS total_paid,
                        COALESCE(SUM(CASE
                            WHEN status = 'refunded' THEN COALESCE(refund_amount, amount)
                            ELSE COALESCE(refund_amount, 0)
                        END), 0) AS total_refunded
                    FROM payments
                    GROUP BY booking_id
                )
                SELECT
                    b.id,
                    b.booking_number,
                    b.check_in_date,
                    b.check_out_date,
                    b.nights::BIGINT AS nights,
                    b.status,
                    b.payment_status,
                    b.total_amount,
                    COALESCE(p.total_paid, 0) AS total_paid,
                    GREATEST(b.total_amount - COALESCE(p.total_paid, 0) + COALESCE(p.total_refunded, 0), 0) AS balance_due,
                    b.created_at,
                    r.room_number,
                    COALESCE(rt.name, '') AS room_type,
                    b.special_requests,
                    b.source
                FROM bookings b
                JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON r.room_type_id = rt.id
                LEFT JOIN payment_totals p ON p.booking_id = b.id
                WHERE b.guest_id = $1 AND b.status NOT IN ('voided', 'comp_void')
                ORDER BY b.check_in_date DESC, b.created_at DESC
                LIMIT 50
            "#,
            sqlite: r#"
                WITH payment_totals AS (
                    SELECT
                        booking_id,
                        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS total_paid,
                        COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS total_refunded
                    FROM payments
                    GROUP BY booking_id
                )
                SELECT
                    b.id,
                    b.booking_number,
                    b.check_in_date,
                    b.check_out_date,
                    CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER) AS nights,
                    b.status,
                    b.payment_status,
                    b.total_amount,
                    COALESCE(p.total_paid, 0) AS total_paid,
                    MAX(b.total_amount - COALESCE(p.total_paid, 0) + COALESCE(p.total_refunded, 0), 0) AS balance_due,
                    b.created_at,
                    r.room_number,
                    COALESCE(rt.name, '') AS room_type,
                    b.special_requests,
                    b.source
                FROM bookings b
                JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON r.room_type_id = rt.id
                LEFT JOIN payment_totals p ON p.booking_id = b.id
                WHERE b.guest_id = ?1 AND b.status NOT IN ('voided', 'comp_void')
                ORDER BY b.check_in_date DESC, b.created_at DESC
                LIMIT 50
            "#
        );

        let rows = sqlx::query(query)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        rows.iter()
            .map(|row| {
                Ok(GuestProfileBooking {
                    id: row.get("id"),
                    booking_number: row.try_get("booking_number").ok(),
                    check_in_date: get_required_date(row, "check_in_date")?,
                    check_out_date: get_required_date(row, "check_out_date")?,
                    nights: row.try_get("nights").unwrap_or(0),
                    status: row.get("status"),
                    payment_status: row.try_get("payment_status").ok(),
                    total_amount: row_mappers::get_decimal(row, "total_amount"),
                    total_paid: row_mappers::get_decimal(row, "total_paid"),
                    balance_due: row_mappers::get_decimal(row, "balance_due"),
                    created_at: get_datetime(row, "created_at"),
                    room_number: row.get("room_number"),
                    room_type: row.try_get("room_type").unwrap_or_default(),
                    special_requests: row.try_get("special_requests").ok(),
                    source: row.try_get("source").ok(),
                })
            })
            .collect()
    }

    pub async fn duplicate_candidate_pool(
        pool: &DbPool,
        guest_id: i64,
        email: Option<&str>,
        phone_digits: Option<&str>,
        identity_document: Option<&str>,
        full_name: &str,
        name_pattern: &str,
    ) -> Result<Vec<Guest>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                SELECT id, full_name, email, phone, ic_number, nationality,
                       address_line_1 as address_line1, city, state as state_province,
                       postal_code, country, title, alt_phone, true as is_active,
                       guest_type, tourism_type,
                       COALESCE(discount_percentage, 0) as discount_percentage,
                       company_name,
                       COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                       created_at, updated_at,
                       NULL::BIGINT as bookings_count,
                       NULL::DATE as last_stay_date
                FROM guests
                WHERE id != $1
                  AND deleted_at IS NULL
                  AND (
                    ($2::TEXT IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM($2)))
                    OR ($3::TEXT IS NOT NULL AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $3)
                    OR ($4::TEXT IS NOT NULL AND LOWER(TRIM(ic_number)) = LOWER(TRIM($4)))
                    OR LOWER(TRIM(full_name)) = LOWER(TRIM($5))
                    OR LOWER(full_name) LIKE LOWER($6)
                  )
                ORDER BY updated_at DESC
                LIMIT 100
            "#,
            sqlite: r#"
                SELECT id, full_name, email, phone, ic_number, nationality,
                       address_line1, city, state_province, postal_code, country,
                       title, alt_phone, 1 as is_active,
                       CASE WHEN guest_type = 'member' THEN 'member' ELSE 'non_member' END as guest_type,
                       NULL as tourism_type,
                       0 as discount_percentage,
                       company_name,
                       0 as complimentary_nights_credit,
                       created_at, updated_at,
                       NULL as bookings_count,
                       NULL as last_stay_date
                FROM guests
                WHERE id != ?1
                  AND (
                    (?2 IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(?2)))
                    OR (?3 IS NOT NULL AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '+', ''), '-', ''), ' ', ''), '(', ''), ')', '') = ?3)
                    OR (?4 IS NOT NULL AND LOWER(TRIM(ic_number)) = LOWER(TRIM(?4)))
                    OR LOWER(TRIM(full_name)) = LOWER(TRIM(?5))
                    OR LOWER(full_name) LIKE LOWER(?6)
                  )
                ORDER BY updated_at DESC
                LIMIT 100
            "#
        );

        sqlx::query_as::<_, Guest>(query)
            .bind(guest_id)
            .bind(email)
            .bind(phone_digits)
            .bind(identity_document)
            .bind(full_name)
            .bind(name_pattern)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn upsert_link(
        pool: &DbPool,
        user_id: i64,
        input: LinkGuestInput,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, notes, linked_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, guest_id) DO UPDATE SET
                relationship_type = EXCLUDED.relationship_type,
                can_book_for = EXCLUDED.can_book_for,
                can_view_bookings = EXCLUDED.can_view_bookings,
                can_modify = EXCLUDED.can_modify,
                notes = EXCLUDED.notes
            "#,
        )
        .bind(user_id)
        .bind(input.guest_id)
        .bind(input.relationship_type.unwrap_or_else(|| "owner".to_string()))
        .bind(input.can_book_for.unwrap_or(true))
        .bind(input.can_view_bookings.unwrap_or(true))
        .bind(input.can_modify.unwrap_or(true))
        .bind(input.notes)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    pub async fn unlink(pool: &DbPool, user_id: i64, guest_id: i64) -> Result<bool, ApiError> {
        let result = sqlx::query("DELETE FROM user_guests WHERE user_id = $1 AND guest_id = $2")
            .bind(user_id)
            .bind(guest_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn linked_guests(pool: &DbPool, user_id: i64) -> Result<Vec<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT DISTINCT g.id, g.full_name, g.email, g.phone, g.ic_number, g.nationality,
                   g.address_line_1 as address_line1, g.city, g.state as state_province, g.postal_code, g.country, g.title, g.alt_phone,
                   true as is_active,
                   g.guest_type,
                   g.tourism_type,
                   COALESCE(g.discount_percentage, 0) as discount_percentage,
                   COALESCE(g.complimentary_nights_credit, 0) as complimentary_nights_credit,
                   g.created_at, g.updated_at
            FROM guests g
            INNER JOIN user_guests ug ON g.id = ug.guest_id
            WHERE ug.user_id = $1 AND g.deleted_at IS NULL
            ORDER BY g.full_name
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn has_modifiable_relationship(
        pool: &DbPool,
        user_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2 AND can_modify = true)"
        )
        .bind(user_id)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn upgrade_guest_to_user(
        pool: &DbPool,
        guest_id: i64,
        username: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar("SELECT upgrade_guest_to_user($1, $2, $3, $4)")
            .bind(guest_id)
            .bind(username)
            .bind(password_hash)
            .bind(role)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                let err_msg = e.to_string();
                if err_msg.contains("already exists") {
                    ApiError::BadRequest("User with this email already exists".to_string())
                } else if err_msg.contains("not found") {
                    ApiError::NotFound("Guest not found or deleted".to_string())
                } else {
                    ApiError::Database(err_msg)
                }
            })
    }

    pub async fn transfer_portal_account(
        pool: &DbPool,
        target_guest_id: i64,
        username: &str,
    ) -> Result<GuestPortalAccountTransfer, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        let target_is_active: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM guests WHERE id = $1 AND deleted_at IS NULL AND is_active = true",
        )
        .bind(target_guest_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;
        if target_is_active.is_none() {
            return Err(ApiError::BadRequest(
                "Guest portal accounts can only be assigned to an active guest".to_string(),
            ));
        }

        let account: Option<(i64, Option<i64>)> = sqlx::query_as(
            "SELECT id, guest_id FROM users \
             WHERE username = $1 AND user_type = 'guest' AND is_active = true AND deleted_at IS NULL",
        )
        .bind(username)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;
        let Some((user_id, previous_guest_id)) = account else {
            return Err(ApiError::NotFound(
                "Active guest portal account not found".to_string(),
            ));
        };

        let existing_target_account: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM users \
             WHERE guest_id = $1 AND id <> $2 AND user_type = 'guest' \
               AND is_active = true AND deleted_at IS NULL \
             ORDER BY id LIMIT 1",
        )
        .bind(target_guest_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;
        if existing_target_account.is_some() {
            return Err(ApiError::Conflict(
                "This guest already has an active guest portal account".to_string(),
            ));
        }

        // Portal bearer sessions are scoped to the guest profile rather than
        // the login user. Revoke the old profile's sessions before assigning
        // the login so a transfer cannot leave the previous owner signed in.
        if let Some(previous_guest_id) = previous_guest_id {
            sqlx::query("DELETE FROM guest_portal_sessions WHERE guest_id = $1")
                .bind(previous_guest_id)
                .execute(&mut *tx)
                .await
                .map_err(ApiError::from)?;
        }

        sqlx::query("UPDATE users SET guest_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(target_guest_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(GuestPortalAccountTransfer {
            user_id,
            previous_guest_id,
        })
    }

    pub async fn has_link(pool: &DbPool, user_id: i64, guest_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2)",
        )
        .bind(user_id)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn guest_info(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<(i64, String)>, ApiError> {
        sqlx::query_as("SELECT id, full_name FROM guests WHERE id = $1 AND deleted_at IS NULL")
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn guest_credits(pool: &DbPool, guest_id: i64) -> Vec<GuestCreditRow> {
        sqlx::query_as::<_, GuestCreditRow>(
            r#"
            SELECT
                gcc.id,
                gcc.guest_id,
                gcc.room_type_id,
                rt.name as room_type_name,
                rt.code as room_type_code,
                gcc.nights_available,
                gcc.created_at,
                gcc.updated_at
            FROM guest_complimentary_credits gcc
            INNER JOIN room_types rt ON gcc.room_type_id = rt.id
            WHERE gcc.guest_id = $1 AND gcc.nights_available > 0
            ORDER BY rt.name
            "#,
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    }

    pub async fn legacy_credit_total(pool: &DbPool, guest_id: i64) -> i32 {
        sqlx::query_scalar(
            "SELECT COALESCE(complimentary_nights_credit, 0) FROM guests WHERE id = $1",
        )
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0)
    }

    pub async fn linked_guest_credit_rows(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<LinkedGuestCreditRow>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                SELECT DISTINCT g.id, g.full_name, g.email, COALESCE(g.complimentary_nights_credit, 0) as legacy_credits
                FROM guests g
                INNER JOIN user_guests ug ON g.id = ug.guest_id
                WHERE ug.user_id = $1 AND g.deleted_at IS NULL
                ORDER BY g.full_name
            "#,
            sqlite: r#"
                SELECT DISTINCT
                    g.id,
                    COALESCE(g.full_name, TRIM(g.first_name || ' ' || g.last_name)) as full_name,
                    g.email,
                    0 as legacy_credits
                FROM guests g
                INNER JOIN user_guests ug ON g.id = ug.guest_id
                WHERE ug.user_id = ?1
                ORDER BY full_name
            "#
        );

        sqlx::query_as::<_, LinkedGuestCreditRow>(query)
            .bind(user_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn all_guest_credit_rows(
        pool: &DbPool,
    ) -> Result<Vec<LinkedGuestCreditRow>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
                SELECT DISTINCT g.id, g.full_name, g.email, COALESCE(g.complimentary_nights_credit, 0) as legacy_credits
                FROM guests g
                WHERE g.deleted_at IS NULL
                  AND EXISTS (
                      SELECT 1
                      FROM guest_complimentary_credits gcc
                      WHERE gcc.guest_id = g.id AND gcc.nights_available > 0
                  )
                ORDER BY g.full_name
            "#,
            sqlite: r#"
                SELECT DISTINCT
                    g.id,
                    COALESCE(g.full_name, TRIM(g.first_name || ' ' || g.last_name)) as full_name,
                    g.email,
                    0 as legacy_credits
                FROM guests g
                WHERE EXISTS (
                    SELECT 1
                    FROM guest_complimentary_credits gcc
                    WHERE gcc.guest_id = g.id AND gcc.nights_available > 0
                )
                ORDER BY full_name
            "#
        );

        sqlx::query_as::<_, LinkedGuestCreditRow>(query)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn room_credits_by_guest(pool: &DbPool, guest_id: i64) -> Vec<GuestRoomCreditRow> {
        sqlx::query_as::<_, GuestRoomCreditRow>(
            r#"
            SELECT
                gcc.room_type_id,
                rt.name as room_type_name,
                rt.code as room_type_code,
                gcc.nights_available
            FROM guest_complimentary_credits gcc
            INNER JOIN room_types rt ON gcc.room_type_id = rt.id
            WHERE gcc.guest_id = $1 AND gcc.nights_available > 0
            ORDER BY rt.name
            "#,
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    }
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
fn get_optional_date(row: &DbRow, col: &str) -> Option<NaiveDate> {
    row.try_get::<Option<NaiveDate>, _>(col).ok().flatten()
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn get_optional_date(row: &DbRow, col: &str) -> Option<NaiveDate> {
    row.try_get::<Option<String>, _>(col)
        .ok()
        .flatten()
        .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok())
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
fn get_required_date(row: &DbRow, col: &str) -> Result<NaiveDate, ApiError> {
    row.try_get::<NaiveDate, _>(col)
        .map_err(|e| ApiError::Database(e.to_string()))
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn get_required_date(row: &DbRow, col: &str) -> Result<NaiveDate, ApiError> {
    let value = row
        .try_get::<String, _>(col)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    NaiveDate::parse_from_str(&value, "%Y-%m-%d").map_err(|e| ApiError::Database(e.to_string()))
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
fn get_datetime(row: &DbRow, col: &str) -> DateTime<Utc> {
    row.try_get(col).unwrap_or_else(|_| Utc::now())
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn get_datetime(row: &DbRow, col: &str) -> DateTime<Utc> {
    row.try_get::<String, _>(col)
        .ok()
        .and_then(|value| {
            DateTime::parse_from_rfc3339(&value)
                .map(|dt| dt.with_timezone(&Utc))
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(&value, "%Y-%m-%d %H:%M:%S")
                        .map(|dt| dt.and_utc())
                })
                .ok()
        })
        .unwrap_or_else(Utc::now)
}
