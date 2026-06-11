-- ============================================================================
-- MIGRATION 027: ENFORCE BOOKING TOURISM TAX
-- ============================================================================
-- Description:
--   Keep bookings.is_tourist and bookings.tourism_tax_amount derived from the
--   guest tourism type, booking dates, and hotel tourism tax setting. This
--   prevents stale or client-supplied values from undercharging extended stays.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_booking_tourism_tax()
RETURNS TRIGGER AS $$
DECLARE
    v_is_tourist BOOLEAN := false;
    v_tourism_tax_rate NUMERIC := 10;
    v_billable_nights INTEGER := 1;
BEGIN
    SELECT COALESCE(
        (
            SELECT CASE
                WHEN trim(value) ~ '^[0-9]+(\.[0-9]+)?$' AND trim(value)::numeric > 0
                    THEN trim(value)::numeric
                ELSE NULL
            END
            FROM system_settings
            WHERE key = 'tourism_tax_rate'
            LIMIT 1
        ),
        10
    )
    INTO v_tourism_tax_rate;

    SELECT COALESCE(g.tourism_type::text = 'foreign', false)
    INTO v_is_tourist
    FROM guests g
    WHERE g.id = NEW.guest_id;

    v_billable_nights := GREATEST((NEW.check_out_date - NEW.check_in_date), 1);

    NEW.is_tourist := COALESCE(v_is_tourist, false);
    NEW.tourism_tax_amount := CASE
        WHEN NEW.is_tourist THEN v_tourism_tax_rate * v_billable_nights
        ELSE 0
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_booking_tourism_tax ON bookings;

CREATE TRIGGER trg_enforce_booking_tourism_tax
    BEFORE INSERT OR UPDATE OF guest_id, check_in_date, check_out_date, is_tourist, tourism_tax_amount
    ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION enforce_booking_tourism_tax();

COMMENT ON COLUMN bookings.is_tourist IS
    'Derived from guests.tourism_type. Foreign guests are charged tourism tax.';
COMMENT ON COLUMN bookings.tourism_tax_amount IS
    'Total tourism tax for the booking, derived from configured per-night rate times billable nights for foreign guests.';

WITH tourism_setting AS (
    SELECT COALESCE(
        (
            SELECT CASE
                WHEN trim(value) ~ '^[0-9]+(\.[0-9]+)?$' AND trim(value)::numeric > 0
                    THEN trim(value)::numeric
                ELSE NULL
            END
            FROM system_settings
            WHERE key = 'tourism_tax_rate'
            LIMIT 1
        ),
        10
    ) AS rate
)
UPDATE bookings b
SET
    is_tourist = (g.tourism_type::text = 'foreign'),
    tourism_tax_amount = CASE
        WHEN g.tourism_type::text = 'foreign'
            THEN s.rate * GREATEST((b.check_out_date - b.check_in_date), 1)
        ELSE 0
    END
FROM guests g
CROSS JOIN tourism_setting s
WHERE b.guest_id = g.id
  AND (
      COALESCE(b.is_tourist, false) IS DISTINCT FROM (g.tourism_type::text = 'foreign')
      OR COALESCE(b.tourism_tax_amount, 0) IS DISTINCT FROM CASE
          WHEN g.tourism_type::text = 'foreign'
              THEN s.rate * GREATEST((b.check_out_date - b.check_in_date), 1)
          ELSE 0
      END
  );
