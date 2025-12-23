-- ============================================================================
-- MIGRATION 001: CORE SYSTEM SETUP
-- ============================================================================
-- Description: Extensions, sequences, and core utility functions
-- Created: 2025-01-29
-- ============================================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE UTILITY FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS void AS $$
BEGIN
    DELETE FROM passkey_challenges WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    UPDATE user_sessions
    SET is_active = false
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;

    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP AND is_revoked = false;
END;
$$ LANGUAGE plpgsql;

-- Function to increment failed login attempts
CREATE OR REPLACE FUNCTION increment_failed_login(user_email VARCHAR)
RETURNS void AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        is_locked = CASE
            WHEN failed_login_attempts >= 4 THEN true
            ELSE false
        END,
        locked_until = CASE
            WHEN failed_login_attempts >= 4 THEN CURRENT_TIMESTAMP + INTERVAL '30 minutes'
            ELSE NULL
        END
    WHERE email = user_email;
END;
$$ LANGUAGE plpgsql;

-- Function to reset failed login attempts
CREATE OR REPLACE FUNCTION reset_failed_login(user_email VARCHAR)
RETURNS void AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = 0,
        is_locked = false,
        locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP
    WHERE email = user_email;
END;
$$ LANGUAGE plpgsql;
