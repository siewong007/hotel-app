-- ============================================================================
-- HOTEL MANAGEMENT SYSTEM - USER & CUSTOMER DATA SCHEMA
-- ============================================================================
-- Description: Guest profiles, customer data, and user preferences
-- Version: 2.0
-- Created: 2025-01-29
-- ============================================================================

-- ============================================================================
-- SEQUENCES
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS guests_id_seq START WITH 10000;
CREATE SEQUENCE IF NOT EXISTS guest_documents_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_preferences_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_notes_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_programs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_memberships_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_reviews_id_seq START WITH 1;

-- ============================================================================
-- GUEST MANAGEMENT
-- ============================================================================

-- Main guests table
CREATE TABLE IF NOT EXISTS guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('guests_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),

    -- Personal information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    title VARCHAR(20), -- Mr., Mrs., Dr., etc.
    gender VARCHAR(20),
    date_of_birth DATE,
    nationality VARCHAR(50),

    -- Contact information
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    alt_phone VARCHAR(20),
    preferred_contact_method VARCHAR(20) DEFAULT 'email' CHECK (preferred_contact_method IN ('email', 'phone', 'sms', 'whatsapp')),

    -- Address
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),

    -- Identification
    id_type VARCHAR(50), -- 'passport', 'national_id', 'drivers_license'
    id_number VARCHAR(100),
    id_issue_country VARCHAR(100),
    id_expiry_date DATE,

    -- Preferences
    language VARCHAR(10) DEFAULT 'en',
    currency VARCHAR(3) DEFAULT 'USD',
    special_requests TEXT,
    dietary_restrictions TEXT,
    accessibility_needs TEXT,

    -- Guest type
    guest_type VARCHAR(20) DEFAULT 'individual' CHECK (guest_type IN ('individual', 'corporate', 'group', 'vip')),
    company_name VARCHAR(255),
    tax_id VARCHAR(100),

    -- Status
    is_blacklisted BOOLEAN DEFAULT false,
    blacklist_reason TEXT,
    vip_status BOOLEAN DEFAULT false,
    vip_notes TEXT,

    -- Marketing
    marketing_consent BOOLEAN DEFAULT false,
    newsletter_subscribed BOOLEAN DEFAULT false,

    -- Metadata
    source VARCHAR(50), -- 'website', 'phone', 'walkin', 'booking_com', 'expedia', etc.
    referral_source VARCHAR(255),
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_email CHECK (email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

-- Guest documents (passports, IDs, etc.)
CREATE TABLE IF NOT EXISTS guest_documents (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_documents_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    issuing_country VARCHAR(100),
    issue_date DATE,
    expiry_date DATE,
    file_url TEXT, -- S3 or file system path
    is_verified BOOLEAN DEFAULT false,
    verified_by BIGINT REFERENCES users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Guest preferences (room type, floor, amenities)
CREATE TABLE IF NOT EXISTS guest_preferences (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_preferences_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    preference_category VARCHAR(50) NOT NULL, -- 'room', 'service', 'amenity'
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, preference_category, preference_key)
);

-- Guest notes (staff notes about guests)
CREATE TABLE IF NOT EXISTS guest_notes (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_notes_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    note_type VARCHAR(50) DEFAULT 'general', -- 'general', 'complaint', 'praise', 'alert'
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    is_alert BOOLEAN DEFAULT false, -- Show as alert to staff
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NOT NULL REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LOYALTY PROGRAM
-- ============================================================================

-- Loyalty programs
CREATE TABLE IF NOT EXISTS loyalty_programs (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_programs_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    tier_level INTEGER DEFAULT 1, -- Bronze=1, Silver=2, Gold=3, Platinum=4
    points_multiplier DECIMAL(4,2) DEFAULT 1.0,
    minimum_points_required INTEGER DEFAULT 0,
    benefits JSONB, -- Array of benefits
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Guest loyalty memberships
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

-- Points transactions
CREATE TABLE IF NOT EXISTS points_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'expire', 'adjust')),
    points_amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_type VARCHAR(50), -- 'booking', 'purchase', 'promotion', 'reward'
    reference_id BIGINT,
    description TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- Loyalty rewards catalog
CREATE SEQUENCE IF NOT EXISTS loyalty_rewards_id_seq START WITH 1;
CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_rewards_id_seq'),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN ('room_upgrade', 'service', 'discount', 'gift', 'dining', 'spa', 'experience')),
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    monetary_value DECIMAL(10,2),
    minimum_tier_level INTEGER DEFAULT 1 CHECK (minimum_tier_level >= 1 AND minimum_tier_level <= 4),
    is_active BOOLEAN DEFAULT true,
    stock_quantity INTEGER, -- NULL means unlimited
    image_url VARCHAR(500),
    terms_conditions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reward redemptions
CREATE SEQUENCE IF NOT EXISTS reward_redemptions_id_seq START WITH 1;
CREATE TABLE IF NOT EXISTS reward_redemptions (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_redemptions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    reward_id BIGINT NOT NULL REFERENCES loyalty_rewards(id),
    transaction_id UUID NOT NULL REFERENCES points_transactions(id),
    booking_id BIGINT, -- Can be linked to a booking if applicable
    points_spent INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'redeemed', 'cancelled')),
    redeemed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST REVIEWS & FEEDBACK
-- ============================================================================

