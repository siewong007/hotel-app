//! User profile workflows

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{PasswordUpdateInput, UserProfile, UserProfileUpdate};
use crate::repositories::user::UserRepository;
use crate::utils::sanitization::Sanitizer;
use validator::Validate;

pub async fn get_user_profile(pool: &DbPool, user_id: i64) -> Result<UserProfile, ApiError> {
    UserRepository::get_profile(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))
}

pub async fn update_user_profile(
    pool: &DbPool,
    user_id: i64,
    mut input: UserProfileUpdate,
) -> Result<UserProfile, ApiError> {
    input
        .validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    if let Some(full_name) = &input.full_name {
        input.full_name = Some(Sanitizer::sanitize_guest_name(full_name));
    }
    if let Some(email) = &input.email {
        input.email = Some(Sanitizer::sanitize_email(email));
    }
    if let Some(phone) = &input.phone {
        input.phone = Some(Sanitizer::sanitize_phone(phone));
    }
    if let Some(avatar_url) = &input.avatar_url {
        input.avatar_url = Sanitizer::sanitize_url(avatar_url);
    }

    if let Some(full_name) = input.full_name {
        UserRepository::update_full_name(pool, user_id, &full_name).await?;
    }
    if let Some(email) = input.email {
        UserRepository::update_email(pool, user_id, &email).await?;
    }
    if let Some(phone) = input.phone {
        UserRepository::update_phone(pool, user_id, &phone).await?;
    }
    if let Some(avatar_url) = input.avatar_url {
        UserRepository::update_avatar_url(pool, user_id, &avatar_url).await?;
    }

    get_user_profile(pool, user_id).await
}

pub async fn update_password(
    pool: &DbPool,
    user_id: i64,
    input: PasswordUpdateInput,
) -> Result<(), ApiError> {
    input
        .validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    AuthService::validate_password(&input.new_password).map_err(ApiError::BadRequest)?;

    let current_hash = UserRepository::get_password_hash(pool, user_id).await?;
    let valid = AuthService::verify_password(&input.current_password, &current_hash)
        .await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized(
            "Current password is incorrect".to_string(),
        ));
    }

    let new_hash = AuthService::hash_password(&input.new_password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    UserRepository::update_password_hash(pool, user_id, &new_hash).await
}
