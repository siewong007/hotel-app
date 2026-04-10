-- One-time script: Remove all duplicate guest records
-- For each group of guests with the same name (case-insensitive), keeps the one
-- with the most complete info (email > phone > lowest id) and reassigns all
-- foreign key references from duplicates to the keeper before deleting them.
--
-- Usage: psql -d your_database -f scripts/remove_duplicate_guests.sql
--
-- Run this BEFORE applying the unique index if it doesn't exist yet.

BEGIN;

-- Show duplicates that will be cleaned up
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT LOWER(TRIM(full_name)) AS norm_name
        FROM guests
        WHERE deleted_at IS NULL
        GROUP BY LOWER(TRIM(full_name))
        HAVING COUNT(*) > 1
    ) sub;
    RAISE NOTICE 'Found % duplicate guest name groups to clean up', dup_count;
END $$;

DO $$
DECLARE
    r RECORD;
    keep_id BIGINT;
    dup_id BIGINT;
    total_removed INTEGER := 0;
BEGIN
    FOR r IN
        SELECT LOWER(TRIM(full_name)) AS norm_name
        FROM guests
        WHERE deleted_at IS NULL
        GROUP BY LOWER(TRIM(full_name))
        HAVING COUNT(*) > 1
    LOOP
        -- Keep the record with the most complete data
        SELECT id INTO keep_id
        FROM guests
        WHERE LOWER(TRIM(full_name)) = r.norm_name
          AND deleted_at IS NULL
        ORDER BY
            (email IS NOT NULL AND email != '') DESC,
            (phone IS NOT NULL AND phone != '') DESC,
            id ASC
        LIMIT 1;

        FOR dup_id IN
            SELECT id FROM guests
            WHERE LOWER(TRIM(full_name)) = r.norm_name
              AND deleted_at IS NULL
              AND id != keep_id
        LOOP
            RAISE NOTICE 'Merging guest id % into % (name: %)', dup_id, keep_id, r.norm_name;

            -- Reassign bookings
            UPDATE bookings SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign booking_guests (avoid unique constraint violation)
            UPDATE booking_guests SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM booking_guests bg2
                WHERE bg2.booking_id = booking_guests.booking_id AND bg2.guest_id = keep_id
              );
            DELETE FROM booking_guests WHERE guest_id = dup_id;

            -- Reassign invoices
            UPDATE invoices SET bill_to_guest_id = keep_id WHERE bill_to_guest_id = dup_id;

            -- Reassign customer_ledgers
            UPDATE customer_ledgers SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign user_guests (avoid unique constraint violation)
            UPDATE user_guests SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM user_guests ug2
                WHERE ug2.user_id = user_guests.user_id AND ug2.guest_id = keep_id
              );
            DELETE FROM user_guests WHERE guest_id = dup_id;

            -- Reassign guest_complimentary_credits (avoid unique constraint violation)
            UPDATE guest_complimentary_credits SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM guest_complimentary_credits gcc2
                WHERE gcc2.guest_id = keep_id AND gcc2.room_type_id = guest_complimentary_credits.room_type_id
              );
            DELETE FROM guest_complimentary_credits WHERE guest_id = dup_id;

            -- Hard delete the duplicate guest
            DELETE FROM guests WHERE id = dup_id;

            total_removed := total_removed + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Removed % duplicate guest records', total_removed;
END $$;

-- Normalize whitespace in full_name
UPDATE guests SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name) AND deleted_at IS NULL;

-- Ensure the unique index exists to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_full_name_unique
    ON guests (LOWER(TRIM(full_name)))
    WHERE deleted_at IS NULL;

COMMIT;
