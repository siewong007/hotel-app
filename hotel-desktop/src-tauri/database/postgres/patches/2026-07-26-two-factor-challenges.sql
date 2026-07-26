-- Patch: two-factor setup challenges table (PostgreSQL)
-- Date: 2026-07-26
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/migrations/0001_v1_baseline.sql, which now creates
-- two_factor_challenges. Without the table, every call to
-- POST /api/profile/2fa/setup fails at runtime with
-- "relation two_factor_challenges does not exist"
-- (AuthService::create_2fa_challenge INSERTs into it with
-- ON CONFLICT (user_id, purpose), hence the composite primary key).
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-26-two-factor-challenges.sql

-- Short-lived challenges issued while a user sets up two-factor authentication.
CREATE TABLE IF NOT EXISTS two_factor_challenges (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_code VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, purpose)
);

COMMENT ON TABLE two_factor_challenges IS 'Short-lived challenges issued while a user sets up two-factor authentication; one active challenge per (user, purpose)';
