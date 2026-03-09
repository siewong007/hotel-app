-- Fix: Auto-seed room_status_transitions if the table is empty
-- This prevents the recurring issue where the table gets emptied (e.g., by data sync)
-- and all room status changes fail with "Transition from X to Y is not defined"

CREATE OR REPLACE FUNCTION validate_room_status_transition(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_user_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN AS $$
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
        ('available', 'dirty', true), ('available', 'maintenance', true),
        ('available', 'out_of_order', true),
        ('occupied', 'available', true), ('occupied', 'dirty', true),
        ('occupied', 'maintenance', true), ('occupied', 'reserved', true),
        ('reserved', 'occupied', true), ('reserved', 'available', true),
        ('reserved', 'dirty', true), ('reserved', 'maintenance', true),
        ('dirty', 'available', true), ('dirty', 'maintenance', true),
        ('dirty', 'reserved', true), ('dirty', 'occupied', true),
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
$$ LANGUAGE plpgsql;
