-- Migration: Fix email constraint to handle empty strings
-- This migration adds a trigger to convert empty string emails to NULL

-- Drop the existing constraint
ALTER TABLE guests DROP CONSTRAINT IF EXISTS valid_email_format;

-- Create a function to normalize email (convert empty string to NULL)
CREATE OR REPLACE FUNCTION normalize_guest_email()
RETURNS TRIGGER AS $$
BEGIN
    -- Convert empty string to NULL
    IF NEW.email IS NOT NULL AND TRIM(NEW.email) = '' THEN
        NEW.email := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to normalize email before insert or update
DROP TRIGGER IF EXISTS normalize_guest_email_trigger ON guests;
CREATE TRIGGER normalize_guest_email_trigger
    BEFORE INSERT OR UPDATE ON guests
    FOR EACH ROW
    EXECUTE FUNCTION normalize_guest_email();

-- Re-add the constraint (it will now work because empty strings are converted to NULL by the trigger)
ALTER TABLE guests ADD CONSTRAINT valid_email_format
    CHECK (email IS NULL OR email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');

-- Also update any existing empty string emails to NULL
UPDATE guests SET email = NULL WHERE email IS NOT NULL AND TRIM(email) = '';
