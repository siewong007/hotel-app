-- Migration: Enhanced Check-In Fields
-- Description: Add fields to support PMS-style check-in interface
-- Date: 2025-12-18

-- ============================================
-- GUESTS TABLE ENHANCEMENTS
-- ============================================

-- Add title field (Mr, Mrs, Ms, Dr, etc.)
ALTER TABLE guests ADD COLUMN IF NOT EXISTS title VARCHAR(20);

-- Add alternative/secondary phone number
ALTER TABLE guests ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20);

-- ============================================
-- BOOKINGS TABLE ENHANCEMENTS
-- ============================================

-- Market segment code (WKII=Walk-in, CORP=Corporate, GOVT=Government, OTA=Online Travel Agency, etc.)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS market_code VARCHAR(50);

-- Discount percentage applied to the booking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0.00;

-- Rate overrides for weekday and weekend (allows manual rate adjustment)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rate_override_weekday DECIMAL(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rate_override_weekend DECIMAL(10,2);

-- Check-in and check-out times (separate from dates)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS check_in_time TIME DEFAULT '15:00:00';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS check_out_time TIME DEFAULT '11:00:00';

-- Pre-check-in status (for guest portal self-service)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_completed_at TIMESTAMP WITH TIME ZONE;

-- Pre-check-in access token (for guest portal authentication)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_token VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_token_expires_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- SYSTEM SETTINGS FOR RATE AND MARKET CODES
-- ============================================

-- Insert default rate codes
INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
  ('rate_codes', '["RACK","OVR","CORP","GOVT","WKII","PKG","GRP","AAA","PROMO"]', 'json', 'rates', 'Available rate codes for bookings', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Insert default market segment codes
INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
  ('market_codes', '["WKII","CORP","GOVT","OTA","DIRECT","GROUP","EVENTS","LEISURE"]', 'json', 'sales', 'Market segment codes for sales tracking', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Insert default guest titles
INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
  ('guest_titles', '["Mr","Mrs","Ms","Miss","Dr","Prof","Rev"]', 'json', 'guests', 'Available guest title options', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Index on pre-check-in token for quick lookup
CREATE INDEX IF NOT EXISTS idx_bookings_pre_checkin_token ON bookings(pre_checkin_token) WHERE pre_checkin_token IS NOT NULL;

-- Index on market code for reporting
CREATE INDEX IF NOT EXISTS idx_bookings_market_code ON bookings(market_code) WHERE market_code IS NOT NULL;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN guests.title IS 'Guest title (Mr, Mrs, Ms, Dr, etc.)';
COMMENT ON COLUMN guests.alt_phone IS 'Alternative/secondary phone number';

COMMENT ON COLUMN bookings.market_code IS 'Market segment code (WKII, CORP, GOVT, OTA, etc.)';
COMMENT ON COLUMN bookings.discount_percentage IS 'Discount percentage applied to booking';
COMMENT ON COLUMN bookings.rate_override_weekday IS 'Manual rate override for weekday nights';
COMMENT ON COLUMN bookings.rate_override_weekend IS 'Manual rate override for weekend nights';
COMMENT ON COLUMN bookings.check_in_time IS 'Check-in time (default 15:00)';
COMMENT ON COLUMN bookings.check_out_time IS 'Check-out time (default 11:00)';
COMMENT ON COLUMN bookings.pre_checkin_completed IS 'Guest completed pre-check-in via portal';
COMMENT ON COLUMN bookings.pre_checkin_completed_at IS 'Timestamp when guest completed pre-check-in';
COMMENT ON COLUMN bookings.pre_checkin_token IS 'Unique token for guest portal access';
COMMENT ON COLUMN bookings.pre_checkin_token_expires_at IS 'Expiry timestamp for pre-check-in token';
