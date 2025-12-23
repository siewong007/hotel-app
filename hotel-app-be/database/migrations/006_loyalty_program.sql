-- ============================================================================
-- MIGRATION 006: LOYALTY PROGRAM
-- ============================================================================
-- Description: Loyalty programs, memberships, points, and rewards
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS loyalty_programs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_memberships_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_rewards_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS reward_redemptions_id_seq START WITH 1;

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_programs (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_programs_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    tier_level INTEGER DEFAULT 1,
    points_multiplier DECIMAL(4,2) DEFAULT 1.0,
    minimum_points_required INTEGER DEFAULT 0,
    benefits JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LOYALTY MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_memberships (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_memberships_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id),
    membership_number VARCHAR(50) UNIQUE NOT NULL,
    points_balance INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    tier_level INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'expired')),
    enrolled_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE,
    last_points_activity TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, program_id)
);

-- ============================================================================
-- POINTS TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS points_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'expire', 'adjust')),
    points_amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_type VARCHAR(50),
    reference_id BIGINT,
    description TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- LOYALTY REWARDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_rewards_id_seq'),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN ('room_upgrade', 'service', 'discount', 'gift', 'dining', 'spa', 'experience')),
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    monetary_value DECIMAL(10,2),
    minimum_tier_level INTEGER DEFAULT 1 CHECK (minimum_tier_level >= 1 AND minimum_tier_level <= 4),
    is_active BOOLEAN DEFAULT true,
    stock_quantity INTEGER,
    image_url VARCHAR(500),
    terms_conditions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- REWARD REDEMPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_redemptions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    reward_id BIGINT NOT NULL REFERENCES loyalty_rewards(id),
    transaction_id UUID NOT NULL REFERENCES points_transactions(id),
    booking_id BIGINT,
    points_spent INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'redeemed', 'cancelled')),
    redeemed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_guest_id ON loyalty_memberships(guest_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_program_id ON loyalty_memberships(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_number ON loyalty_memberships(membership_number);
CREATE INDEX IF NOT EXISTS idx_points_transactions_membership_id ON points_transactions(membership_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_created_at ON points_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_category ON loyalty_rewards(category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_tier_level ON loyalty_rewards(minimum_tier_level);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_membership_id ON reward_redemptions(membership_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_reward_id ON reward_redemptions(reward_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_loyalty_programs_updated_at
    BEFORE UPDATE ON loyalty_programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loyalty_memberships_updated_at
    BEFORE UPDATE ON loyalty_memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loyalty_rewards_updated_at
    BEFORE UPDATE ON loyalty_rewards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reward_redemptions_updated_at
    BEFORE UPDATE ON reward_redemptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE loyalty_programs IS 'Loyalty program definitions';
COMMENT ON TABLE loyalty_memberships IS 'Guest enrollments in loyalty programs';
COMMENT ON TABLE points_transactions IS 'Points earning and redemption history';
COMMENT ON TABLE loyalty_rewards IS 'Rewards catalog for points redemption';
COMMENT ON TABLE reward_redemptions IS 'Reward redemption records';
