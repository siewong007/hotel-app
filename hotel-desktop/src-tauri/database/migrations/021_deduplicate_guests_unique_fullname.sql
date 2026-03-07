-- Migration: Deduplicate guests and enforce unique full_name
-- For each duplicate group (same LOWER(TRIM(full_name))), keep the record with
-- the most data (prioritizing email, then phone, then lowest id).
-- All foreign key references are updated to the surviving record before deletion.

DO $$
DECLARE
    r RECORD;
    keep_id BIGINT;
    dup_id BIGINT;
BEGIN
    -- Loop over each group of duplicate full_names
    FOR r IN
        SELECT LOWER(TRIM(full_name)) AS norm_name
        FROM guests
        WHERE deleted_at IS NULL
        GROUP BY LOWER(TRIM(full_name))
        HAVING COUNT(*) > 1
    LOOP
        -- Pick the "best" record to keep: prefer one with email, then phone, then lowest id
        SELECT id INTO keep_id
        FROM guests
        WHERE LOWER(TRIM(full_name)) = r.norm_name
          AND deleted_at IS NULL
        ORDER BY
            (email IS NOT NULL AND email != '') DESC,
            (phone IS NOT NULL AND phone != '') DESC,
            id ASC
        LIMIT 1;

        -- For each duplicate (not the keeper), reassign references then delete
        FOR dup_id IN
            SELECT id FROM guests
            WHERE LOWER(TRIM(full_name)) = r.norm_name
              AND deleted_at IS NULL
              AND id != keep_id
        LOOP
            -- Reassign bookings
            UPDATE bookings SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign booking_guests
            UPDATE booking_guests SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM booking_guests bg2
                WHERE bg2.booking_id = booking_guests.booking_id AND bg2.guest_id = keep_id
              );

            -- Reassign booking_modifications
            UPDATE booking_modifications SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign invoices
            UPDATE invoices SET bill_to_guest_id = keep_id WHERE bill_to_guest_id = dup_id;

            -- Reassign customer_ledgers
            UPDATE customer_ledgers SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Soft-delete the duplicate (cascade tables will follow)
            UPDATE guests SET deleted_at = CURRENT_TIMESTAMP WHERE id = dup_id;
        END LOOP;
    END LOOP;
END $$;

-- Normalize full_name trimming on all active records
UPDATE guests SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name) AND deleted_at IS NULL;

-- Add unique index on LOWER(full_name) for active guests
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_full_name_unique
    ON guests (LOWER(TRIM(full_name)))
    WHERE deleted_at IS NULL;
