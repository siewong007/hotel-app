-- Migration: Add user-to-guest links for SQLite parity with PostgreSQL.

CREATE TABLE IF NOT EXISTS user_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    relationship_type TEXT DEFAULT 'family',
    can_book_for INTEGER DEFAULT 1,
    can_view_bookings INTEGER DEFAULT 1,
    can_modify INTEGER DEFAULT 0,
    notes TEXT,
    linked_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_guest_id ON user_guests(guest_id);
