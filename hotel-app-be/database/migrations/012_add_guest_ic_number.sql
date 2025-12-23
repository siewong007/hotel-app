-- ============================================================================
-- MIGRATION 012: ADD IC NUMBER AND NATIONALITY TO GUESTS
-- ============================================================================
-- Description: Add identity card number and nationality fields to guests table
-- Created: 2025-12-17
-- ============================================================================

-- Add IC number and nationality columns
ALTER TABLE guests
ADD COLUMN IF NOT EXISTS ic_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);

-- Create index for faster IC number lookups
CREATE INDEX IF NOT EXISTS idx_guests_ic_number ON guests(ic_number);

-- Add comments
COMMENT ON COLUMN guests.ic_number IS 'Identity card or passport number';
COMMENT ON COLUMN guests.nationality IS 'Guest nationality/citizenship';
