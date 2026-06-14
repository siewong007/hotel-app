-- Align SQLite with PostgreSQL for room-type-specific complimentary credits.

CREATE TABLE IF NOT EXISTS guest_complimentary_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    nights_available INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(guest_id, room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_credits_guest_id ON guest_complimentary_credits(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_credits_room_type ON guest_complimentary_credits(room_type_id);
