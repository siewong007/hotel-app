use crate::auth::AuthService;
use crate::models::*;
use crate::middleware::{require_auth, require_permission_helper};
use sqlx::{PgPool, Row};
use axum::{
    extract::{Path, Query, State, Extension},
    http::{StatusCode, HeaderMap},
    response::{Json, Response, IntoResponse},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::env;
use rand::Rng;

// Helper function to decode base64url (URL-safe base64) used by WebAuthn
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    // Convert base64url to standard base64
    let standard_b64 = input
        .replace('-', "+")
        .replace('_', "/");

    // Add padding if needed
    let padding = match standard_b64.len() % 4 {
        2 => "==",
        3 => "=",
        _ => "",
    };
    let padded = format!("{}{}", standard_b64, padding);

    // Decode using standard base64
    base64::decode(&padded).map_err(|e| format!("Base64 decode error: {}", e))
}

pub async fn login_handler(
    State(pool): State<sqlx::PgPool>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE username = $1 OR email = $1"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user = match user {
        Some(u) if u.is_active => u,
        Some(_) => return Err(ApiError::Unauthorized("Account is inactive".to_string())),
        None => return Err(ApiError::Unauthorized("Invalid credentials".to_string())),
    };

    // Get password hash
    let password_hash: String = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Verify password
    let valid = AuthService::verify_password(&req.password, &password_hash).await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized("Invalid credentials".to_string()));
    }

    // Get roles and permissions
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate tokens
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    // Generate secure refresh token
    let refresh_token = AuthService::generate_refresh_token();

    // Check if this is the first login
    let is_first_login: bool = sqlx::query_scalar(
        "SELECT last_login_at IS NULL FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Store refresh token (expires in 30 days)
    AuthService::store_refresh_token(&pool, user.id, &refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    let response = AuthResponse {
        access_token,
        refresh_token,
        user,
        roles,
        permissions,
        is_first_login,
    };

    Ok(Json(response))
}

pub async fn refresh_token_handler(
    State(pool): State<sqlx::PgPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<RefreshTokenResponse>, ApiError> {
    // Validate refresh token
    let user_id = AuthService::validate_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::Unauthorized("Invalid or expired refresh token".to_string()))?;

    // Get user info
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Unauthorized("User not found".to_string()))?;

    if !user.is_active {
        return Err(ApiError::Unauthorized("Account is inactive".to_string()));
    }

    // Get roles
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate new access token
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    // Generate new refresh token
    let new_refresh_token = AuthService::generate_refresh_token();

    // Revoke old refresh token
    AuthService::revoke_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to revoke old token: {}", e)))?;

    // Store new refresh token (expires in 30 days)
    AuthService::store_refresh_token(&pool, user.id, &new_refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    let response = RefreshTokenResponse {
        access_token,
        refresh_token: new_refresh_token,
    };

    Ok(Json(response))
}

pub async fn logout_handler(
    State(pool): State<sqlx::PgPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Revoke the refresh token
    AuthService::revoke_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to revoke token: {}", e)))?;

    Ok(Json(serde_json::json!({"message": "Logged out successfully"})))
}

pub async fn get_rooms_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<crate::models::RoomWithRating>>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            CASE WHEN r.status = 'available' THEN true ELSE false END as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at,
            rtr.average_rating,
            rtr.review_count
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN room_type_ratings rtr ON rt.id = rtr.room_type_id
        WHERE r.is_active = true
        ORDER BY r.room_number
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        // Handle nullable rating fields from LEFT JOIN
        let average_rating: Option<rust_decimal::Decimal> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();

        rooms.push(crate::models::RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating: average_rating.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
            review_count,
        });
    }

    Ok(Json(rooms))
}

pub async fn search_rooms_handler(
    State(pool): State<sqlx::PgPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<crate::models::RoomWithRating>>, ApiError> {
    let mut sql = r#"
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            CASE WHEN r.status = 'available' THEN true ELSE false END as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at,
            rtr.average_rating,
            rtr.review_count
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN room_type_ratings rtr ON rt.id = rtr.room_type_id
        WHERE r.status = 'available' AND r.is_active = true
    "#.to_string();

    let mut params: Vec<String> = vec![];

    if let Some(room_type) = &query.room_type {
        sql.push_str(" AND rt.name ILIKE $1");
        params.push(format!("%{}%", room_type));
    }

    if let Some(max_price) = query.max_price {
        sql.push_str(" AND COALESCE(r.custom_price, rt.base_price) <= $2");
        params.push(max_price.to_string());
    }

    sql.push_str(" ORDER BY COALESCE(r.custom_price, rt.base_price)");

    let rows = if params.is_empty() {
        sqlx::query(&sql)
            .fetch_all(&pool)
            .await
    } else if params.len() == 1 {
        sqlx::query(&sql)
            .bind(&params[0])
            .fetch_all(&pool)
            .await
    } else {
        sqlx::query(&sql)
            .bind(&params[0])
            .bind(&params[1])
            .fetch_all(&pool)
            .await
    }
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        // Handle nullable rating fields from LEFT JOIN
        let average_rating: Option<rust_decimal::Decimal> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();

        rooms.push(crate::models::RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating: average_rating.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
            review_count,
        });
    }

    Ok(Json(rooms))
}

pub async fn update_room_handler(
    State(pool): State<sqlx::PgPool>,
    Path(room_id): Path<i64>,
    Json(input): Json<crate::models::RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    // First, check if room exists and get current values
    let existing_row = sqlx::query(
        "SELECT id, room_number, room_type, price_per_night::text, available, description, max_occupancy, created_at, updated_at FROM rooms WHERE id = $1"
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    // Get current values
    let current_room_number: String = existing_row.get(1);
    let current_room_type: String = existing_row.get(2);
    let current_price: Decimal = existing_row.get::<String, _>(3).parse().unwrap_or_default();
    let current_available: bool = existing_row.get(4);
    let current_description: Option<String> = existing_row.get(5);
    let current_max_occupancy: i32 = existing_row.get(6);

    // Use provided values or keep current ones
    let room_number = input.room_number.as_ref().unwrap_or(&current_room_number);
    let room_type = input.room_type.as_ref().unwrap_or(&current_room_type);
    let price_per_night = input.price_per_night
        .map(|p| rust_decimal::Decimal::from_f64_retain(p).unwrap_or_default())
        .unwrap_or(current_price);
    let available = input.available.unwrap_or(current_available);
    let description = input.description.as_ref().or(current_description.as_ref());
    let max_occupancy = input.max_occupancy.unwrap_or(current_max_occupancy);

    // Check if anything actually changed
    if input.room_number.is_none() 
        && input.room_type.is_none() 
        && input.price_per_night.is_none() 
        && input.available.is_none() 
        && input.description.is_none() 
        && input.max_occupancy.is_none() {
        // No changes, return existing room
        return Ok(Json(Room {
            id: existing_row.get(0),
            room_number: current_room_number,
            room_type: current_room_type,
            price_per_night: current_price,
            available: current_available,
            description: current_description,
            max_occupancy: current_max_occupancy,
            created_at: existing_row.get(7),
            updated_at: existing_row.get(8),
        }));
    }

    // Update room
    let row = sqlx::query(
        r#"
        UPDATE rooms 
        SET room_number = $1,
            room_type = $2,
            price_per_night = $3,
            available = $4,
            description = $5,
            max_occupancy = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING id, room_number, room_type, price_per_night::text, available, description, max_occupancy, created_at, updated_at
        "#
    )
    .bind(room_number)
    .bind(room_type)
    .bind(price_per_night)
    .bind(available)
    .bind(description)
    .bind(max_occupancy)
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let room = Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get(5),
        max_occupancy: row.get(6),
        created_at: row.get(7),
        updated_at: row.get(8),
    };

    Ok(Json(room))
}

