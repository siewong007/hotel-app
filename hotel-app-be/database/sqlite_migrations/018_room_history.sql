-- room_history: guest check-in/check-out status history (mirrors Postgres room_history).
-- Fixes: INSERT_ROOM_HISTORY / INSERT_ROOM_HISTORY_CHANGE / GET_ROOM_HISTORY in
-- src/repositories/rooms_queries.rs target "room_history", which is NOT the same
-- table as the pre-existing room_status_history (different columns). SQLite never
-- had a matching migration, so these queries fail with "no such table: room_history"
-- on every SQLite build.

CREATE TABLE IF NOT EXISTS room_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    notes TEXT,
    start_date TEXT,
    end_date TEXT,
    changed_by INTEGER REFERENCES users(id),
    is_auto_generated INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_room_history_room ON room_history(room_id);
CREATE INDEX IF NOT EXISTS idx_room_history_created ON room_history(created_at DESC);
