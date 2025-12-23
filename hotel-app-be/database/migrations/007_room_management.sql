-- ============================================================================
-- MIGRATION 007: ROOM MANAGEMENT
-- ============================================================================
-- Description: Room types, amenities, rooms, and room availability
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS room_types_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS amenities_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS rooms_id_seq START WITH 100;

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_types (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_types_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    base_occupancy INTEGER NOT NULL DEFAULT 2,
    max_occupancy INTEGER NOT NULL DEFAULT 4,
    base_price DECIMAL(10,2) NOT NULL,
    size_sqm DECIMAL(8,2),
    bed_type VARCHAR(50),
    view_type VARCHAR(50),
    floor_preference VARCHAR(50),
    smoking_allowed BOOLEAN DEFAULT false,
    image_urls JSONB,
    features JSONB,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
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
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_type_amenities (
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    is_standard BOOLEAN DEFAULT true,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_type_id, amenity_id)
);

-- ============================================================================
-- ROOMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT PRIMARY KEY DEFAULT nextval('rooms_id_seq'),
    room_number VARCHAR(20) UNIQUE NOT NULL,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id),
    floor INTEGER NOT NULL,
    building VARCHAR(50),

    -- Status
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved', 'cleaning')),

    -- Override room type defaults
    custom_price DECIMAL(10,2),
    is_accessible BOOLEAN DEFAULT false,

    -- Maintenance
    last_maintenance_date DATE,
    next_maintenance_date DATE,
    maintenance_notes TEXT,

    -- Status metadata (from migration 016)
    status_notes TEXT,
    reserved_start_date TIMESTAMP WITH TIME ZONE,
    reserved_end_date TIMESTAMP WITH TIME ZONE,
    maintenance_start_date TIMESTAMP WITH TIME ZONE,
    maintenance_end_date TIMESTAMP WITH TIME ZONE,
    cleaning_start_date TIMESTAMP WITH TIME ZONE,
    cleaning_end_date TIMESTAMP WITH TIME ZONE,
    target_room_id BIGINT REFERENCES rooms(id),

    -- Custom features
    special_features JSONB,
    notes TEXT,

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM AVAILABILITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'booked', 'blocked', 'maintenance')),
    price DECIMAL(10,2),
    notes TEXT,
    blocked_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, date)
);

-- ============================================================================
-- ROOM EVENTS (from migration 012)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('reserve', 'booking', 'cleaning', 'maintenance', 'inspection', 'repair', 'status_change')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    notes TEXT,
    scheduled_date DATE,
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM HISTORY (from migration 014)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    booking_id BIGINT,
    guest_id BIGINT REFERENCES guests(id),
    reward_id BIGINT REFERENCES loyalty_rewards(id),
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    target_room_id BIGINT REFERENCES rooms(id),
    changed_by BIGINT REFERENCES users(id), -- Nullable for auto-generated changes
    notes TEXT,
    is_auto_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- HOUSEKEEPING
-- ============================================================================

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    task_date DATE NOT NULL DEFAULT CURRENT_DATE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('cleaning', 'turndown', 'inspection', 'maintenance', 'deep_clean')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),

    -- Assignment
    assigned_to BIGINT REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,

    -- Completion
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,

    -- Quality
    inspection_passed BOOLEAN,
    inspected_by BIGINT REFERENCES users(id),
    inspected_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    issues_found TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- Add auto check-in/out settings (from migration 013)
CREATE TABLE IF NOT EXISTS room_checkin_settings (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    auto_checkin_enabled BOOLEAN DEFAULT false,
    checkin_time TIME DEFAULT '14:00:00',
    auto_checkout_enabled BOOLEAN DEFAULT false,
    checkout_time TIME DEFAULT '11:00:00',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO room_checkin_settings (auto_checkin_enabled, auto_checkout_enabled)
VALUES (false, false)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_room_types_active ON room_types(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_room_types_code ON room_types(code);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
CREATE INDEX IF NOT EXISTS idx_rooms_number ON rooms(room_number);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_room_availability_room_date ON room_availability(room_id, date);
CREATE INDEX IF NOT EXISTS idx_room_availability_date ON room_availability(date);
CREATE INDEX IF NOT EXISTS idx_room_events_room_id ON room_events(room_id);
CREATE INDEX IF NOT EXISTS idx_room_events_status ON room_events(status);
CREATE INDEX IF NOT EXISTS idx_room_history_room_id ON room_history(room_id);
CREATE INDEX IF NOT EXISTS idx_room_history_created_at ON room_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room ON housekeeping_tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_date ON housekeeping_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_tasks(status);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_room_types_updated_at
    BEFORE UPDATE ON room_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW available_rooms AS
SELECT
    r.id,
    r.room_number,
    rt.name as room_type_name,
    rt.code as room_type_code,
    r.floor,
    r.status,
    COALESCE(r.custom_price, rt.base_price) as current_price,
    rt.base_occupancy,
    rt.max_occupancy,
    rt.bed_type,
    rt.view_type
FROM rooms r
JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.is_active = true
  AND r.status IN ('available', 'cleaning')
  AND rt.is_active = true;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to check room availability
CREATE OR REPLACE FUNCTION is_room_available(
    p_room_id BIGINT,
    p_check_in DATE,
    p_check_out DATE
)
RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM bookings
    WHERE room_id = p_room_id
      AND status NOT IN ('cancelled', 'no_show')
      AND (
          (check_in_date <= p_check_in AND check_out_date > p_check_in) OR
          (check_in_date < p_check_out AND check_out_date >= p_check_out) OR
          (check_in_date >= p_check_in AND check_out_date <= p_check_out)
      );

    RETURN v_count = 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE room_types IS 'Room type definitions (Standard, Deluxe, Suite)';
COMMENT ON TABLE rooms IS 'Individual room inventory';
COMMENT ON TABLE room_events IS 'Room events and maintenance tracking';
COMMENT ON TABLE room_history IS 'Historical record of room status changes';
COMMENT ON TABLE housekeeping_tasks IS 'Housekeeping and cleaning tasks';
