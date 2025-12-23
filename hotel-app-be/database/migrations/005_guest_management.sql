-- ============================================================================
-- MIGRATION 005: GUEST MANAGEMENT
-- ============================================================================
-- Description: Guest profiles, documents, preferences, and notes
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS guests_id_seq START WITH 10000;
CREATE SEQUENCE IF NOT EXISTS guest_documents_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_preferences_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_notes_id_seq START WITH 1;

-- ============================================================================
-- GUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('guests_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),

    -- Personal information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    title VARCHAR(20),
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
    id_type VARCHAR(50),
    id_number VARCHAR(100),
    id_issue_country VARCHAR(100),
    id_expiry_date DATE,

    -- eKYC fields
    ekyc_status VARCHAR(20) DEFAULT 'pending' CHECK (ekyc_status IN ('pending', 'approved', 'rejected')),
    ekyc_verified_at TIMESTAMP WITH TIME ZONE,
    ekyc_verified_by BIGINT REFERENCES users(id),
    ekyc_document_front_url TEXT,
    ekyc_document_back_url TEXT,
    ekyc_selfie_url TEXT,
    ekyc_notes TEXT,

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
    is_active BOOLEAN DEFAULT true,
    is_blacklisted BOOLEAN DEFAULT false,
    blacklist_reason TEXT,
    vip_status BOOLEAN DEFAULT false,
    vip_notes TEXT,

    -- Marketing
    marketing_consent BOOLEAN DEFAULT false,
    newsletter_subscribed BOOLEAN DEFAULT false,

    -- Metadata
    source VARCHAR(50),
    referral_source VARCHAR(255),
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_email CHECK (email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

-- Add foreign key constraint from users to guests
ALTER TABLE users ADD CONSTRAINT fk_users_guest_id
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- Many-to-many relationship between users and guests
CREATE TABLE IF NOT EXISTS user_guests (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    relationship VARCHAR(50) DEFAULT 'self',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, guest_id)
);

-- ============================================================================
-- GUEST DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_documents (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_documents_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    issuing_country VARCHAR(100),
    issue_date DATE,
    expiry_date DATE,
    file_url TEXT,
    is_verified BOOLEAN DEFAULT false,
    verified_by BIGINT REFERENCES users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST PREFERENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_preferences (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_preferences_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    preference_category VARCHAR(50) NOT NULL,
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, preference_category, preference_key)
);

-- ============================================================================
-- GUEST NOTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_notes (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_notes_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    note_type VARCHAR(50) DEFAULT 'general',
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    is_alert BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NOT NULL REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST REVIEWS
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS guest_reviews_id_seq START WITH 1;

CREATE TABLE IF NOT EXISTS guest_reviews (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_reviews_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE SET NULL,
    booking_id BIGINT,
    room_type VARCHAR(50) NOT NULL,
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
    stay_type VARCHAR(50),
    is_verified BOOLEAN DEFAULT false,
    is_published BOOLEAN DEFAULT false,
    response_text TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    responded_by BIGINT REFERENCES users(id),
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- CORPORATE ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    company_email VARCHAR(255),
    company_phone VARCHAR(20),
    billing_address TEXT,
    tax_id VARCHAR(100),
    account_number VARCHAR(50) UNIQUE NOT NULL,
    credit_limit DECIMAL(12,2),
    payment_terms INTEGER DEFAULT 30,
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
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_full_name ON guests(full_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_uuid ON guests(uuid);
CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON guests(guest_type);
CREATE INDEX IF NOT EXISTS idx_guests_vip ON guests(vip_status) WHERE vip_status = true;
CREATE INDEX IF NOT EXISTS idx_guests_ekyc_status ON guests(ekyc_status);
CREATE INDEX IF NOT EXISTS idx_guest_documents_guest_id ON guest_documents(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest_id ON guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_id ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_alert ON guest_notes(is_alert) WHERE is_alert = true;
CREATE INDEX IF NOT EXISTS idx_guest_reviews_guest_id ON guest_reviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_room_type ON guest_reviews(room_type);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_published ON guest_reviews(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_guest_id ON user_guests(guest_id);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_guests_fulltext ON guests USING gin(
    to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '')
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

CREATE TRIGGER update_guest_reviews_updated_at
    BEFORE UPDATE ON guest_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_corporate_accounts_updated_at
    BEFORE UPDATE ON corporate_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE guests IS 'Hotel guest profiles and customer data';
COMMENT ON TABLE guest_documents IS 'Guest identification documents';
COMMENT ON TABLE guest_reviews IS 'Guest reviews and feedback by room type';
COMMENT ON COLUMN guests.ekyc_status IS 'Electronic KYC verification status';
