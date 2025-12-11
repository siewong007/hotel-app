-- ============================================================================
-- BOOKING ENHANCEMENTS - Add Folio, Post Type, and Rate Code
-- ============================================================================
-- Description: Add fields for hotel front desk operations
-- Version: 1.0
-- Created: 2025-12-10
-- ============================================================================

-- Add folio number to bookings
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS folio_number VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) DEFAULT 'normal_stay'
    CHECK (post_type IN ('normal_stay', 'same_day')),
ADD COLUMN IF NOT EXISTS rate_code VARCHAR(10) DEFAULT 'RACK';

-- Create index for folio number lookups
CREATE INDEX IF NOT EXISTS idx_bookings_folio_number ON bookings(folio_number);

-- Add comment
COMMENT ON COLUMN bookings.folio_number IS 'Front desk folio/account number for this booking';
COMMENT ON COLUMN bookings.post_type IS 'Type of posting: normal_stay or same_day checkout';
COMMENT ON COLUMN bookings.rate_code IS 'Rate code: RACK (standard), OVR (override), or custom codes';

-- ============================================================================
-- Ensure Room Type Codes are Standardized
-- ============================================================================

-- Update existing room types to use standard codes if not already set
-- These are common hotel industry codes
UPDATE room_types SET code = 'SUP' WHERE name ILIKE '%superior%' AND code != 'SUP';
UPDATE room_types SET code = 'STDQ' WHERE name ILIKE '%standard%queen%' AND code != 'STDQ';
UPDATE room_types SET code = 'DLXK' WHERE name ILIKE '%deluxe%king%' AND code != 'DLXK';
UPDATE room_types SET code = 'FS' WHERE name ILIKE '%family%suite%' AND code != 'FS';
UPDATE room_types SET code = 'FR' WHERE name ILIKE '%family%room%' AND code != 'FR';

-- ============================================================================
-- Insert Standard Rate Codes if not exists
-- ============================================================================

-- RACK rate (standard published rate)
INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, adjustment_value, is_active, priority)
VALUES (
    'Rack Rate',
    'RACK',
    'Standard published room rate',
    'standard',
    'override',
    NULL,
    true,
    0
)
ON CONFLICT (code) DO NOTHING;

-- OVR rate (override/negotiated rate)
INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, is_active, priority)
VALUES (
    'Override Rate',
    'OVR',
    'Special override or negotiated rate',
    'promotional',
    'override',
    true,
    100
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- Function to Auto-Generate Folio Numbers
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_folio_number()
RETURNS TRIGGER AS $$
DECLARE
    next_folio_num INTEGER;
    folio_prefix VARCHAR(10);
    new_folio VARCHAR(50);
BEGIN
    -- Only generate if folio_number is not already set
    IF NEW.folio_number IS NULL THEN
        -- Get current date prefix
        folio_prefix := 'F' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-';

        -- Get next sequential number for today
        SELECT COALESCE(MAX(
            CAST(
                SUBSTRING(folio_number FROM LENGTH(folio_prefix) + 1) AS INTEGER
            )
        ), 0) + 1
        INTO next_folio_num
        FROM bookings
        WHERE folio_number LIKE folio_prefix || '%';

        -- Generate folio number: F20251210-0001
        new_folio := folio_prefix || LPAD(next_folio_num::TEXT, 4, '0');

        NEW.folio_number := new_folio;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate folio numbers
DROP TRIGGER IF EXISTS trigger_generate_folio_number ON bookings;
CREATE TRIGGER trigger_generate_folio_number
    BEFORE INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION generate_folio_number();

-- ============================================================================
-- Update Existing Bookings with Folio Numbers
-- ============================================================================

-- Generate folio numbers for existing bookings that don't have one
DO $$
DECLARE
    booking_record RECORD;
    folio_date DATE;
    folio_prefix VARCHAR(10);
    folio_counter INTEGER;
    new_folio VARCHAR(50);
BEGIN
    folio_counter := 1;
    folio_date := NULL;

    FOR booking_record IN
        SELECT id, created_at::DATE as booking_date
        FROM bookings
        WHERE folio_number IS NULL
        ORDER BY created_at
    LOOP
        -- Reset counter if date changes
        IF folio_date IS NULL OR folio_date != booking_record.booking_date THEN
            folio_date := booking_record.booking_date;
            folio_counter := 1;
        END IF;

        folio_prefix := 'F' || TO_CHAR(folio_date, 'YYYYMMDD') || '-';
        new_folio := folio_prefix || LPAD(folio_counter::TEXT, 4, '0');

        UPDATE bookings
        SET folio_number = new_folio
        WHERE id = booking_record.id;

        folio_counter := folio_counter + 1;
    END LOOP;
END $$;

-- Add comment
COMMENT ON FUNCTION generate_folio_number IS 'Auto-generates sequential folio numbers in format F20251210-0001';
