use crate::auth::AuthService;
use crate::models::*;
use crate::middleware::require_auth;
use sqlx::{PgPool, Row};
use axum::{
    extract::{Path, Query, State, Extension},
    http::{StatusCode, HeaderMap},
    response::{Json, Response, IntoResponse},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;

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

    // Generate refresh token (simplified - in production use proper refresh token storage)
    let refresh_token = format!("{}", chrono::Utc::now().timestamp());

    // Update last login
    sqlx::query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1")
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
    };

    Ok(Json(response))
}

pub async fn get_rooms_handler(
    State(pool): State<sqlx::PgPool>,
) -> Result<Json<Vec<Room>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, room_number, room_type, price_per_night::text, available, description, max_occupancy, created_at, updated_at FROM rooms ORDER BY room_number"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        rooms.push(Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
        });
    }

    Ok(Json(rooms))
}

pub async fn search_rooms_handler(
    State(pool): State<sqlx::PgPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<Room>>, ApiError> {
    let mut sql = "SELECT id, room_number, room_type, price_per_night::text, available, description, max_occupancy, created_at, updated_at FROM rooms WHERE available = true".to_string();
    let mut params: Vec<String> = vec![];

    if let Some(room_type) = &query.room_type {
        sql.push_str(" AND room_type ILIKE $1");
        params.push(format!("%{}%", room_type));
    }

    if let Some(max_price) = query.max_price {
        sql.push_str(" AND price_per_night <= $2");
        params.push(max_price.to_string());
    }

    sql.push_str(" ORDER BY price_per_night");

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
        rooms.push(Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
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
) -> Result<Json<Vec<Guest>>, ApiError> {
    let guests = sqlx::query_as::<_, Guest>(
        "SELECT id, name, email, phone, address, created_at, updated_at FROM guests ORDER BY name"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(guests))
}

pub async fn create_guest_handler(
    State(pool): State<sqlx::PgPool>,
    Json(input): Json<GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    let guest = sqlx::query_as::<_, Guest>(
        r#"
        INSERT INTO guests (name, email, phone, address)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, email, phone, address, created_at, updated_at
        "#
    )
    .bind(&input.name)
    .bind(&input.email)
    .bind(&input.phone)
    .bind(&input.address)
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
            g.name as guest_name,
            g.email as guest_email,
            b.room_id,
            r.room_number,
            r.room_type,
            b.check_in,
            b.check_out,
            b.total_price::text,
            b.status,
            b.created_at
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
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
            check_in: row.get(7),
            check_out: row.get(8),
            total_price: row.get::<String, _>(9).parse().unwrap_or_default(),
            status: row.get(10),
            created_at: row.get(11),
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
    let check_in = NaiveDate::parse_from_str(&input.check_in, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-in date format".to_string()))?;
    let check_out = NaiveDate::parse_from_str(&input.check_out, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-out date format".to_string()))?;

    if check_out <= check_in {
        return Err(ApiError::BadRequest("Check-out date must be after check-in date".to_string()));
    }

    // Check if room is available
    let row = sqlx::query(
        "SELECT id, room_number, room_type, price_per_night::text, available, description, max_occupancy, created_at, updated_at FROM rooms WHERE id = $1"
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
            AND status != 'cancelled'
            AND (
                (check_in <= $2 AND check_out > $2) OR
                (check_in < $3 AND check_out >= $3) OR
                (check_in >= $2 AND check_out <= $3)
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

    // Calculate total price
    let nights = (check_out - check_in).num_days() as i32;
    let total_price = room.price_per_night * Decimal::from(nights);

    // Create booking
    let row = sqlx::query(
        r#"
        INSERT INTO bookings (guest_id, room_id, check_in, check_out, total_price, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, guest_id, room_id, check_in, check_out, total_price::text, status, created_by, created_at, updated_at
        "#
    )
    .bind(input.guest_id)
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(total_price.to_string())
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    
    let booking = Booking {
        id: row.get(0),
        guest_id: row.get(1),
        room_id: row.get(2),
        check_in: row.get(3),
        check_out: row.get(4),
        total_price: row.get::<String, _>(5).parse().unwrap_or_default(),
        status: row.get(6),
        created_by: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
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

    let occupancy_rate = occupancy_data["occupancyRate"].as_f64().unwrap_or(0.0);
    let avg_booking_value = booking_data["averageBookingValue"].as_f64().unwrap_or(0.0);
    let total_rooms = occupancy_data["totalRooms"].as_i64().unwrap_or(1);
    let revenue = occupancy_data["revenue"].as_f64().unwrap_or(0.0);
    let revpar = revenue / total_rooms as f64;

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
    if avg_booking_value < 125.0 {
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

