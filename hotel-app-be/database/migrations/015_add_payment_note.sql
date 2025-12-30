-- Migration 015: Add payment_note column to bookings table
-- This allows tracking notes when payment status changes

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_note TEXT;

COMMENT ON COLUMN bookings.payment_note IS 'Note or remarks about payment status changes';