pub async fn get_guests_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    use crate::auth::AuthService;
    use crate::middleware::require_auth;

    // Get authenticated user
    let user_id = require_auth(&headers).await?;

    // Check if user is admin
    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let guests = if is_admin {
        // Admin sees all guests
        sqlx::query_as::<_, Guest>(
            "SELECT id, full_name, email, phone, address_line1, city, state_province, postal_code, country, created_at, updated_at FROM guests WHERE deleted_at IS NULL ORDER BY full_name"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        // Regular users see only their linked guests
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT DISTINCT g.id, g.full_name, g.email, g.phone, g.address_line1, g.city, g.state_province, g.postal_code, g.country, g.created_at, g.updated_at
            FROM guests g
            INNER JOIN user_guests ug ON g.id = ug.guest_id
            WHERE ug.user_id = $1 AND g.deleted_at IS NULL
            ORDER BY g.full_name
            "#
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    Ok(Json(guests))
}

pub async fn create_guest_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
    Json(input): Json<GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    use crate::middleware::require_auth;

    // Get authenticated user (will be used by trigger to auto-link)
    let user_id = require_auth(&headers).await?;

    let guest = sqlx::query_as::<_, Guest>(
        r#"
        INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, full_name, email, phone, address_line1, city, state_province, postal_code, country, created_at, updated_at
        "#
    )
    .bind(&input.first_name)
    .bind(&input.last_name)
    .bind(&input.email)
    .bind(&input.phone)
    .bind(&input.address_line1)
    .bind(&input.city)
    .bind(&input.state_province)
    .bind(&input.postal_code)
    .bind(&input.country)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(guest))
}

pub async fn get_bookings_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            b.id,
            b.guest_id,
            g.full_name as guest_name,
            g.email as guest_email,
            b.room_id,
            r.room_number,
            rt.name as room_type,
            rt.code as room_type_code,
            b.check_in_date,
            b.check_out_date,
            b.total_amount::text,
            b.status,
            b.folio_number,
            b.post_type,
            b.rate_code,
            b.created_at
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        ORDER BY b.created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut bookings = Vec::new();
    for row in rows {
        bookings.push(BookingWithDetails {
            id: row.get(0),
            guest_id: row.get(1),
            guest_name: row.get(2),
            guest_email: row.get(3),
            room_id: row.get(4),
            room_number: row.get(5),
            room_type: row.get(6),
            room_type_code: row.get(7),
            check_in_date: row.get(8),
            check_out_date: row.get(9),
            total_amount: row.get::<String, _>(10).parse().unwrap_or_default(),
            status: row.get(11),
            folio_number: row.get(12),
            post_type: row.get(13),
            rate_code: row.get(14),
            created_at: row.get(15),
        });
    }

    Ok(Json(bookings))
}

pub async fn get_my_bookings_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    // Get authenticated user's ID
    let user_id = require_auth(&headers).await?;

    // Get the user's email
    let user_email: String = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Fetch bookings where guest email matches user email
    let rows = sqlx::query(
        r#"
        SELECT
            b.id,
            b.guest_id,
            g.full_name as guest_name,
            g.email as guest_email,
            b.room_id,
            r.room_number,
            rt.name as room_type,
            rt.code as room_type_code,
            b.check_in_date,
            b.check_out_date,
            b.total_amount::text,
            b.status,
            b.folio_number,
            b.post_type,
            b.rate_code,
            b.created_at
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE g.email = $1
        ORDER BY b.created_at DESC
        "#
    )
    .bind(&user_email)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut bookings = Vec::new();
    for row in rows {
        bookings.push(BookingWithDetails {
            id: row.get(0),
            guest_id: row.get(1),
            guest_name: row.get(2),
            guest_email: row.get(3),
            room_id: row.get(4),
            room_number: row.get(5),
            room_type: row.get(6),
            room_type_code: row.get(7),
            check_in_date: row.get(8),
            check_out_date: row.get(9),
            total_amount: row.get::<String, _>(10).parse().unwrap_or_default(),
            status: row.get(11),
            folio_number: row.get(12),
            post_type: row.get(13),
            rate_code: row.get(14),
            created_at: row.get(15),
        });
    }

    Ok(Json(bookings))
}

pub async fn create_booking_handler(
    State(pool): State<sqlx::PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, ApiError> {
    // Parse dates
    let check_in = NaiveDate::parse_from_str(&input.check_in_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-in date format".to_string()))?;
    let check_out = NaiveDate::parse_from_str(&input.check_out_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-out date format".to_string()))?;

    if check_out <= check_in {
        return Err(ApiError::BadRequest("Check-out date must be after check-in date".to_string()));
    }

    // Check if room exists and get its price
    let row = sqlx::query(
        r#"
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            CASE WHEN r.status = 'available' THEN true ELSE false END as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1 AND r.is_active = true
        "#
    )
    .bind(input.room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let room = Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get(5),
        max_occupancy: row.get(6),
        created_at: row.get(7),
        updated_at: row.get(8),
    };

    if !room.available {
        return Err(ApiError::BadRequest("Room is not available".to_string()));
    }

    // Check for date conflicts
    let conflict = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
            AND status NOT IN ('cancelled', 'no_show')
            AND (
                (check_in_date <= $2 AND check_out_date > $2) OR
                (check_in_date < $3 AND check_out_date >= $3) OR
                (check_in_date >= $2 AND check_out_date <= $3)
            )
        )
        "#
    )
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if conflict {
        return Err(ApiError::BadRequest("Room is already booked for these dates".to_string()));
    }

    // Calculate total amounts
    let nights = (check_out - check_in).num_days() as i32;
    let room_rate = room.price_per_night;
    let subtotal = room_rate * Decimal::from(nights);
    let tax_amount = subtotal * Decimal::from_str_exact("0.10").unwrap_or_default(); // 10% tax
    let total_amount = subtotal + tax_amount;

    // Generate booking number
    let booking_number = format!("BK-{}-{:04}", chrono::Utc::now().format("%Y%m%d"),
        sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(id), 0) + 1 FROM bookings")
            .fetch_one(&pool)
            .await
            .unwrap_or(1)
    );

    // Create booking
    let row = sqlx::query(
        r#"
        INSERT INTO bookings (
            booking_number, guest_id, room_id, check_in_date, check_out_date,
            room_rate, subtotal, tax_amount, total_amount, status, post_type, rate_code, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12)
        RETURNING id, guest_id, room_id, check_in_date, check_out_date, total_amount::text, status, folio_number, post_type, rate_code, created_by, created_at, updated_at
        "#
    )
    .bind(&booking_number)
    .bind(input.guest_id)
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(room_rate)
    .bind(subtotal)
    .bind(tax_amount)
    .bind(total_amount)
    .bind(input.post_type.as_deref().unwrap_or("normal_stay"))
    .bind(input.rate_code.as_deref().unwrap_or("RACK"))
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let booking = Booking {
        id: row.get(0),
        guest_id: row.get(1),
        room_id: row.get(2),
        check_in_date: row.get(3),
        check_out_date: row.get(4),
        total_amount: row.get::<String, _>(5).parse().unwrap_or_default(),
        status: row.get(6),
        folio_number: row.get(7),
        post_type: row.get(8),
        rate_code: row.get(9),
        created_by: row.get(10),
        created_at: row.get(11),
        updated_at: row.get(12),
    };

    // Update room availability if needed (optional - you might want to keep it available until check-in)
    // sqlx::query("UPDATE rooms SET available = false WHERE id = $1")
    //     .bind(input.room_id)
    //     .execute(&pool)
    //     .await
    //     .ok();

    Ok(Json(booking))
}

// RBAC Management Handlers (Admin only)
pub async fn get_roles_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<crate::models::Role>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, description, created_at FROM roles ORDER BY name"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut roles = Vec::new();
    for row in rows {
        roles.push(crate::models::Role {
            id: row.get(0),
            name: row.get(1),
            description: row.get(2),
            created_at: row.get(3),
        });
    }

    Ok(Json(roles))
}

pub async fn create_role_handler(
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<crate::models::RoleInput>,
) -> Result<Json<crate::models::Role>, ApiError> {
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

    let role = crate::models::Role {
        id: row.get(0),
        name: row.get(1),
        description: row.get(2),
        created_at: row.get(3),
    };

    Ok(Json(role))
}

