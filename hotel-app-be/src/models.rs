use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomWithRating {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: Decimal,
    pub available: bool,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub average_rating: Option<f64>,
    pub review_count: Option<i64>,
}

// Review models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct GuestReview {
    pub id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub room_type_id: Option<i64>,
    pub overall_rating: Option<Decimal>,
    pub cleanliness_rating: Option<Decimal>,
    pub staff_rating: Option<Decimal>,
    pub facilities_rating: Option<Decimal>,
    pub value_rating: Option<Decimal>,
    pub location_rating: Option<Decimal>,
    pub title: Option<String>,
    pub review_text: Option<String>,
    pub pros: Option<String>,
    pub cons: Option<String>,
    pub recommend: Option<bool>,
    pub stay_type: Option<String>,
    pub is_verified: bool,
    pub helpful_count: i32,
    pub created_at: DateTime<Utc>,
}

// Guest models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Guest {
    pub id: i64,
    pub full_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GuestInput {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

// User-Guest relationship models
#[derive(Debug, Serialize, Deserialize)]
pub struct LinkGuestInput {
    pub guest_id: i64,
    pub relationship_type: Option<String>, // 'owner', 'family', 'friend', etc.
    pub can_book_for: Option<bool>,
    pub can_view_bookings: Option<bool>,
    pub can_modify: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpgradeGuestInput {
    pub guest_id: i64,
    pub username: String,
    pub password: String,
    pub role: Option<String>, // defaults to 'guest'
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserGuestLink {
    pub user_id: i64,
    pub guest_id: i64,
    pub relationship_type: String,
    pub can_book_for: bool,
    pub can_view_bookings: bool,
    pub can_modify: bool,
}

// Booking models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Booking {
    pub id: i64,
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub total_amount: Decimal,
    pub status: String,
    pub folio_number: Option<String>,
    pub post_type: Option<String>,
    pub rate_code: Option<String>,
    pub created_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BookingInput {
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub post_type: Option<String>, // 'normal_stay' or 'same_day'
    pub rate_code: Option<String>, // 'RACK', 'OVR', etc.
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
    pub room_type_code: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub total_amount: Decimal,
    pub status: String,
    pub folio_number: Option<String>,
    pub post_type: Option<String>,
    pub rate_code: Option<String>,
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
    pub is_first_login: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
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
    pub device_name: Option<String>, // Optional device name/nickname
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

// User Profile models
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserProfileUpdate {
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasswordUpdateInput {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserCreateInput {
    pub username: String,
    pub email: String,
    pub password: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub role_ids: Option<Vec<i64>>, // Optional: roles to assign on creation
}

// Passkey models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Passkey {
    pub id: Uuid,
    pub user_id: i64,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct PasskeyInfo {
    pub id: Uuid,
    pub credential_id: String,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyUpdateInput {
    pub device_name: String,
}

// Loyalty Program models
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoyaltyProgram {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub tier_level: i32,
    pub points_multiplier: Decimal,
    pub minimum_points_required: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoyaltyMembership {
    pub id: i64,
    pub guest_id: i64,
    pub program_id: i64,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub status: String,
    pub enrolled_date: NaiveDate,
    pub expiry_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct LoyaltyMembershipWithDetails {
    pub id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: String,
    pub program_id: i64,
    pub program_name: String,
    pub program_description: Option<String>,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub points_multiplier: Decimal,
    pub status: String,
    pub enrolled_date: NaiveDate,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PointsTransaction {
    pub id: String, // UUID
    pub membership_id: i64,
    pub transaction_type: String,
    pub points_amount: i32,
    pub balance_after: i32,
    pub reference_type: Option<String>,
    pub reference_id: Option<i64>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct TierStatistics {
    pub tier_level: i32,
    pub tier_name: String,
    pub count: i64,
    pub percentage: f64,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct TopMember {
    pub guest_name: String,
    pub guest_email: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub membership_number: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct RecentTransaction {
    pub id: String,
    pub guest_name: String,
    pub transaction_type: String,
    pub points_amount: i32,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct MembershipGrowth {
    pub date: String,
    pub new_members: i64,
    pub total_members: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct PointsActivity {
    pub date: String,
    pub points_earned: i64,
    pub points_redeemed: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoyaltyStatistics {
    pub total_members: i64,
    pub active_members: i64,
    pub members_by_tier: Vec<TierStatistics>,
    pub total_points_issued: i64,
    pub total_points_redeemed: i64,
    pub total_points_active: i64,
    pub average_points_per_member: f64,
    pub top_members: Vec<TopMember>,
    pub recent_transactions: Vec<RecentTransaction>,
    pub membership_growth: Vec<MembershipGrowth>,
    pub points_activity: Vec<PointsActivity>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddPointsInput {
    pub points: i32,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RedeemPointsInput {
    pub points: i32,
    pub description: Option<String>,
}

// User's loyalty membership view (for their own profile)
#[derive(Debug, Serialize, Deserialize)]
pub struct UserLoyaltyMembership {
    pub id: i64,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub tier_name: String,
    pub status: String,
    pub enrolled_date: NaiveDate,
    pub expiry_date: Option<NaiveDate>,
    pub next_tier: Option<TierInfo>,
    pub current_tier_benefits: Vec<String>,
    pub points_to_next_tier: Option<i32>,
    pub recent_transactions: Vec<PointsTransaction>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierInfo {
    pub tier_level: i32,
    pub tier_name: String,
    pub minimum_points: i32,
    pub benefits: Vec<String>,
    pub points_multiplier: Decimal,
}

// Rewards Catalog
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoyaltyReward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String, // 'room_upgrade', 'service', 'discount', 'gift'
    pub points_cost: i32,
    pub monetary_value: Option<Decimal>,
    pub minimum_tier_level: i32,
    pub is_active: bool,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RedeemRewardInput {
    pub reward_id: i64,
    pub booking_id: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RewardInput {
    pub name: String,
    pub description: Option<String>,
    pub category: String, // 'room_upgrade', 'service', 'discount', 'gift', 'dining', 'spa', 'experience'
    pub points_cost: i32,
    pub monetary_value: Option<f64>,
    pub minimum_tier_level: i32,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RewardUpdateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub points_cost: Option<i32>,
    pub monetary_value: Option<f64>,
    pub minimum_tier_level: Option<i32>,
    pub is_active: Option<bool>,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RewardRedemption {
    pub id: i64,
    pub membership_id: i64,
    pub reward_id: i64,
    pub transaction_id: String, // UUID
    pub booking_id: Option<i64>,
    pub points_spent: i32,
    pub status: String,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct RewardRedemptionWithDetails {
    pub id: i64,
    pub membership_id: i64,
    pub membership_number: String,
    pub guest_name: String,
    pub guest_email: String,
    pub reward_id: i64,
    pub reward_name: String,
    pub reward_category: String,
    pub points_spent: i32,
    pub status: String,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

