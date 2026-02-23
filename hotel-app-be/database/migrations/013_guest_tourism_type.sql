-- ============================================================================
-- MIGRATION 013: GUEST TOURISM TYPE
-- ============================================================================
-- Description: Add tourism_type field to guests for tourism tax calculation
-- Local tourism: No tourism tax charged
-- Foreign tourism: Tourism tax charged per night
-- ============================================================================

-- Create enum for tourism type
DO $$ BEGIN
    CREATE TYPE tourism_type AS ENUM ('local', 'foreign');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add tourism_type column to guests table
ALTER TABLE guests
ADD COLUMN IF NOT EXISTS tourism_type tourism_type DEFAULT NULL;

-- Add index for tourism_type queries
CREATE INDEX IF NOT EXISTS idx_guests_tourism_type ON guests(tourism_type) WHERE tourism_type IS NOT NULL;

-- Add comment
COMMENT ON COLUMN guests.tourism_type IS 'Tourism type: local (no tourism tax) or foreign (tourism tax applies). NULL means not specified.';