pub async fn get_permissions_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<crate::models::Permission>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, resource, action, description, created_at FROM permissions ORDER BY resource, action"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut permissions = Vec::new();
    for row in rows {
        permissions.push(crate::models::Permission {
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
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<crate::models::PermissionInput>,
) -> Result<Json<crate::models::Permission>, ApiError> {
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

    let permission = crate::models::Permission {
        id: row.get(0),
        name: row.get(1),
        resource: row.get(2),
        action: row.get(3),
        description: row.get(4),
        created_at: row.get(5),
    };

    Ok(Json(permission))
}

pub async fn assign_role_to_user_handler(
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<crate::models::AssignRoleInput>,
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

    Ok(Json(serde_json::json!({"message": "Role assigned successfully"})))
}

pub async fn remove_role_from_user_handler(
    State(pool): State<sqlx::PgPool>,
    Path((user_id, role_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query(
        "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2"
    )
    .bind(user_id)
    .bind(role_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Role removed successfully"})))
}

pub async fn assign_permission_to_role_handler(
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<crate::models::AssignPermissionInput>,
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
    State(pool): State<sqlx::PgPool>,
    Path((role_id, permission_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    sqlx::query(
        "DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2"
    )
    .bind(role_id)
    .bind(permission_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Permission removed successfully"})))
}

pub async fn get_role_permissions_handler(
    State(pool): State<sqlx::PgPool>,
    Path(role_id): Path<i64>,
) -> Result<Json<crate::models::RoleWithPermissions>, ApiError> {
    let role_row = sqlx::query(
        "SELECT id, name, description, created_at FROM roles WHERE id = $1"
    )
    .bind(role_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Role not found".to_string()))?;

    let role = crate::models::Role {
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
        permissions.push(crate::models::Permission {
            id: row.get(0),
            name: row.get(1),
            resource: row.get(2),
            action: row.get(3),
            description: row.get(4),
            created_at: row.get(5),
        });
    }

    let role_with_permissions = crate::models::RoleWithPermissions {
        role,
        permissions,
    };

    Ok(Json(role_with_permissions))
}

pub async fn get_users_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<crate::models::User>>, ApiError> {
    let users = sqlx::query_as::<_, crate::models::User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users ORDER BY username"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(users))
}

pub async fn create_user_handler(
    State(pool): State<sqlx::PgPool>,
    Extension(admin_user_id): Extension<i64>,
    Json(input): Json<crate::models::UserCreateInput>,
) -> Result<Json<crate::models::User>, ApiError> {
    // Verify admin has super_admin role
    let is_super_admin = AuthService::check_role(&pool, admin_user_id, "super_admin").await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_super_admin {
        return Err(ApiError::Unauthorized("Only super admins can create users".to_string()));
    }

    // Validate password
    AuthService::validate_password(&input.password)
        .map_err(|e| ApiError::BadRequest(e))?;

    // Hash password
    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // Check if username or email already exists
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

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create user
    let user = sqlx::query_as::<_, crate::models::User>(
        r#"
        INSERT INTO users (username, email, password_hash, full_name, phone, is_active, is_verified)
        VALUES ($1, $2, $3, $4, $5, true, true)
        RETURNING id, username, email, full_name, is_active, created_at, updated_at
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

    // Assign roles if provided
    if let Some(role_ids) = &input.role_ids {
        for role_id in role_ids {
            // Verify role exists
            let role_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)"
            )
            .bind(role_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            if !role_exists {
                tx.rollback().await.ok();
                return Err(ApiError::BadRequest(format!("Role with id {} does not exist", role_id)));
            }

            // Check if trying to assign super_admin or admin role
            let role_name: String = sqlx::query_scalar(
                "SELECT name FROM roles WHERE id = $1"
            )
            .bind(role_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            // Only super_admin can assign super_admin or admin roles
            if (role_name == "super_admin" || role_name == "admin") && !is_super_admin {
                tx.rollback().await.ok();
                return Err(ApiError::Unauthorized("Only super admins can assign admin or super_admin roles".to_string()));
            }

            // Assign role
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            )
            .bind(user.id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(user))
}

pub async fn get_user_roles_permissions_handler(
    State(pool): State<sqlx::PgPool>,
    Path(user_id): Path<i64>,
) -> Result<Json<crate::models::UserWithRolesAndPermissions>, ApiError> {
    let user_row = sqlx::query(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    let user = crate::models::User {
        id: user_row.get(0),
        username: user_row.get(1),
        email: user_row.get(2),
        full_name: user_row.get(3),
        is_active: user_row.get(4),
        created_at: user_row.get(5),
        updated_at: user_row.get(6),
    };

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
        roles.push(crate::models::Role {
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
        permissions.push(crate::models::Permission {
            id: row.get(0),
            name: row.get(1),
            resource: row.get(2),
            action: row.get(3),
            description: row.get(4),
            created_at: row.get(5),
        });
    }

    let user_with_roles_permissions = crate::models::UserWithRolesAndPermissions {
        user,
        roles,
        permissions,
    };

    Ok(Json(user_with_roles_permissions))
}

// WebSocket status handler
pub async fn websocket_status_handler() -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "status": "available",
        "protocol": "ws",
        "endpoint": "/ws",
        "message": "WebSocket server is running"
    })))
}

// Analytics handlers
pub async fn get_occupancy_report_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;

    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupied_rooms: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id) FROM bookings
        WHERE status != 'cancelled'
        AND check_in <= CURRENT_DATE
        AND check_out > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupancy_rate = if total_rooms > 0 {
        (occupied_rooms as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    let available_rooms = total_rooms - occupied_rooms;

    let revenue: rust_decimal::Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(total_price), 0) FROM bookings
        WHERE status != 'cancelled'
        AND check_in <= CURRENT_DATE
        AND check_out > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "totalRooms": total_rooms,
        "occupiedRooms": occupied_rooms,
        "occupancyRate": occupancy_rate,
        "availableRooms": available_rooms,
        "utilization": occupancy_rate,
        "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
    })))
}

pub async fn get_booking_analytics_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;

    let total_bookings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let revenue_result: Option<rust_decimal::Decimal> = sqlx::query_scalar(
        "SELECT SUM(total_price) FROM bookings WHERE status != 'cancelled'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_revenue = revenue_result.unwrap_or_default();
    let average_booking_value = if total_bookings > 0 {
        total_revenue / rust_decimal::Decimal::from(total_bookings)
    } else {
        rust_decimal::Decimal::ZERO
    };

    // Bookings by room type
    let bookings_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT r.room_type, COUNT(*) as count
        FROM bookings b
        INNER JOIN rooms r ON b.room_id = r.id
        WHERE b.status != 'cancelled'
        GROUP BY r.room_type
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let bookings_by_room_type: serde_json::Map<String, serde_json::Value> = bookings_by_type
        .into_iter()
        .map(|(room_type, count)| (room_type, serde_json::Value::Number(count.into())))
        .collect();

    // Monthly trends (simplified - last 6 months)
    let monthly_trends = vec![
        serde_json::json!({
            "month": "Current Month",
            "bookings": total_bookings,
            "revenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0)
        })
    ];

    Ok(Json(serde_json::json!({
        "totalBookings": total_bookings,
        "averageBookingValue": average_booking_value.to_string().parse::<f64>().unwrap_or(0.0),
        "totalRevenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0),
        "bookingsByRoomType": bookings_by_room_type,
        "peakBookingHours": [9, 10, 11, 14, 15, 16],
        "monthlyTrends": monthly_trends
    })))
}

// Personalized report handler - generates reports tailored to user role and context
pub async fn get_personalized_report_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    let user_id = require_auth(&headers).await?;
    
    // Get user roles and determine report scope
    let user_roles = AuthService::get_user_roles(&pool, user_id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    
    let is_admin = user_roles.contains(&"admin".to_string());
    let is_manager = user_roles.contains(&"manager".to_string());
    let report_scope = if is_admin || is_manager { "all" } else { "personal" };
    
    // Get date range from query params
    let period = params.get("period").unwrap_or(&"month".to_string()).clone();
    
    // Generate personalized occupancy report
    let occupancy_query = if report_scope == "all" {
        "SELECT COUNT(DISTINCT room_id) FROM bookings WHERE status != 'cancelled' AND check_in <= CURRENT_DATE AND check_out > CURRENT_DATE"
    } else {
        "SELECT COUNT(DISTINCT b.room_id) FROM bookings b WHERE b.status != 'cancelled' AND b.check_in <= CURRENT_DATE AND b.check_out > CURRENT_DATE AND b.created_by = $1"
    };
    
    let occupied_rooms: i64 = if report_scope == "all" {
        sqlx::query_scalar(occupancy_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query_scalar(occupancy_query)
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };
    
    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    
    // User-specific booking statistics
    let user_bookings_query = if report_scope == "all" {
        "SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'"
    } else {
        "SELECT COUNT(*) FROM bookings WHERE status != 'cancelled' AND created_by = $1"
    };
    
    let total_bookings: i64 = if report_scope == "all" {
        sqlx::query_scalar(user_bookings_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query_scalar(user_bookings_query)
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };
    
    // User-specific revenue
    let revenue_query = if report_scope == "all" {
        "SELECT COALESCE(SUM(total_price), 0) FROM bookings WHERE status != 'cancelled'"
    } else {
        "SELECT COALESCE(SUM(total_price), 0) FROM bookings WHERE status != 'cancelled' AND created_by = $1"
    };
    
    let total_revenue: rust_decimal::Decimal = if report_scope == "all" {
        sqlx::query_scalar(revenue_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query_scalar(revenue_query)
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };
    
    // Recent bookings for the user
    let recent_bookings_query = if report_scope == "all" {
        r#"
        SELECT b.id, b.guest_id, g.name as guest_name, r.room_number, r.room_type, 
               b.check_in, b.check_out, b.total_price::text, b.status
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        WHERE b.status != 'cancelled'
        ORDER BY b.created_at DESC
        LIMIT 10
        "#
    } else {
        r#"
        SELECT b.id, b.guest_id, g.name as guest_name, r.room_number, r.room_type, 
               b.check_in, b.check_out, b.total_price::text, b.status
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        WHERE b.status != 'cancelled' AND b.created_by = $1
        ORDER BY b.created_at DESC
        LIMIT 10
        "#
    };
    
    let recent_bookings_rows = if report_scope == "all" {
        sqlx::query(recent_bookings_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query(recent_bookings_query)
            .bind(user_id)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };
    
    let recent_bookings: Vec<serde_json::Value> = recent_bookings_rows.into_iter().map(|row| {
        serde_json::json!({
            "id": row.get::<i64, _>(0),
            "guest_name": row.get::<String, _>(2),
            "room_number": row.get::<String, _>(3),
            "room_type": row.get::<String, _>(4),
            "check_in": row.get::<chrono::NaiveDate, _>(5).to_string(),
            "check_out": row.get::<chrono::NaiveDate, _>(6).to_string(),
            "total_price": row.get::<String, _>(7),
            "status": row.get::<String, _>(8)
        })
    }).collect();
    
    // Generate personalized insights
    let insights = vec![
        if report_scope == "all" {
            format!("System-wide: {} bookings totaling ${:.2}", total_bookings, total_revenue.to_string().parse::<f64>().unwrap_or(0.0))
        } else {
            format!("Your bookings: {} bookings totaling ${:.2}", total_bookings, total_revenue.to_string().parse::<f64>().unwrap_or(0.0))
        },
        if total_bookings > 10 {
            "You're doing great! Keep up the excellent work.".to_string()
        } else if total_bookings > 5 {
            "Good progress! Continue building your booking portfolio.".to_string()
        } else {
            "Getting started! Focus on converting inquiries to bookings.".to_string()
        }
    ];
    
    Ok(Json(serde_json::json!({
        "reportScope": report_scope,
        "userRoles": user_roles,
        "period": period,
        "summary": {
            "totalRooms": total_rooms,
            "occupiedRooms": occupied_rooms,
            "occupancyRate": if total_rooms > 0 { (occupied_rooms as f64 / total_rooms as f64) * 100.0 } else { 0.0 },
            "totalBookings": total_bookings,
            "totalRevenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0),
            "averageBookingValue": if total_bookings > 0 { total_revenue.to_string().parse::<f64>().unwrap_or(0.0) / total_bookings as f64 } else { 0.0 }
        },
        "recentBookings": recent_bookings,
        "insights": insights,
        "generatedAt": chrono::Utc::now().to_rfc3339()
    })))
}

pub async fn get_benchmark_report_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;

    // Calculate occupancy metrics directly
    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupied_rooms: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id) FROM bookings
        WHERE status != 'cancelled'
        AND check_in <= CURRENT_DATE
        AND check_out > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupancy_rate = if total_rooms > 0 {
        (occupied_rooms as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    let revenue: rust_decimal::Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(total_price), 0) FROM bookings
        WHERE status != 'cancelled'
        AND check_in <= CURRENT_DATE
        AND check_out > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate booking metrics
    let total_bookings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let revenue_result: Option<rust_decimal::Decimal> = sqlx::query_scalar(
        "SELECT SUM(total_price) FROM bookings WHERE status != 'cancelled'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_revenue = revenue_result.unwrap_or_default();
    let average_booking_value = if total_bookings > 0 {
        total_revenue.to_string().parse::<f64>().unwrap_or(0.0) / total_bookings as f64
    } else {
        0.0
    };

    let revpar = revenue.to_string().parse::<f64>().unwrap_or(0.0) / total_rooms as f64;

    let industry_averages = serde_json::json!({
        "occupancyRate": 78.5,
        "averageDailyRate": 125.0,
        "revenuePerAvailableRoom": 97.6
    });

    let performance_metrics = serde_json::json!({
        "occupancyRate": occupancy_rate,
        "averageDailyRate": average_booking_value,
        "revenuePerAvailableRoom": revpar
    });

    let get_percentile = |value: f64, benchmark: f64| -> String {
        if value >= benchmark * 1.1 {
            "Above 90th percentile".to_string()
        } else if value >= benchmark * 0.9 {
            "Above 75th percentile".to_string()
        } else if value >= benchmark * 0.75 {
            "Above 50th percentile".to_string()
        } else {
            "Below 25th percentile".to_string()
        }
    };

    let mut recommendations = Vec::new();
    if occupancy_rate < 78.5 {
        recommendations.push("Consider implementing dynamic pricing to improve occupancy rates".to_string());
        recommendations.push("Review marketing strategies to increase booking volumes".to_string());
    }
    if average_booking_value < 125.0 {
        recommendations.push("Analyze and optimize room pricing strategy".to_string());
        recommendations.push("Consider upselling premium services and amenities".to_string());
    }
    if revpar < 97.6 {
        recommendations.push("Focus on both occupancy and rate optimization".to_string());
        recommendations.push("Implement revenue management techniques".to_string());
    }

    Ok(Json(serde_json::json!({
        "industryAverages": industry_averages,
        "performanceMetrics": performance_metrics,
        "percentile": {
            "occupancy": get_percentile(occupancy_rate, 78.5),
            "revenue": get_percentile(revpar, 97.6),
            "utilization": get_percentile(occupancy_rate, 78.5)
        },
        "recommendations": recommendations
    })))
}

// ============================================================================
// LOYALTY PROGRAM HANDLERS
// ============================================================================

pub async fn get_loyalty_programs_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<crate::models::LoyaltyProgram>>, ApiError> {
    let programs = sqlx::query_as::<_, crate::models::LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE is_active = true ORDER BY tier_level"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(programs))
}

pub async fn get_loyalty_memberships_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<crate::models::LoyaltyMembershipWithDetails>>, ApiError> {
    let memberships = sqlx::query_as::<_, crate::models::LoyaltyMembershipWithDetails>(
        r#"
        SELECT
            lm.id,
            lm.guest_id,
            g.full_name as guest_name,
            g.email as guest_email,
            lm.program_id,
            lp.name as program_name,
            lp.description as program_description,
            lm.membership_number,
            lm.points_balance,
            lm.lifetime_points,
            lm.tier_level,
            lp.points_multiplier,
            lm.status,
            lm.enrolled_date
        FROM loyalty_memberships lm
        JOIN guests g ON lm.guest_id = g.id
        JOIN loyalty_programs lp ON lm.program_id = lp.id
        WHERE lm.status = 'active'
        ORDER BY lm.lifetime_points DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(memberships))
}

pub async fn get_loyalty_statistics_handler(
    State(pool): State<PgPool>,
) -> Result<Json<crate::models::LoyaltyStatistics>, ApiError> {
    // Get total and active members
    let (total_members, active_members): (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'active') as active
        FROM loyalty_memberships
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get members by tier
    let members_by_tier = sqlx::query_as::<_, crate::models::TierStatistics>(
        r#"
        SELECT
            lp.tier_level,
            lp.name as tier_name,
            COUNT(*)::bigint as count,
            ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as percentage
        FROM loyalty_memberships lm
        JOIN loyalty_programs lp ON lm.program_id = lp.id
        WHERE lm.status = 'active'
        GROUP BY lp.tier_level, lp.name
        ORDER BY lp.tier_level
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get points statistics
    let (total_points_issued, total_points_active, average_points): (i64, i64, f64) = sqlx::query_as(
        r#"
        SELECT
            COALESCE(SUM(lifetime_points), 0)::bigint as total_issued,
            COALESCE(SUM(points_balance), 0)::bigint as total_active,
            COALESCE(AVG(points_balance), 0.0) as avg_points
        FROM loyalty_memberships
        WHERE status = 'active'
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_points_redeemed = total_points_issued - total_points_active;

    // Get top members
    let top_members = sqlx::query_as::<_, crate::models::TopMember>(
        r#"
        SELECT
            g.full_name as guest_name,
            g.email as guest_email,
            lm.points_balance,
            lm.lifetime_points,
            lm.tier_level,
            lm.membership_number
        FROM loyalty_memberships lm
        JOIN guests g ON lm.guest_id = g.id
        WHERE lm.status = 'active'
        ORDER BY lm.lifetime_points DESC
        LIMIT 10
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get recent transactions
    let recent_transactions = sqlx::query_as::<_, crate::models::RecentTransaction>(
        r#"
        SELECT
            pt.id::text,
            g.full_name as guest_name,
            pt.transaction_type,
            pt.points_amount,
            pt.description,
            pt.created_at
        FROM points_transactions pt
        JOIN loyalty_memberships lm ON pt.membership_id = lm.id
        JOIN guests g ON lm.guest_id = g.id
        ORDER BY pt.created_at DESC
        LIMIT 20
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership growth (last 30 days)
    let membership_growth = sqlx::query_as::<_, crate::models::MembershipGrowth>(
        r#"
        SELECT
            TO_CHAR(date_series, 'YYYY-MM-DD') as date,
            COALESCE(COUNT(lm.enrolled_date), 0)::bigint as new_members,
            (SELECT COUNT(*)::bigint FROM loyalty_memberships
             WHERE enrolled_date <= date_series) as total_members
        FROM generate_series(
            CURRENT_DATE - INTERVAL '30 days',
            CURRENT_DATE,
            INTERVAL '1 day'
        ) AS date_series
        LEFT JOIN loyalty_memberships lm ON lm.enrolled_date = date_series::date
        GROUP BY date_series
        ORDER BY date_series
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get points activity (last 30 days)
    let points_activity = sqlx::query_as::<_, crate::models::PointsActivity>(
        r#"
        SELECT
            TO_CHAR(date_series, 'YYYY-MM-DD') as date,
            COALESCE(SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END), 0)::bigint as points_earned,
            COALESCE(SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END), 0)::bigint as points_redeemed
        FROM generate_series(
            CURRENT_DATE - INTERVAL '30 days',
            CURRENT_DATE,
            INTERVAL '1 day'
        ) AS date_series
        LEFT JOIN points_transactions pt ON DATE(pt.created_at) = date_series::date
        GROUP BY date_series
        ORDER BY date_series
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let statistics = crate::models::LoyaltyStatistics {
        total_members,
        active_members,
        members_by_tier,
        total_points_issued,
        total_points_redeemed,
        total_points_active,
        average_points_per_member: average_points,
        top_members,
        recent_transactions,
        membership_growth,
        points_activity,
    };

    Ok(Json(statistics))
}

pub async fn add_points_handler(
    State(pool): State<PgPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<crate::models::AddPointsInput>,
) -> Result<Json<crate::models::PointsTransaction>, ApiError> {
    if input.points <= 0 {
        return Err(ApiError::BadRequest("Points must be positive".to_string()));
    }

    // Get current membership
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE id = $1"
    )
    .bind(membership_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Membership not found".to_string()))?;

    // Calculate new balance
    let new_balance = membership.points_balance + input.points;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update membership
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            lifetime_points = lifetime_points + $2,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        "#
    )
    .bind(new_balance)
    .bind(input.points)
    .bind(membership_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create transaction record
    let transaction = sqlx::query_as::<_, crate::models::PointsTransaction>(
        r#"
        INSERT INTO points_transactions (
            membership_id, transaction_type, points_amount, balance_after, description
        )
        VALUES ($1, 'earn', $2, $3, $4)
        RETURNING id::text, membership_id, transaction_type, points_amount,
                  balance_after, reference_type, reference_id, description, created_at
        "#
    )
    .bind(membership_id)
    .bind(input.points)
    .bind(new_balance)
    .bind(&input.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(transaction))
}

pub async fn redeem_points_handler(
    State(pool): State<PgPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<crate::models::AddPointsInput>,
) -> Result<Json<crate::models::PointsTransaction>, ApiError> {
    if input.points <= 0 {
        return Err(ApiError::BadRequest("Points must be positive".to_string()));
    }

    // Get current membership
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE id = $1"
    )
    .bind(membership_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Membership not found".to_string()))?;

    // Check sufficient balance
    if membership.points_balance < input.points {
        return Err(ApiError::BadRequest("Insufficient points balance".to_string()));
    }

    // Calculate new balance
    let new_balance = membership.points_balance - input.points;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update membership
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create transaction record
    let transaction = sqlx::query_as::<_, crate::models::PointsTransaction>(
        r#"
        INSERT INTO points_transactions (
            membership_id, transaction_type, points_amount, balance_after, description
        )
        VALUES ($1, 'redeem', $2, $3, $4)
        RETURNING id::text, membership_id, transaction_type, points_amount,
                  balance_after, reference_type, reference_id, description, created_at
        "#
    )
    .bind(membership_id)
    .bind(-input.points)
    .bind(new_balance)
    .bind(&input.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(transaction))
}

// Get user's own loyalty membership with full details
pub async fn get_user_loyalty_membership_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<crate::models::UserLoyaltyMembership>, ApiError> {
    // First, get the user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Find guest by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found. Please contact support to enroll in the loyalty programme.".to_string()))?;

    // Get the membership
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get current program/tier info
    let current_program = sqlx::query_as::<_, crate::models::LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE id = $1"
    )
    .bind(membership.program_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get next tier info
    let next_tier = sqlx::query_as::<_, crate::models::LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE tier_level = $1 AND is_active = true ORDER BY tier_level LIMIT 1"
    )
    .bind(membership.tier_level + 1)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get benefits from current program (benefits is a JSONB array)
    let benefits: Vec<String> = sqlx::query_scalar(
        "SELECT jsonb_array_elements_text(benefits) FROM loyalty_programs WHERE id = $1"
    )
    .bind(membership.program_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get recent transactions
    let recent_transactions = sqlx::query_as::<_, crate::models::PointsTransaction>(
        "SELECT * FROM points_transactions WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 10"
    )
    .bind(membership.id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Build next tier info
    let next_tier_info = next_tier.map(|tier| {
        let tier_benefits: Vec<String> = vec![]; // We'd need to fetch this too, but simplified for now
        crate::models::TierInfo {
            tier_level: tier.tier_level,
            tier_name: tier.name,
            minimum_points: tier.minimum_points_required,
            benefits: tier_benefits,
            points_multiplier: tier.points_multiplier,
        }
    });

    let points_to_next_tier = next_tier_info.as_ref().map(|tier| {
        (tier.minimum_points - membership.lifetime_points).max(0)
    });

    Ok(Json(crate::models::UserLoyaltyMembership {
        id: membership.id,
        membership_number: membership.membership_number,
        points_balance: membership.points_balance,
        lifetime_points: membership.lifetime_points,
        tier_level: membership.tier_level,
        tier_name: current_program.name,
        status: membership.status,
        enrolled_date: membership.enrolled_date,
        expiry_date: membership.expiry_date,
        next_tier: next_tier_info,
        current_tier_benefits: benefits,
        points_to_next_tier,
        recent_transactions,
    }))
}

// Get available loyalty rewards filtered by user's tier
pub async fn get_loyalty_rewards_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<crate::models::LoyaltyReward>>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.unwrap_or_default();

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let tier_level: i32 = if let Some(gid) = guest_id {
        sqlx::query_scalar(
            "SELECT tier_level FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'"
        )
        .bind(gid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .unwrap_or(1)
    } else {
        1
    };

    // Get rewards available for user's tier
    let rewards = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        r#"
        SELECT * FROM loyalty_rewards
        WHERE is_active = true
        AND minimum_tier_level <= $1
        AND (stock_quantity IS NULL OR stock_quantity > 0)
        ORDER BY category, points_cost
        "#
    )
    .bind(tier_level)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(rewards))
}

// Redeem a loyalty reward
pub async fn redeem_reward_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<crate::models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found".to_string()))?;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active' FOR UPDATE"
    )
    .bind(guest_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get reward
    let reward = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true FOR UPDATE"
    )
    .bind(input.reward_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    // Check tier eligibility
    if membership.tier_level < reward.minimum_tier_level {
        return Err(ApiError::BadRequest("Your tier level is not high enough for this reward".to_string()));
    }

    // Check points balance
    if membership.points_balance < reward.points_cost {
        return Err(ApiError::BadRequest("Insufficient points balance".to_string()));
    }

    // Check stock
    if let Some(stock) = reward.stock_quantity {
        if stock <= 0 {
            return Err(ApiError::BadRequest("Reward is out of stock".to_string()));
        }
    }

    // Deduct points
    let new_balance = membership.points_balance - reward.points_cost;
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create points transaction
    let transaction: crate::models::PointsTransaction = sqlx::query_as(
        r#"
        INSERT INTO points_transactions
        (membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description)
        VALUES ($1, 'redeem', $2, $3, 'reward', $4, $5)
        RETURNING *
        "#
    )
    .bind(membership.id)
    .bind(-reward.points_cost)
    .bind(new_balance)
    .bind(reward.id)
    .bind(format!("Redeemed: {}", reward.name))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create redemption record
    sqlx::query(
        r#"
        INSERT INTO reward_redemptions
        (membership_id, reward_id, transaction_id, booking_id, points_spent, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        "#
    )
    .bind(membership.id)
    .bind(reward.id)
    .bind(&transaction.id)
    .bind(input.booking_id)
    .bind(reward.points_cost)
    .bind(input.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update stock if applicable
    if reward.stock_quantity.is_some() {
        sqlx::query(
            "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1 WHERE id = $1"
        )
        .bind(reward.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Reward redeemed successfully",
        "points_spent": reward.points_cost,
        "new_balance": new_balance,
        "reward_name": reward.name
    })))
}

// ============================================================================
// ADMIN REWARD MANAGEMENT HANDLERS
// ============================================================================

// Get all rewards (with optional category filter)
pub async fn get_rewards_handler(
    State(pool): State<PgPool>,
    query: Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<crate::models::LoyaltyReward>>, ApiError> {
    let category = query.get("category");

    let rewards = if let Some(cat) = category {
        sqlx::query_as::<_, crate::models::LoyaltyReward>(
            "SELECT * FROM loyalty_rewards WHERE category = $1 ORDER BY category, points_cost"
        )
        .bind(cat)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query_as::<_, crate::models::LoyaltyReward>(
            "SELECT * FROM loyalty_rewards ORDER BY category, points_cost"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    Ok(Json(rewards))
}

// Get single reward by ID
pub async fn get_reward_handler(
    State(pool): State<PgPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    let reward = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1"
    )
    .bind(reward_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    Ok(Json(reward))
}

// Create new reward (admin only)
pub async fn create_reward_handler(
    State(pool): State<PgPool>,
    Json(input): Json<crate::models::RewardInput>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    // Validate category
    let valid_categories = vec!["room_upgrade", "service", "discount", "gift", "dining", "spa", "experience"];
    if !valid_categories.contains(&input.category.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid category. Must be one of: {}",
            valid_categories.join(", ")
        )));
    }

    // Validate tier level (1-4)
    if input.minimum_tier_level < 1 || input.minimum_tier_level > 4 {
        return Err(ApiError::BadRequest("Minimum tier level must be between 1 and 4".to_string()));
    }

    // Validate points cost
    if input.points_cost <= 0 {
        return Err(ApiError::BadRequest("Points cost must be greater than 0".to_string()));
    }

    let monetary_value = input.monetary_value.map(|v|
        rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default()
    );

    let reward = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        r#"
        INSERT INTO loyalty_rewards
        (name, description, category, points_cost, monetary_value, minimum_tier_level,
         stock_quantity, image_url, terms_conditions)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        "#
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.category)
    .bind(input.points_cost)
    .bind(monetary_value)
    .bind(input.minimum_tier_level)
    .bind(input.stock_quantity)
    .bind(&input.image_url)
    .bind(&input.terms_conditions)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reward))
}

// Update reward (admin only)
pub async fn update_reward_handler(
    State(pool): State<PgPool>,
    Path(reward_id): Path<i64>,
    Json(input): Json<crate::models::RewardUpdateInput>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    // Check if reward exists
    let existing = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1"
    )
    .bind(reward_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    // Validate category if provided
    if let Some(ref category) = input.category {
        let valid_categories = vec!["room_upgrade", "service", "discount", "gift", "dining", "spa", "experience"];
        if !valid_categories.contains(&category.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "Invalid category. Must be one of: {}",
                valid_categories.join(", ")
            )));
        }
    }

    // Validate tier level if provided
    if let Some(tier_level) = input.minimum_tier_level {
        if tier_level < 1 || tier_level > 4 {
            return Err(ApiError::BadRequest("Minimum tier level must be between 1 and 4".to_string()));
        }
    }

    // Validate points cost if provided
    if let Some(points_cost) = input.points_cost {
        if points_cost <= 0 {
            return Err(ApiError::BadRequest("Points cost must be greater than 0".to_string()));
        }
    }

    // Use provided values or keep existing ones
    let name = input.name.as_ref().unwrap_or(&existing.name);
    let description = input.description.as_ref().or(existing.description.as_ref());
    let category = input.category.as_ref().unwrap_or(&existing.category);
    let points_cost = input.points_cost.unwrap_or(existing.points_cost);
    let monetary_value = if input.monetary_value.is_some() {
        input.monetary_value.map(|v| rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default())
    } else {
        existing.monetary_value
    };
    let minimum_tier_level = input.minimum_tier_level.unwrap_or(existing.minimum_tier_level);
    let is_active = input.is_active.unwrap_or(existing.is_active);
    let stock_quantity = if input.stock_quantity.is_some() {
        input.stock_quantity
    } else {
        existing.stock_quantity
    };
    let image_url = input.image_url.as_ref().or(existing.image_url.as_ref());
    let terms_conditions = input.terms_conditions.as_ref().or(existing.terms_conditions.as_ref());

    let reward = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        r#"
        UPDATE loyalty_rewards
        SET name = $1,
            description = $2,
            category = $3,
            points_cost = $4,
            monetary_value = $5,
            minimum_tier_level = $6,
            is_active = $7,
            stock_quantity = $8,
            image_url = $9,
            terms_conditions = $10,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
        RETURNING *
        "#
    )
    .bind(name)
    .bind(description)
    .bind(category)
    .bind(points_cost)
    .bind(monetary_value)
    .bind(minimum_tier_level)
    .bind(is_active)
    .bind(stock_quantity)
    .bind(image_url)
    .bind(terms_conditions)
    .bind(reward_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reward))
}

// Delete/deactivate reward (admin only)
pub async fn delete_reward_handler(
    State(pool): State<PgPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Soft delete by setting is_active to false
    let result = sqlx::query(
        "UPDATE loyalty_rewards SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
    )
    .bind(reward_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Reward not found".to_string()));
    }

    Ok(Json(serde_json::json!({
        "message": "Reward deactivated successfully"
    })))
}

// Get reward redemption history (admin only)
pub async fn get_reward_redemptions_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<crate::models::RewardRedemptionWithDetails>>, ApiError> {
    let redemptions = sqlx::query_as::<_, crate::models::RewardRedemptionWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.membership_id,
            lm.membership_number,
            g.full_name as guest_name,
            g.email as guest_email,
            rr.reward_id,
            lr.name as reward_name,
            lr.category as reward_category,
            rr.points_spent,
            rr.status,
            rr.redeemed_at,
            rr.notes,
            rr.created_at
        FROM reward_redemptions rr
        INNER JOIN loyalty_memberships lm ON rr.membership_id = lm.id
        INNER JOIN guests g ON lm.guest_id = g.id
        INNER JOIN loyalty_rewards lr ON rr.reward_id = lr.id
        ORDER BY rr.created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(redemptions))
}

