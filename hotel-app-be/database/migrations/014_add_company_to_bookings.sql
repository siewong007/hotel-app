-- Migration 014: Add companies table and link to bookings for direct billing
-- This allows linking a booking to a company for company ledger billing

-- ============================================================================
-- COMPANIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    contact_person VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    billing_address TEXT,
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    credit_limit DECIMAL(12,2),
    payment_terms_days INTEGER DEFAULT 30,
    notes TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index on company name
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_unique ON companies(LOWER(company_name));

-- Create index for active companies
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active) WHERE is_active = true;

-- ============================================================================
-- ADD COMPANY TO BOOKINGS
-- ============================================================================

-- Add company_id column to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id);

-- Add company_name for quick display (denormalized for performance)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

-- Create index for faster company-based queries
CREATE INDEX IF NOT EXISTS idx_bookings_company_id ON bookings(company_id) WHERE company_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON TABLE companies IS 'Companies for direct billing and corporate accounts';
COMMENT ON COLUMN bookings.company_id IS 'Reference to company for direct billing';
COMMENT ON COLUMN bookings.company_name IS 'Denormalized company name for display';
