-- ============================================================================
-- MIGRATION 004: GUEST MANAGEMENT
-- ============================================================================
-- Description: Guests, documents, preferences, reviews, corporate accounts
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS guests_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_documents_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_preferences_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_notes_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_reviews_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS corporate_accounts_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS corporate_account_contacts_id_seq START WITH 1;

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN CREATE TYPE IdentificationType AS ENUM ('passport', 'drivers_license', 'national_id', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- GUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('guests_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    title VARCHAR(20),
    alt_phone VARCHAR(20),
    date_of_birth DATE,
    nationality VARCHAR(100),
    ic_number VARCHAR(50),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    id_type IdentificationType,
    id_number VARCHAR(100),
    id_expiry DATE,
    id_country VARCHAR(100),
    language_preference VARCHAR(10) DEFAULT 'en',
    communication_preference VARCHAR(50) DEFAULT 'email',
    marketing_opt_in BOOLEAN DEFAULT false,
    vip_status VARCHAR(20),
    company_name VARCHAR(255),
    job_title VARCHAR(100),
    notes TEXT,
    special_requests TEXT,
    tags TEXT[],
    total_stays INTEGER DEFAULT 0,
    total_spend DECIMAL(12,2) DEFAULT 0,
    average_rating DECIMAL(3,2),
    complimentary_nights_credit INTEGER DEFAULT 0,
    is_blacklisted BOOLEAN DEFAULT false,
    blacklist_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_email_format CHECK (email IS NULL OR email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

-- Guest complimentary credits by room type
CREATE TABLE IF NOT EXISTS guest_complimentary_credits (
    id BIGSERIAL PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    room_type_id BIGINT NOT NULL,
    nights_available INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guest_id, room_type_id)
);

-- Add foreign key for users.guest_id
ALTER TABLE users ADD CONSTRAINT fk_users_guest
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- ============================================================================
-- GUEST DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_documents (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_documents_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    file_url TEXT,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by BIGINT REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST PREFERENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_preferences (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_preferences_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, category, preference_key)
);

-- ============================================================================
-- GUEST NOTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_notes (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_notes_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    note_type VARCHAR(50) DEFAULT 'general',
    content TEXT NOT NULL,
    is_alert BOOLEAN DEFAULT false,
    is_private BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST REVIEWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_reviews (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_reviews_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    booking_id BIGINT,
    overall_rating DECIMAL(3,2) NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    cleanliness_rating DECIMAL(3,2) CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
    service_rating DECIMAL(3,2) CHECK (service_rating >= 1 AND service_rating <= 5),
    comfort_rating DECIMAL(3,2) CHECK (comfort_rating >= 1 AND comfort_rating <= 5),
    location_rating DECIMAL(3,2) CHECK (location_rating >= 1 AND location_rating <= 5),
    value_rating DECIMAL(3,2) CHECK (value_rating >= 1 AND value_rating <= 5),
    title VARCHAR(255),
    content TEXT,
    pros TEXT,
    cons TEXT,
    response TEXT,
    response_at TIMESTAMP WITH TIME ZONE,
    response_by BIGINT REFERENCES users(id),
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- CORPORATE ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(100) UNIQUE,
    tax_id VARCHAR(100),
    industry VARCHAR(100),
    billing_address TEXT,
    billing_email VARCHAR(255),
    billing_phone VARCHAR(20),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    credit_balance DECIMAL(12,2) DEFAULT 0,
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    contract_start DATE,
    contract_end DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corporate_account_contacts (
    id BIGINT PRIMARY KEY DEFAULT nextval('corporate_account_contacts_id_seq'),
    corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    role VARCHAR(100),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_full_name ON guests(full_name);
CREATE INDEX IF NOT EXISTS idx_guests_uuid ON guests(uuid);
CREATE INDEX IF NOT EXISTS idx_guests_vip ON guests(vip_status) WHERE vip_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guests_company ON guests(company_name) WHERE company_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guests_blacklist ON guests(is_blacklisted) WHERE is_blacklisted = true;
CREATE INDEX IF NOT EXISTS idx_guests_ic_number ON guests(ic_number);
CREATE INDEX IF NOT EXISTS idx_guests_created_at ON guests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_credits_guest_id ON guest_complimentary_credits(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_credits_room_type ON guest_complimentary_credits(room_type_id);
CREATE INDEX IF NOT EXISTS idx_guest_documents_guest_id ON guest_documents(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest_id ON guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_id ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_alert ON guest_notes(guest_id, is_alert) WHERE is_alert = true;
CREATE INDEX IF NOT EXISTS idx_guest_reviews_guest_id ON guest_reviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_rating ON guest_reviews(overall_rating);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_published ON guest_reviews(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_name ON corporate_accounts(name);
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_registration ON corporate_accounts(company_registration);
CREATE INDEX IF NOT EXISTS idx_corporate_account_contacts_corp ON corporate_account_contacts(corporate_account_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_guests_updated_at
    BEFORE UPDATE ON guests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guest_preferences_updated_at
    BEFORE UPDATE ON guest_preferences
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

COMMENT ON TABLE guests IS 'Guest profiles with personal information and preferences';
COMMENT ON TABLE guest_complimentary_credits IS 'Room-type specific complimentary night credits for guests';
COMMENT ON TABLE guest_documents IS 'Identity documents and files attached to guests';
COMMENT ON TABLE guest_preferences IS 'Guest preferences organized by category';
COMMENT ON TABLE guest_notes IS 'Staff notes and alerts about guests';
COMMENT ON TABLE guest_reviews IS 'Guest reviews and feedback';
COMMENT ON TABLE corporate_accounts IS 'Corporate accounts for business clients';
COMMENT ON COLUMN guests.ic_number IS 'Identity card or passport number';
COMMENT ON COLUMN guests.nationality IS 'Guest nationality/citizenship';