-- Guest reviews
CREATE TABLE IF NOT EXISTS guest_reviews (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_reviews_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE SET NULL,
    booking_id BIGINT, -- Reference to booking (will add in next schema)
    overall_rating DECIMAL(2,1) CHECK (overall_rating >= 1.0 AND overall_rating <= 5.0),
    cleanliness_rating DECIMAL(2,1),
    staff_rating DECIMAL(2,1),
    facilities_rating DECIMAL(2,1),
    value_rating DECIMAL(2,1),
    location_rating DECIMAL(2,1),
    title VARCHAR(255),
    review_text TEXT,
    pros TEXT,
    cons TEXT,
    recommend BOOLEAN,
    stay_type VARCHAR(50), -- 'business', 'leisure', 'family', 'couple'
    room_stayed VARCHAR(50),
    is_verified BOOLEAN DEFAULT false, -- Verified booking
    is_published BOOLEAN DEFAULT false,
    response_text TEXT, -- Hotel response
    responded_at TIMESTAMP WITH TIME ZONE,
    responded_by BIGINT REFERENCES users(id),
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- COMPANY/CORPORATE ACCOUNTS
-- ============================================================================

-- Corporate accounts for business travelers
CREATE TABLE IF NOT EXISTS corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    company_email VARCHAR(255),
    company_phone VARCHAR(20),
    billing_address TEXT,
    tax_id VARCHAR(100),
    account_number VARCHAR(50) UNIQUE NOT NULL,
    credit_limit DECIMAL(12,2),
    payment_terms INTEGER DEFAULT 30, -- Days
    discount_percentage DECIMAL(5,2),
    primary_contact_name VARCHAR(255),
    primary_contact_email VARCHAR(255),
    primary_contact_phone VARCHAR(20),
    account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'closed')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Link guests to corporate accounts
CREATE TABLE IF NOT EXISTS guest_corporate_links (
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    employee_id VARCHAR(100),
    department VARCHAR(100),
    is_primary_contact BOOLEAN DEFAULT false,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    linked_by BIGINT REFERENCES users(id),
    PRIMARY KEY (guest_id, corporate_account_id)
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Guests indexes
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_full_name ON guests(full_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_uuid ON guests(uuid);
CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON guests(guest_type);
CREATE INDEX IF NOT EXISTS idx_guests_vip ON guests(vip_status) WHERE vip_status = true;
CREATE INDEX IF NOT EXISTS idx_guests_blacklist ON guests(is_blacklisted) WHERE is_blacklisted = true;
CREATE INDEX IF NOT EXISTS idx_guests_created_at ON guests(created_at DESC);

-- Guest documents indexes
CREATE INDEX IF NOT EXISTS idx_guest_documents_guest_id ON guest_documents(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_documents_type ON guest_documents(document_type);

-- Guest preferences indexes
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest_id ON guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_category ON guest_preferences(preference_category);

-- Guest notes indexes
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_id ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_type ON guest_notes(note_type);
CREATE INDEX IF NOT EXISTS idx_guest_notes_alert ON guest_notes(is_alert) WHERE is_alert = true;
CREATE INDEX IF NOT EXISTS idx_guest_notes_created_at ON guest_notes(created_at DESC);

-- Loyalty indexes
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

-- Reviews indexes
CREATE INDEX IF NOT EXISTS idx_guest_reviews_guest_id ON guest_reviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_booking_id ON guest_reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_published ON guest_reviews(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_guest_reviews_rating ON guest_reviews(overall_rating DESC);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_created_at ON guest_reviews(created_at DESC);

-- Corporate indexes
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_name ON corporate_accounts(company_name);
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_number ON corporate_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_guest_corporate_links_guest_id ON guest_corporate_links(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_corporate_links_corporate_id ON guest_corporate_links(corporate_account_id);

-- ============================================================================
-- FULL TEXT SEARCH INDEXES
-- ============================================================================

-- Full-text search for guests
CREATE INDEX IF NOT EXISTS idx_guests_fulltext ON guests USING gin(
    to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '') || ' ' ||
        coalesce(company_name, '')
    )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_guests_updated_at
    BEFORE UPDATE ON guests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guest_notes_updated_at
    BEFORE UPDATE ON guest_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE TRIGGER update_guest_reviews_updated_at
    BEFORE UPDATE ON guest_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_corporate_accounts_updated_at
    BEFORE UPDATE ON corporate_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Guest summary view
CREATE OR REPLACE VIEW guest_summary AS
SELECT
    g.id,
    g.uuid,
    g.full_name,
    g.email,
    g.phone,
    g.guest_type,
    g.vip_status,
    g.is_blacklisted,
    lm.membership_number,
    lp.name as loyalty_program,
    lm.points_balance,
    lm.tier_level,
    COUNT(DISTINCT gn.id) FILTER (WHERE gn.is_alert = true) as alert_count,
    g.created_at
FROM guests g
LEFT JOIN loyalty_memberships lm ON g.id = lm.guest_id AND lm.status = 'active'
LEFT JOIN loyalty_programs lp ON lm.program_id = lp.id
LEFT JOIN guest_notes gn ON g.id = gn.guest_id AND gn.is_alert = true
WHERE g.deleted_at IS NULL
GROUP BY g.id, g.uuid, g.full_name, g.email, g.phone, g.guest_type, g.vip_status,
         g.is_blacklisted, lm.membership_number, lp.name, lm.points_balance,
         lm.tier_level, g.created_at;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE guests IS 'Hotel guest profiles and customer data';
COMMENT ON TABLE guest_documents IS 'Guest identification documents';
COMMENT ON TABLE guest_preferences IS 'Guest preferences for personalized service';
COMMENT ON TABLE guest_notes IS 'Staff notes and alerts about guests';
COMMENT ON TABLE loyalty_programs IS 'Loyalty program definitions';
COMMENT ON TABLE loyalty_memberships IS 'Guest enrollments in loyalty programs';
COMMENT ON TABLE guest_reviews IS 'Guest reviews and feedback';
COMMENT ON TABLE corporate_accounts IS 'Corporate/business accounts';