// Redeem reward for user (user-facing endpoint, already exists but keeping for API consistency)
pub async fn redeem_reward_for_user_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(reward_id): Path<i64>,
    Json(input): Json<crate::models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found".to_string()))?;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active' FOR UPDATE"
    )
    .bind(guest_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get reward
    let reward = sqlx::query_as::<_, crate::models::LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true FOR UPDATE"
    )
    .bind(reward_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found or inactive".to_string()))?;

    // Check tier eligibility
    if membership.tier_level < reward.minimum_tier_level {
        return Err(ApiError::BadRequest("Your tier level is not high enough for this reward".to_string()));
    }

    // Check points balance
    if membership.points_balance < reward.points_cost {
        return Err(ApiError::BadRequest(format!(
            "Insufficient points. Required: {}, Available: {}",
            reward.points_cost, membership.points_balance
        )));
    }

    // Check stock
    if let Some(stock) = reward.stock_quantity {
        if stock <= 0 {
            return Err(ApiError::BadRequest("Reward is out of stock".to_string()));
        }
    }

    // Deduct points
    let new_balance = membership.points_balance - reward.points_cost;
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create points transaction
    let transaction: crate::models::PointsTransaction = sqlx::query_as(
        r#"
        INSERT INTO points_transactions
        (membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description)
        VALUES ($1, 'redeem', $2, $3, 'reward', $4, $5)
        RETURNING *
        "#
    )
    .bind(membership.id)
    .bind(-reward.points_cost)
    .bind(new_balance)
    .bind(reward.id)
    .bind(format!("Redeemed: {}", reward.name))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create redemption record
    sqlx::query(
        r#"
        INSERT INTO reward_redemptions
        (membership_id, reward_id, transaction_id, booking_id, points_spent, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        "#
    )
    .bind(membership.id)
    .bind(reward.id)
    .bind(&transaction.id)
    .bind(input.booking_id)
    .bind(reward.points_cost)
    .bind(&input.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update stock if applicable
    if reward.stock_quantity.is_some() {
        sqlx::query(
            "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
        )
        .bind(reward.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Reward redeemed successfully",
        "points_spent": reward.points_cost,
        "new_balance": new_balance,
        "reward_name": reward.name
    })))
}

