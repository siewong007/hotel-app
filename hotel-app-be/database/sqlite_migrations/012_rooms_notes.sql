-- Align SQLite rooms schema with the shared room query surface.

ALTER TABLE rooms ADD COLUMN notes TEXT;
