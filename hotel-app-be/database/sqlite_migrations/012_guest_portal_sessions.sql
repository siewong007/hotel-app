-- Guest portal bearer-token sessions.
-- A guest logs in with their email plus a booking number or loyalty member
-- number; on success we store only the SHA-256 hash of the issued token here.
-- Distinct from the pre-check-in path tokens on the bookings table.

CREATE TABLE IF NOT EXISTS guest_portal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_guest_portal_sessions_guest_id ON guest_portal_sessions(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_portal_sessions_expires_at ON guest_portal_sessions(expires_at);
