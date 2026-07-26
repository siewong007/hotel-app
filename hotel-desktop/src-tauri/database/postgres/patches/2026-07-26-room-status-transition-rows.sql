-- Patch: room-status transition matrix rows + refreshed auto-seed (PostgreSQL)
-- Date: 2026-07-26
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/migrations/0001_v1_baseline.sql, whose
-- validate_room_status_transition() auto-seed now includes two transitions
-- the manual room-status handler (services/rooms.rs::update_room_status_handler)
-- produces via its own auto-refinements:
--   occupied       -> reserved_dirty  (staff marks a checked-out room dirty
--                                      while a future reservation exists)
--   reserved_dirty -> available       (housekeeping clears a room whose
--                                      reservation no longer exists)
-- The handler now enforces validate_room_status_transition() on every manual
-- update; without these rows those two working flows would start failing
-- with "Transition ... is not defined".
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-26-room-status-transition-rows.sql

-- 1) Refresh the function so its empty-table auto-seed matches the baseline.
CREATE OR REPLACE FUNCTION public.validate_room_status_transition(p_room_id bigint, p_new_status character varying, p_user_id bigint DEFAULT NULL::bigint) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_is_allowed BOOLEAN;
    v_count INT;
BEGIN
    SELECT status INTO v_current_status FROM rooms WHERE id = p_room_id;
    IF v_current_status IS NULL THEN RAISE EXCEPTION 'Room % not found', p_room_id; END IF;
    IF v_current_status = p_new_status THEN RETURN true; END IF;

    -- Auto-seed transitions if table is empty
    SELECT COUNT(*) INTO v_count FROM room_status_transitions;
    IF v_count = 0 THEN
        INSERT INTO room_status_transitions (from_status, to_status, is_allowed) VALUES
        ('available', 'occupied', true), ('available', 'reserved', true),
        ('available', 'reserved_dirty', true),
        ('available', 'dirty', true), ('available', 'maintenance', true),
        ('available', 'out_of_order', true),
        ('occupied', 'available', true), ('occupied', 'dirty', true),
        ('occupied', 'maintenance', true), ('occupied', 'reserved', true),
        ('occupied', 'reserved_dirty', true),
        ('reserved', 'occupied', true), ('reserved', 'available', true),
        ('reserved', 'dirty', true), ('reserved', 'reserved_dirty', true),
        ('reserved', 'maintenance', true),
        ('dirty', 'available', true), ('dirty', 'maintenance', true),
        ('dirty', 'reserved', true), ('dirty', 'reserved_dirty', true),
        ('dirty', 'occupied', true),
        ('cleaning', 'available', true), ('cleaning', 'dirty', true),
        ('cleaning', 'reserved_dirty', true), ('cleaning', 'maintenance', true),
        ('reserved_dirty', 'reserved', true), ('reserved_dirty', 'dirty', true),
        ('reserved_dirty', 'maintenance', true),
        ('reserved_dirty', 'available', true),
        ('maintenance', 'available', true), ('maintenance', 'dirty', true),
        ('maintenance', 'out_of_order', true),
        ('out_of_order', 'available', true), ('out_of_order', 'maintenance', true),
        ('out_of_order', 'dirty', true)
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT is_allowed INTO v_is_allowed FROM room_status_transitions
    WHERE from_status = v_current_status AND to_status = p_new_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transition from % to % is not defined', v_current_status, p_new_status; END IF;
    IF NOT v_is_allowed THEN RAISE EXCEPTION 'Transition from % to % is not allowed', v_current_status, p_new_status; END IF;
    RETURN true;
END;
$$;

-- 2) Add the two rows to an already-populated matrix. A still-empty matrix is
--    deliberately left empty so the refreshed auto-seed above fires complete
--    on first validation (inserting here would suppress it forever).
INSERT INTO room_status_transitions (from_status, to_status, is_allowed)
SELECT v.from_status, v.to_status, true
FROM (VALUES
    ('occupied', 'reserved_dirty'),
    ('reserved_dirty', 'available')
) AS v(from_status, to_status)
WHERE EXISTS (SELECT 1 FROM room_status_transitions)
ON CONFLICT (from_status, to_status) DO NOTHING;