// ============================================================================
// USER PROFILE HANDLERS
// ============================================================================

pub async fn get_user_profile_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<crate::models::UserProfile>, ApiError> {
    let profile = sqlx::query_as::<_, crate::models::UserProfile>(
        r#"
        SELECT
            id, username, email, full_name, phone,
            avatar_url, created_at, updated_at, last_login_at
        FROM users
        WHERE id = $1 AND is_active = true
        "#
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    Ok(Json(profile))
}

pub async fn update_user_profile_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<crate::models::UserProfileUpdate>,
) -> Result<Json<crate::models::UserProfile>, ApiError> {
    // Build dynamic update query
    let mut query = String::from("UPDATE users SET updated_at = CURRENT_TIMESTAMP");
    let mut bind_count = 1;
    let mut bindings: Vec<String> = vec![];

    if let Some(ref full_name) = input.full_name {
        query.push_str(&format!(", full_name = ${}", bind_count));
        bindings.push(full_name.clone());
        bind_count += 1;
    }

    if let Some(ref email) = input.email {
        query.push_str(&format!(", email = ${}", bind_count));
        bindings.push(email.clone());
        bind_count += 1;
    }

    if let Some(ref phone) = input.phone {
        query.push_str(&format!(", phone = ${}", bind_count));
        bindings.push(phone.clone());
        bind_count += 1;
    }

    if let Some(ref avatar_url) = input.avatar_url {
        query.push_str(&format!(", avatar_url = ${}", bind_count));
        bindings.push(avatar_url.clone());
        bind_count += 1;
    }

    query.push_str(&format!(" WHERE id = ${}", bind_count));

    // Execute update using dynamic query building
    let mut q = sqlx::query(&query);
    for binding in bindings {
        q = q.bind(binding);
    }
    q = q.bind(user_id);

    q.execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Fetch updated profile
    get_user_profile_handler(State(pool), Extension(user_id)).await
}

