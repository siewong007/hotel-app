-- Tie eKYC/self-check-in events to guest profiles and require approved eKYC
-- for scheduled auto check-in by default.

ALTER TABLE self_checkin_events ADD COLUMN guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL;
ALTER TABLE self_checkin_events ADD COLUMN source TEXT;

UPDATE ekyc_verifications
SET guest_id = (
    SELECT users.guest_id
    FROM users
    WHERE users.id = ekyc_verifications.user_id
)
WHERE guest_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = ekyc_verifications.user_id
        AND users.guest_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_ekyc_guest_latest
    ON ekyc_verifications(guest_id, submitted_at DESC, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_self_checkin_events_guest ON self_checkin_events(guest_id);
CREATE INDEX IF NOT EXISTS idx_self_checkin_events_source ON self_checkin_events(source);

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES (
    'auto_checkin_requires_ekyc',
    'true',
    'boolean',
    'frontdesk',
    'Require approved guest eKYC before scheduled auto check-in',
    0
);

-- Hide the operational/admin navigation entries (Timeline, Bookings, Rooms,
-- Complimentary Nights) from guests. The 001 seed uses ON CONFLICT DO NOTHING,
-- so this patches pre-existing rows by setting nav_excluded_roles to exclude
-- 'guest' (which short-circuits nav visibility regardless of the guest role's
-- permissions). My Bookings is intentionally left visible to guests.
UPDATE route_access_policies
SET nav_excluded_roles = '["guest"]',
    updated_at = datetime('now')
WHERE route_id IN ('timeline', 'bookings', 'room-management', 'complimentary')
  AND nav_excluded_roles <> '["guest"]';

-- Revert any prior guest exclusion on My Bookings so guests retain access.
UPDATE route_access_policies
SET nav_excluded_roles = '["super_admin","admin","manager","receptionist","staff"]',
    updated_at = datetime('now')
WHERE route_id = 'my-bookings'
  AND nav_excluded_roles <> '["super_admin","admin","manager","receptionist","staff"]';
