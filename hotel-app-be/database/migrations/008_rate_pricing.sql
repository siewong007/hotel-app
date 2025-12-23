-- ============================================================================
-- MIGRATION 008: RATE & PRICING MANAGEMENT
-- ============================================================================
-- Description: Rate plans, room rates, and pricing strategies
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS rate_plans_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_rates_id_seq START WITH 1;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_plans (
    id BIGINT PRIMARY KEY DEFAULT nextval('rate_plans_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    plan_type VARCHAR(50) DEFAULT 'standard' CHECK (plan_type IN ('standard', 'seasonal', 'promotional', 'corporate', 'group', 'package')),

    -- Pricing adjustments
    adjustment_type VARCHAR(20) DEFAULT 'percentage' CHECK (adjustment_type IN ('percentage', 'fixed', 'override')),
    adjustment_value DECIMAL(10,2),

    -- Date range
    valid_from DATE,
    valid_to DATE,

    -- Day of week applicability
    applies_monday BOOLEAN DEFAULT true,
    applies_tuesday BOOLEAN DEFAULT true,
    applies_wednesday BOOLEAN DEFAULT true,
    applies_thursday BOOLEAN DEFAULT true,
    applies_friday BOOLEAN DEFAULT true,
    applies_saturday BOOLEAN DEFAULT true,
    applies_sunday BOOLEAN DEFAULT true,

    -- Booking constraints
    min_nights INTEGER DEFAULT 1,
    max_nights INTEGER,
    min_advance_booking INTEGER DEFAULT 0,
    max_advance_booking INTEGER,

    -- Restrictions
    blackout_dates JSONB,

    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM RATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_rates (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_rates_id_seq'),
    rate_plan_id BIGINT NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rate_plan_id, room_type_id, effective_from)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rate_plans_dates ON rate_plans(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_rate_plans_active ON rate_plans(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rate_plans_type ON rate_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_room_rates_plan ON room_rates(rate_plan_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_type ON room_rates(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_dates ON room_rates(effective_from, effective_to);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_rate_plans_updated_at
    BEFORE UPDATE ON rate_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE rate_plans IS 'Rate plan definitions for pricing strategies';
COMMENT ON TABLE room_rates IS 'Specific prices for room types under rate plans';