pub async fn update_password_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<crate::models::PasswordUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get current password hash
    let current_hash: String = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Verify current password
    let valid = AuthService::verify_password(&input.current_password, &current_hash)
        .await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized("Current password is incorrect".to_string()));
    }

    // Hash new password
    let new_hash = AuthService::hash_password(&input.new_password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // Update password
    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(&new_hash)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Password updated successfully"})))
}

// ============================================================================
// PASSKEY MANAGEMENT HANDLERS
// ============================================================================

pub async fn list_passkeys_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<crate::models::PasskeyInfo>>, ApiError> {
    // Manually query and construct PasskeyInfo with base64url-encoded credential_id
    let rows = sqlx::query(
        r#"
        SELECT id, credential_id, device_name, created_at, last_used_at
        FROM passkeys
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut passkeys: Vec<crate::models::PasskeyInfo> = Vec::new();

    for row in rows {
        // Safely get credential_id bytes
        let credential_id_bytes: Vec<u8> = match row.try_get("credential_id") {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("Failed to get credential_id: {}", e);
                continue;
            }
        };

        // Encode credential_id as base64url for frontend
        let credential_id_b64url = base64::encode(&credential_id_bytes)
            .replace('+', "-")
            .replace('/', "_")
            .trim_end_matches('=')
            .to_string();

        passkeys.push(crate::models::PasskeyInfo {
            id: row.try_get("id").map_err(|e| ApiError::Database(e.to_string()))?,
            credential_id: credential_id_b64url,
            device_name: row.try_get("device_name").ok(),
            created_at: row.try_get("created_at").map_err(|e| ApiError::Database(e.to_string()))?,
            last_used_at: row.try_get("last_used_at").ok(),
        });
    }

    Ok(Json(passkeys))
}

