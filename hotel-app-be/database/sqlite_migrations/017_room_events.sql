-- Room events log: status changes, scheduled events (mirrors Postgres room_events)
-- Fixes: INSERT_ROOM_EVENT / INSERT_ROOM_EVENT_FULL / GET_ROOM_EVENTS in
-- src/repositories/rooms_queries.rs referenced a table that never had a migration.

CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL DEFAULT 'status_change',
    status TEXT,
    priority TEXT DEFAULT 'normal',
    notes TEXT,
    scheduled_date TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_id);
CREATE INDEX IF NOT EXISTS idx_room_events_created ON room_events(created_at DESC);
