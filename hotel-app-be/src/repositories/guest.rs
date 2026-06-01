//! Guest repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    Guest, GuestBookingRow, GuestCreditRow, GuestPaginationParams, GuestRoomCreditRow,
    GuestUpdateState, GuestUpdateValues, LinkGuestInput, LinkedGuestCreditRow,
};
use crate::utils::pagination::Pagination;

pub struct GuestRepository;

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
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
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

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let like_op = "LIKE";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let like_op = "ILIKE";

        let type_clause = match guest_type_filter {
            Some("member") => " AND guest_type = 'member'",
            Some("non_member") => " AND (guest_type = 'non_member' OR guest_type IS NULL)",
            _ => "",
        };

        let select_cols = r#"id, full_name, email, phone, ic_number, nationality,
            address_line_1 as address_line1, city, state as state_province,
            postal_code, country, title, alt_phone, true as is_active,
            guest_type, tourism_type,
            COALESCE(discount_percentage, 0) as discount_percentage, company_name,
            COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
            created_at, updated_at,
            (SELECT COUNT(*) FROM bookings b
                WHERE b.guest_id = guests.id AND b.status != 'voided') AS bookings_count,
            (SELECT MAX(b.check_in_date) FROM bookings b
                WHERE b.guest_id = guests.id
                  AND b.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed')
            ) AS last_stay_date"#;

        if let Some(q) = search {
            let pattern = format!("%{}%", q.trim());

            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let (p1, p2, p3, p_limit, p_offset) = ("?1", "?1", "?1", "?2", "?3");
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let (p1, p2, p3, p_limit, p_offset) = ("$1", "$1", "$1", "$2", "$3");

            let count_sql = format!(
                "SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{type_clause} AND \
                 (full_name {like_op} {p1} OR email {like_op} {p2} OR phone {like_op} {p3})"
            );
            let data_sql = format!(
                "SELECT {select_cols} FROM guests \
                 WHERE deleted_at IS NULL{type_clause} AND \
                 (full_name {like_op} {p1} OR email {like_op} {p2} OR phone {like_op} {p3}) \
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
                format!("SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{type_clause}");
            let data_sql = format!(
                "SELECT {select_cols} FROM guests \
                 WHERE deleted_at IS NULL{type_clause} \
                 ORDER BY full_name \
                 LIMIT $1 OFFSET $2"
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

    pub async fn full_name_conflict(
        pool: &DbPool,
        full_name: &str,
        exclude_guest_id: Option<i64>,
    ) -> Result<bool, ApiError> {
        let id: Option<i64> = if let Some(exclude_guest_id) = exclude_guest_id {
            sqlx::query_scalar(
                "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER($1) AND deleted_at IS NULL AND id != $2 LIMIT 1",
            )
            .bind(full_name)
            .bind(exclude_guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?
        } else {
            sqlx::query_scalar(
                "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER($1) AND deleted_at IS NULL LIMIT 1",
            )
            .bind(full_name)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?
        };

        Ok(id.is_some())
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
        sqlx::query_as::<_, Guest>(
            r#"
            INSERT INTO guests (full_name, first_name, last_name, email, phone, ic_number, nationality, address_line_1, city, state, postal_code, country, guest_type, tourism_type, discount_percentage, company_name, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id, full_name, email, phone, ic_number, nationality, address_line_1 as address_line1, city, state as state_province, postal_code, country,
                      NULL::TEXT as title, NULL::TEXT as alt_phone,
                      true as is_active,
                      guest_type,
                      tourism_type,
                      COALESCE(discount_percentage, 0) as discount_percentage,
                      company_name,
                      COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                      created_at, updated_at
            "#
        )
        .bind(full_name)
        .bind(first_name)
        .bind(last_name)
        .bind(email)
        .bind(phone)
        .bind(ic_number)
        .bind(nationality)
        .bind(address_line1)
        .bind(city)
        .bind(state_province)
        .bind(postal_code)
        .bind(country)
        .bind(guest_type)
        .bind(tourism_type)
        .bind(discount_percentage)
        .bind(company_name)
        .bind(created_by)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
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
            RETURNING id, full_name, email, phone, ic_number, nationality, address_line_1 as address_line1, city, state as state_province, postal_code, country, title, alt_phone, true as is_active, guest_type, tourism_type, COALESCE(discount_percentage, 0) as discount_percentage, company_name, COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit, created_at, updated_at
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
        sqlx::query_as::<_, GuestBookingRow>(
            r#"
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
            ORDER BY b.created_at DESC
            "#,
        )
        .bind(guest_id)
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
        sqlx::query_as::<_, LinkedGuestCreditRow>(
            r#"
            SELECT DISTINCT g.id, g.full_name, g.email, COALESCE(g.complimentary_nights_credit, 0) as legacy_credits
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