pub async fn delete_passkey_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query(
        "DELETE FROM passkeys WHERE id = $1 AND user_id = $2"
    )
    .bind(passkey_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(serde_json::json!({"message": "Passkey deleted successfully"})))
}

pub async fn update_passkey_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
    Json(input): Json<crate::models::PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query(
        "UPDATE passkeys SET device_name = $1 WHERE id = $2 AND user_id = $3"
    )
    .bind(&input.device_name)
    .bind(passkey_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(serde_json::json!({"message": "Passkey updated successfully"})))
}

// ============================================================================
// PASSKEY AUTHENTICATION HANDLERS
// ============================================================================

pub async fn passkey_register_start_handler(
    State(pool): State<PgPool>,
    Json(req): Json<crate::models::PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user by username
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Check passkey limit (max 10)
    let passkey_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM passkeys WHERE user_id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkey_count >= 10 {
        return Err(ApiError::BadRequest("Maximum of 10 passkeys allowed per user".to_string()));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::thread_rng();
        rand::Rng::gen(&mut rng)
    };
    let challenge_b64 = base64::encode(&challenge_bytes);

    // Store challenge temporarily (expires in 5 minutes)
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
        "#
    )
    .bind(user.id)
    .bind(&challenge_bytes[..])  // Bind as bytea
    .bind("registration")
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "rp": {
            "name": "Hotel Management System",
            "id": env::var("PASSKEY_RP_ID").unwrap_or_else(|_| "localhost".to_string()),
        },
        "user": {
            "id": base64::encode(user.id.to_string()),
            "name": user.username,
            "displayName": user.full_name.as_ref().unwrap_or(&user.username),
        }
    })))
}

pub async fn passkey_register_finish_handler(
    State(pool): State<PgPool>,
    Json(req): Json<crate::models::PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Verify challenge
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND expires_at > NOW())"
    )
    .bind(user.id)
    .bind(base64::decode(&req.challenge).map_err(|_| ApiError::BadRequest("Invalid challenge".to_string()))?)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized("Invalid or expired challenge".to_string()));
    }

    // Parse credential (simplified - in production use a proper WebAuthn library)
    let credential: serde_json::Value = serde_json::from_str(&req.credential)
        .map_err(|_| ApiError::BadRequest("Invalid credential format".to_string()))?;

    let credential_id_str = credential["id"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest("Missing credential ID".to_string()))?;

    // Decode credential_id from base64url (WebAuthn uses URL-safe base64) to bytes for BYTEA storage
    let credential_id_bytes = decode_base64url(credential_id_str)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    // Extract public key (simplified)
    let public_key = vec![0u8; 64]; // In production, parse from attestationObject

    // Store passkey
    let device_name = req.device_name
        .clone()
        .unwrap_or_else(|| format!("Passkey {}", chrono::Utc::now().format("%Y-%m-%d")));

    sqlx::query(
        r#"
        INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_name)
        VALUES ($1, $2, $3, 0, $4)
        "#
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .bind(&public_key)
    .bind(device_name)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete used challenge
    sqlx::query("DELETE FROM passkey_challenges WHERE user_id = $1 AND challenge = $2")
        .bind(user.id)
        .bind(base64::decode(&req.challenge).unwrap_or_default())
        .execute(&pool)
        .await
        .ok();

    Ok(Json(serde_json::json!({"message": "Passkey registered successfully"})))
}

