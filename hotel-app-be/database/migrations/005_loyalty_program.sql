-- ============================================================================
-- MIGRATION 005: LOYALTY PROGRAM
-- ============================================================================
-- Description: Loyalty programs, memberships, rewards, tiers
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS loyalty_programs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_tiers_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_memberships_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS points_transactions_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS reward_catalog_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS reward_redemptions_id_seq START WITH 1;

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_programs (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_programs_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    points_per_dollar DECIMAL(10,4) DEFAULT 1.0,
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LOYALTY TIERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_tiers_id_seq'),
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    min_points INTEGER NOT NULL DEFAULT 0,
    max_points INTEGER,
    benefits JSONB,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    points_multiplier DECIMAL(4,2) DEFAULT 1.0,
    color VARCHAR(7),
    icon VARCHAR(100),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (program_id, name)
);

-- ============================================================================
-- LOYALTY MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_memberships (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_memberships_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    tier_id BIGINT REFERENCES loyalty_tiers(id),
    member_number VARCHAR(50) UNIQUE NOT NULL,
    points_balance INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, program_id)
);

-- ============================================================================
-- POINTS TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS points_transactions (
    id BIGINT PRIMARY KEY DEFAULT nextval('points_transactions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'adjust', 'expire', 'transfer')),
    points INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_type VARCHAR(50),
    reference_id BIGINT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- REWARD CATALOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_catalog (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_catalog_id_seq'),
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    points_required INTEGER NOT NULL,
    quantity_available INTEGER,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_to TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    terms_conditions TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- REWARD REDEMPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_redemptions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    reward_id BIGINT NOT NULL REFERENCES reward_catalog(id),
    booking_id BIGINT,
    points_spent INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'used', 'cancelled', 'expired')),
    redemption_code VARCHAR(50) UNIQUE,
    redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_program ON loyalty_tiers(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_guest ON loyalty_memberships(guest_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_program ON loyalty_memberships(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_member_number ON loyalty_memberships(member_number);
CREATE INDEX IF NOT EXISTS idx_points_transactions_membership ON points_transactions(membership_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_type ON points_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_points_transactions_created ON points_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_program ON reward_catalog(program_id);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_category ON reward_catalog(category);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_active ON reward_catalog(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_membership ON reward_redemptions(membership_id);
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

CREATE TRIGGER update_reward_catalog_updated_at
    BEFORE UPDATE ON reward_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE loyalty_programs IS 'Loyalty program definitions';
COMMENT ON TABLE loyalty_tiers IS 'Tier levels within loyalty programs';
COMMENT ON TABLE loyalty_memberships IS 'Guest memberships in loyalty programs';
COMMENT ON TABLE points_transactions IS 'Points earning and redemption history';
COMMENT ON TABLE reward_catalog IS 'Available rewards for redemption';
COMMENT ON TABLE reward_redemptions IS 'Reward redemption records';
