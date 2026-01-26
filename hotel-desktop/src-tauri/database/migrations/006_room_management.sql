-- ============================================================================
-- MIGRATION 006: ROOM MANAGEMENT
-- ============================================================================
-- Description: Room types, rooms, amenities, housekeeping, status system
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS room_types_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS amenities_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS rooms_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_history_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS housekeeping_tasks_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS maintenance_tickets_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_changes_id_seq START WITH 1;

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_types (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_types_id_seq'),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    weekday_rate DECIMAL(10,2),
    weekend_rate DECIMAL(10,2),
    max_occupancy INTEGER DEFAULT 2,
    bed_type VARCHAR(50),
    bed_count INTEGER DEFAULT 1,
    allows_extra_bed BOOLEAN DEFAULT false,
    max_extra_beds INTEGER DEFAULT 0 CHECK (max_extra_beds >= 0),
    extra_bed_charge DECIMAL(10,2) DEFAULT 0 CHECK (extra_bed_charge >= 0),
    size_sqm DECIMAL(6,2),
    size_sqft DECIMAL(6,2),
    floor_range VARCHAR(20),
    images JSONB,
    features JSONB,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- AMENITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS amenities (
    id BIGINT PRIMARY KEY DEFAULT nextval('amenities_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL,
    icon VARCHAR(50),
    description TEXT,
    is_paid BOOLEAN DEFAULT false,
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_type_amenities (
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    is_complimentary BOOLEAN DEFAULT true,
    PRIMARY KEY (room_type_id, amenity_id)
);

-- ============================================================================
-- ROOMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT PRIMARY KEY DEFAULT nextval('rooms_id_seq'),
    room_number VARCHAR(20) UNIQUE NOT NULL,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id),
    floor INTEGER,
    building VARCHAR(50),
    custom_price DECIMAL(10,2),  -- Optional per-room price override (if NULL, uses room_type base_price)
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'dirty', 'maintenance', 'out_of_order')),
    status_notes TEXT,
    reserved_start_date TIMESTAMP WITH TIME ZONE,
    reserved_end_date TIMESTAMP WITH TIME ZONE,
    maintenance_start_date TIMESTAMP WITH TIME ZONE,
    maintenance_end_date TIMESTAMP WITH TIME ZONE,
    cleaning_start_date TIMESTAMP WITH TIME ZONE,
    cleaning_end_date TIMESTAMP WITH TIME ZONE,
    current_occupancy INTEGER DEFAULT 0,
    last_cleaned_at TIMESTAMP WITH TIME ZONE,
    last_inspected_at TIMESTAMP WITH TIME ZONE,
    inspected_by BIGINT REFERENCES users(id),
    is_smoking BOOLEAN DEFAULT false,
    is_accessible BOOLEAN DEFAULT false,
    has_view BOOLEAN DEFAULT false,
    view_type VARCHAR(50),
    connecting_room_id BIGINT REFERENCES rooms(id),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    -- Night audit tracking
    last_posted_status VARCHAR(50),
    last_posted_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_history (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_history_id_seq'),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    notes TEXT,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    changed_by BIGINT REFERENCES users(id),
    is_auto_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM STATUS TRANSITIONS (State Machine)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_transitions (
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    is_allowed BOOLEAN DEFAULT true,
    requires_permission VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (from_status, to_status)
);

-- Define allowed status transitions
INSERT INTO room_status_transitions (from_status, to_status, is_allowed, requires_permission, notes) VALUES
    ('available', 'reserved', true, NULL, 'Guest reservation created'),
    ('available', 'occupied', true, NULL, 'Guest checked in'),
    ('available', 'cleaning', true, 'housekeeping', 'Scheduled cleaning'),
    ('available', 'dirty', true, 'housekeeping', 'Room marked as dirty'),
    ('available', 'maintenance', true, 'maintenance:write', 'Maintenance required'),
    ('available', 'out_of_order', true, 'rooms:write', 'Room out of service'),
    ('reserved', 'occupied', true, NULL, 'Guest checked in'),
    ('reserved', 'available', true, NULL, 'Reservation cancelled'),
    ('reserved', 'dirty', true, 'housekeeping', 'Previous guest left early, room dirty'),
    ('occupied', 'dirty', true, NULL, 'Guest checked out, room needs cleaning'),
    ('occupied', 'cleaning', true, 'housekeeping', 'Guest checked out, cleaning started'),
    ('occupied', 'available', true, NULL, 'Express checkout, room already clean'),
    ('occupied', 'maintenance', true, 'maintenance:write', 'Issue found during stay'),
    ('dirty', 'cleaning', true, 'housekeeping', 'Cleaning started'),
    ('dirty', 'available', true, 'housekeeping', 'Quick clean completed'),
    ('dirty', 'maintenance', true, 'maintenance:write', 'Issue found during inspection'),
    ('cleaning', 'available', true, 'housekeeping', 'Cleaning completed'),
    ('cleaning', 'dirty', true, 'housekeeping', 'Cleaning failed inspection'),
    ('cleaning', 'maintenance', true, 'maintenance:write', 'Issue found during cleaning'),
    ('maintenance', 'available', true, 'maintenance:write', 'Maintenance completed'),
    ('maintenance', 'cleaning', true, 'maintenance:write', 'Maintenance done, needs cleaning'),
    ('maintenance', 'dirty', true, 'maintenance:write', 'Maintenance done, room is dirty'),
    ('maintenance', 'out_of_order', true, 'rooms:write', 'Severe issue found'),
    ('out_of_order', 'maintenance', true, 'rooms:write', 'Repairs starting'),
    ('out_of_order', 'available', true, 'rooms:write', 'Room restored to service')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ============================================================================
-- HOUSEKEEPING TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id BIGINT PRIMARY KEY DEFAULT nextval('housekeeping_tasks_id_seq'),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL DEFAULT 'cleaning',
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    assigned_to BIGINT REFERENCES users(id),
    scheduled_date DATE,
    task_date DATE DEFAULT CURRENT_DATE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    inspection_notes TEXT,
    items_used JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- MAINTENANCE TICKETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id BIGINT PRIMARY KEY DEFAULT nextval('maintenance_tickets_id_seq'),
    room_id BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'on_hold', 'resolved', 'closed')),
    assigned_to BIGINT REFERENCES users(id),
    reported_by BIGINT REFERENCES users(id),
    estimated_cost DECIMAL(10,2),
    actual_cost DECIMAL(10,2),
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    scheduled_date TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    images JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM CHANGES (revisit flow - track room changes during guest stays)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_changes (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_changes_id_seq'),
    booking_id BIGINT NOT NULL,
    from_room_id BIGINT NOT NULL REFERENCES rooms(id),
    to_room_id BIGINT NOT NULL REFERENCES rooms(id),
    guest_id BIGINT NOT NULL,
    reason TEXT,
    changed_by BIGINT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Note: Foreign keys to bookings, guests, and users are added in 008_bookings.sql after those tables exist

-- ============================================================================
-- ROOM STATUS CHANGE LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_change_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    trigger_source VARCHAR(100),
    booking_id BIGINT,
    was_blocked BOOLEAN DEFAULT false,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- FUNCTIONS: Room Status Management
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_room_status_transition(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_user_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_is_allowed BOOLEAN;
BEGIN
    SELECT status INTO v_current_status FROM rooms WHERE id = p_room_id;
    IF v_current_status IS NULL THEN RAISE EXCEPTION 'Room % not found', p_room_id; END IF;
    IF v_current_status = p_new_status THEN RETURN true; END IF;
    SELECT is_allowed INTO v_is_allowed FROM room_status_transitions
    WHERE from_status = v_current_status AND to_status = p_new_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transition from % to % is not defined', v_current_status, p_new_status; END IF;
    IF NOT v_is_allowed THEN RAISE EXCEPTION 'Transition from % to % is not allowed', v_current_status, p_new_status; END IF;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_room_status(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_notes TEXT DEFAULT NULL,
    p_user_id BIGINT DEFAULT NULL,
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_old_status VARCHAR(20);
BEGIN
    SELECT status INTO v_old_status FROM rooms WHERE id = p_room_id;
    INSERT INTO room_status_change_log (room_id, from_status, to_status, trigger_source, reason)
    VALUES (p_room_id, v_old_status, p_new_status, 'update_room_status', p_notes);
    PERFORM validate_room_status_transition(p_room_id, p_new_status, p_user_id);
    UPDATE rooms SET status = p_new_status, status_notes = COALESCE(p_notes, '') || ' [via update_room_status]',
        updated_at = CURRENT_TIMESTAMP,
        reserved_start_date = CASE WHEN p_new_status = 'reserved' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        reserved_end_date = CASE WHEN p_new_status = 'reserved' THEN p_end_date ELSE NULL END,
        maintenance_start_date = CASE WHEN p_new_status = 'maintenance' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        maintenance_end_date = CASE WHEN p_new_status = 'maintenance' THEN p_end_date ELSE NULL END,
        cleaning_start_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        cleaning_end_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN p_end_date ELSE NULL END
    WHERE id = p_room_id;
    INSERT INTO room_history (room_id, from_status, to_status, notes, start_date, end_date, changed_by, is_auto_generated)
    VALUES (p_room_id, v_old_status, p_new_status, p_notes, p_start_date, p_end_date, p_user_id, p_user_id IS NULL);
    IF p_new_status IN ('dirty', 'cleaning') THEN
        INSERT INTO housekeeping_tasks (room_id, task_type, priority, status, created_by, notes)
        VALUES (p_room_id, 'cleaning', 'normal', CASE WHEN p_new_status = 'cleaning' THEN 'in_progress' ELSE 'pending' END, p_user_id, p_notes)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS: Room Status (Views requiring bookings are in 008_bookings.sql)
-- ============================================================================

CREATE OR REPLACE VIEW room_status_summary AS
SELECT r.status, COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
    json_agg(json_build_object('id', r.id, 'room_number', r.room_number, 'floor', r.floor) ORDER BY r.room_number) as rooms
FROM rooms r WHERE r.is_active = true GROUP BY r.status;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rooms_status_active ON rooms(status, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_room_history_room ON room_history(room_id);
CREATE INDEX IF NOT EXISTS idx_room_history_created ON room_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_status_log_room_created ON room_status_change_log(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room ON housekeeping_tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_tasks(status);
CREATE INDEX IF NOT EXISTS idx_housekeeping_assigned ON housekeeping_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_housekeeping_date ON housekeeping_tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room_date_status ON housekeeping_tasks(room_id, task_date, status);
CREATE INDEX IF NOT EXISTS idx_maintenance_room ON maintenance_tickets(room_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_tickets(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_priority ON maintenance_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_maintenance_assigned ON maintenance_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_room_type_amenities_type ON room_type_amenities(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_booking ON room_changes(booking_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_from_room ON room_changes(from_room_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_to_room ON room_changes(to_room_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_guest ON room_changes(guest_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_changed_at ON room_changes(changed_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_room_types_updated_at BEFORE UPDATE ON room_types FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_housekeeping_updated_at BEFORE UPDATE ON housekeeping_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON maintenance_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE room_types IS 'Room type definitions with pricing';
COMMENT ON TABLE amenities IS 'Available amenities catalog';
COMMENT ON TABLE rooms IS 'Individual room inventory';
COMMENT ON TABLE room_history IS 'History of room status changes';
COMMENT ON TABLE room_status_transitions IS 'Defines valid room status transitions';
COMMENT ON TABLE housekeeping_tasks IS 'Housekeeping task assignments';
COMMENT ON TABLE maintenance_tickets IS 'Maintenance work orders';
COMMENT ON TABLE room_changes IS 'Tracks room changes during guest stays';
COMMENT ON COLUMN room_changes.booking_id IS 'The booking that had the room change';
COMMENT ON COLUMN room_changes.from_room_id IS 'Original room the guest was in';
COMMENT ON COLUMN room_changes.to_room_id IS 'New room the guest moved to';
COMMENT ON COLUMN room_changes.reason IS 'Reason for the room change';
COMMENT ON COLUMN room_changes.changed_by IS 'Staff member who processed the change';
COMMENT ON COLUMN room_types.allows_extra_bed IS 'Whether this room type allows extra beds';
COMMENT ON COLUMN room_types.max_extra_beds IS 'Maximum number of extra beds allowed';
COMMENT ON COLUMN room_types.extra_bed_charge IS 'Charge per extra bed per night';