pub async fn passkey_login_start_handler(
    State(pool): State<PgPool>,
    Json(req): Json<crate::models::PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user by username
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get user's passkeys
    let passkeys = sqlx::query_as::<_, crate::models::Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1"
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkeys.is_empty() {
        return Err(ApiError::NotFound("No passkeys found for this user".to_string()));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::thread_rng();
        rand::Rng::gen(&mut rng)
    };
    let challenge_b64 = base64::encode(&challenge_bytes);

    // Store challenge
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
        "#
    )
    .bind(user.id)
    .bind(&challenge_bytes[..])  // Bind as bytea
    .bind("authentication")
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let allow_credentials: Vec<serde_json::Value> = passkeys
        .iter()
        .map(|pk| {
            // Encode as base64url for WebAuthn compatibility
            let credential_id_b64url = base64::encode(&pk.credential_id)
                .replace('+', "-")
                .replace('/', "_")
                .trim_end_matches('=')
                .to_string();

            serde_json::json!({
                "id": credential_id_b64url,
                "type": "public-key"
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "allowCredentials": allow_credentials
    })))
}

pub async fn passkey_login_finish_handler(
    State(pool): State<PgPool>,
    Json(req): Json<crate::models::PasskeyLoginFinish>,
) -> Result<Json<AuthResponse>, ApiError> {
    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, is_active, created_at, updated_at FROM users WHERE username = $1 AND is_active = true"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Verify challenge
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND expires_at > NOW())"
    )
    .bind(user.id)
    .bind(base64::decode(&req.challenge).map_err(|_| ApiError::BadRequest("Invalid challenge".to_string()))?)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized("Invalid or expired challenge".to_string()));
    }

    // Decode credential_id from base64url (WebAuthn uses URL-safe base64) to bytes for BYTEA lookup
    let credential_id_bytes = decode_base64url(&req.credential_id)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    // Verify passkey exists
    let passkey = sqlx::query_as::<_, crate::models::Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1 AND credential_id = $2"
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Unauthorized("Invalid passkey".to_string()))?;

    // In production, verify the signature here using the public_key
    // For now, we'll trust the credential_id match

    // Update last used
    sqlx::query("UPDATE passkeys SET last_used_at = NOW() WHERE id = $1")
        .bind(passkey.id)
        .execute(&pool)
        .await
        .ok();

    // Delete used challenge
    sqlx::query("DELETE FROM passkey_challenges WHERE user_id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    // Get roles and permissions
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate tokens
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    let refresh_token = AuthService::generate_refresh_token();

    // Check if this is the first login
    let is_first_login: bool = sqlx::query_scalar(
        "SELECT last_login_at IS NULL FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Store refresh token
    AuthService::store_refresh_token(&pool, user.id, &refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user,
        roles,
        permissions,
        is_first_login,
    }))
}

#[derive(Debug)]
pub enum ApiError {
    Database(String),
    Unauthorized(String),
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::Database(msg) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", msg)),
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(serde_json::json!({
            "error": message
        }));

        (status, body).into_response()
    }
}

// Get reviews for a specific room type
pub async fn get_room_reviews_handler(
    State(pool): State<sqlx::PgPool>,
    Path(room_type): Path<String>,
) -> Result<Json<Vec<crate::models::GuestReview>>, ApiError> {
    let reviews = sqlx::query_as::<_, crate::models::GuestReview>(
        r#"
        SELECT
            gr.id,
            gr.guest_id,
            g.full_name as guest_name,
            gr.room_type_id,
            gr.overall_rating,
            gr.cleanliness_rating,
            gr.staff_rating,
            gr.facilities_rating,
            gr.value_rating,
            gr.location_rating,
            gr.title,
            gr.review_text,
            gr.pros,
            gr.cons,
            gr.recommend,
            gr.stay_type,
            gr.is_verified,
            gr.helpful_count,
            gr.created_at
        FROM guest_reviews gr
        INNER JOIN guests g ON gr.guest_id = g.id
        INNER JOIN room_types rt ON gr.room_type_id = rt.id
        WHERE rt.name = $1 AND gr.is_published = true
        ORDER BY gr.created_at DESC
        "#
    )
    .bind(&room_type)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reviews))
}

// ============================================================================
// USER-GUEST RELATIONSHIP HANDLERS
// ============================================================================

// Link a guest to the current user
pub async fn link_guest_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
    Json(input): Json<crate::models::LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use crate::middleware::require_auth;

    let user_id = require_auth(&headers).await?;

    // Verify guest exists
    let guest_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1 AND deleted_at IS NULL)"
    )
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !guest_exists {
        return Err(ApiError::NotFound("Guest not found".to_string()));
    }

    // Insert link
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
        "#
    )
    .bind(user_id)
    .bind(input.guest_id)
    .bind(input.relationship_type.unwrap_or_else(|| "owner".to_string()))
    .bind(input.can_book_for.unwrap_or(true))
    .bind(input.can_view_bookings.unwrap_or(true))
    .bind(input.can_modify.unwrap_or(true))
    .bind(input.notes)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Guest linked successfully",
        "guest_id": input.guest_id
    })))
}

// Unlink a guest from the current user
pub async fn unlink_guest_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use crate::middleware::require_auth;

    let user_id = require_auth(&headers).await?;

    let result = sqlx::query(
        "DELETE FROM user_guests WHERE user_id = $1 AND guest_id = $2"
    )
    .bind(user_id)
    .bind(guest_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Guest link not found".to_string()));
    }

    Ok(Json(serde_json::json!({
        "message": "Guest unlinked successfully",
        "guest_id": guest_id
    })))
}

// Get all guests linked to the current user
pub async fn get_my_guests_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::Guest>>, ApiError> {
    use crate::middleware::require_auth;

    let user_id = require_auth(&headers).await?;

    let guests = sqlx::query_as::<_, crate::models::Guest>(
        r#"
        SELECT DISTINCT g.id, g.full_name, g.email, g.phone, g.address_line1, g.city, g.state_province, g.postal_code, g.country, g.created_at, g.updated_at
        FROM guests g
        INNER JOIN user_guests ug ON g.id = ug.guest_id
        WHERE ug.user_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.full_name
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(guests))
}

// Upgrade a guest to a user account
pub async fn upgrade_guest_to_user_handler(
    State(pool): State<sqlx::PgPool>,
    headers: HeaderMap,
    Json(input): Json<crate::models::UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use crate::middleware::require_auth;

    let requesting_user_id = require_auth(&headers).await?;

    // Verify the requesting user has a relationship with this guest
    let has_relationship: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2 AND can_modify = true)"
    )
    .bind(requesting_user_id)
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_relationship {
        return Err(ApiError::Unauthorized("You don't have permission to upgrade this guest".to_string()));
    }

    // Hash the password
    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // Call the upgrade function
    let new_user_id: i64 = sqlx::query_scalar(
        "SELECT upgrade_guest_to_user($1, $2, $3, $4)"
    )
    .bind(input.guest_id)
    .bind(&input.username)
    .bind(&password_hash)
    .bind(input.role.unwrap_or_else(|| "guest".to_string()))
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        // Check for specific error messages
        let err_msg = e.to_string();
        if err_msg.contains("already exists") {
            ApiError::BadRequest(format!("User with this email already exists"))
        } else if err_msg.contains("not found") {
            ApiError::NotFound("Guest not found or deleted".to_string())
        } else {
            ApiError::Database(err_msg)
        }
    })?;

    Ok(Json(serde_json::json!({
        "message": "Guest upgraded to user successfully",
        "guest_id": input.guest_id,
        "user_id": new_user_id,
        "username": input.username
    })))
}

