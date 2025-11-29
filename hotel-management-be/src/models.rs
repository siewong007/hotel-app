use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;

// User models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserWithRoles {
    pub user: User,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

// Room models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Room {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: Decimal,
    pub available: bool,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomInput {
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: f64,
    pub description: Option<String>,
    pub max_occupancy: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomUpdateInput {
    pub room_number: Option<String>,
    pub room_type: Option<String>,
    pub price_per_night: Option<f64>,
    pub available: Option<bool>,
    pub description: Option<String>,
    pub max_occupancy: Option<i32>,
}

// Guest models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Guest {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GuestInput {
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub address: Option<String>,
}

// Booking models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Booking {
    pub id: i64,
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub total_price: Decimal,
    pub status: String,
    pub created_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BookingInput {
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in: String,
    pub check_out: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct BookingWithDetails {
    pub id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: String,
    pub room_id: i64,
    pub room_number: String,
    pub room_type: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub total_price: Decimal,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

// Search query
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub room_type: Option<String>,
    pub max_price: Option<f64>,
}

// Auth models
#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: User,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyRegistrationStart {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyRegistrationFinish {
    pub username: String,
    pub credential: String, // Base64 encoded credential
    pub challenge: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyLoginStart {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyLoginFinish {
    pub username: String,
    pub credential_id: String,
    pub authenticator_data: String,
    pub client_data_json: String,
    pub signature: String,
    pub challenge: String,
}

// RBAC models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Role {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoleInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Permission {
    pub id: i64,
    pub name: String,
    pub resource: String,
    pub action: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PermissionInput {
    pub name: String,
    pub resource: String,
    pub action: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignRoleInput {
    pub user_id: i64,
    pub role_id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignPermissionInput {
    pub role_id: i64,
    pub permission_id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoleWithPermissions {
    pub role: Role,
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserWithRolesAndPermissions {
    pub user: User,
    pub roles: Vec<Role>,
    pub permissions: Vec<Permission>,
}

