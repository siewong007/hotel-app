-- Automatic cleanup of signed-in sessions.
--
-- Signing out only marks a `refresh_tokens` row revoked and an expired row is
-- never revisited, so the table and the Profile page's "Signed-in devices"
-- list grew without bound. The backend's hourly session-retention sweep now
-- deletes rows that expired or were revoked more than N days ago, and every
-- sign-in trims an account to its live-session cap. These rows hold the
-- defaults; `0` switches a policy off, and `SESSION_PURGE_EXPIRED_DAYS`,
-- `SESSION_PURGE_REVOKED_DAYS`, `SESSION_MAX_ACTIVE_PER_USER` and
-- `SESSION_IDLE_DAYS` override them per deployment. `audit_logs` is not
-- touched. Fresh installs also get the rows from seed.sql. `value` is never
-- overwritten. Idempotent.

INSERT INTO system_settings (key, value, value_type, category, description, is_public, default_value)
VALUES
    ('session_purge_expired_days', '7', 'number', 'security',
     'Days an expired sign-in session is kept before it is deleted automatically. 0 keeps expired sessions forever.',
     false, '7'),
    ('session_purge_revoked_days', '7', 'number', 'security',
     'Days a signed-out or revoked session is kept before it is deleted automatically. 0 keeps them forever.',
     false, '7'),
    ('session_max_active_per_user', '10', 'number', 'security',
     'Most signed-in devices one account may have. Signing in on another device signs out the least recently used one. 0 means no limit.',
     false, '10'),
    ('session_idle_days', '0', 'number', 'security',
     'Days without activity after which a signed-in device is signed out automatically. 0 turns this off (sessions still expire 30 days after their last use).',
     false, '0')
ON CONFLICT (key) DO UPDATE SET
    value_type = EXCLUDED.value_type,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    is_public = EXCLUDED.is_public,
    default_value = COALESCE(system_settings.default_value, EXCLUDED.default_value),
    updated_at = CURRENT_TIMESTAMP
WHERE system_settings.value_type IS DISTINCT FROM EXCLUDED.value_type
   OR system_settings.category IS DISTINCT FROM EXCLUDED.category
   OR system_settings.description IS DISTINCT FROM EXCLUDED.description
   OR system_settings.is_public IS DISTINCT FROM EXCLUDED.is_public
   OR system_settings.default_value IS NULL;

-- The revoked-session purge filters on revoked_at; the existing session
-- indexes are all partial on non-revoked rows and cannot serve it.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked_at
    ON public.refresh_tokens USING btree (revoked_at)
    WHERE revoked_at IS NOT NULL;
