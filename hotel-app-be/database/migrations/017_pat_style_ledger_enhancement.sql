-- Migration: PAT-Style Ledger Enhancement
-- Description: Add Property Accounting Transaction (PAT) style fields to customer ledgers

-- Add PAT-style fields to customer_ledgers table
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS folio_number VARCHAR(50);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS folio_type VARCHAR(50) DEFAULT 'city_ledger';
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(20) DEFAULT 'debit';
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS post_type VARCHAR(50);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS department_code VARCHAR(20);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS transaction_code VARCHAR(20);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS room_number VARCHAR(20);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS posting_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS transaction_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS cashier_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN DEFAULT FALSE;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS original_transaction_id BIGINT REFERENCES customer_ledgers(id) ON DELETE SET NULL;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10, 2) DEFAULT 0.00;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS service_charge DECIMAL(10, 2) DEFAULT 0.00;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS net_amount DECIMAL(10, 2);
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS is_posted BOOLEAN DEFAULT TRUE;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS void_at TIMESTAMP;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS void_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE customer_ledgers ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Add constraints for new fields
ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_folio_type;
ALTER TABLE customer_ledgers ADD CONSTRAINT valid_folio_type
    CHECK (folio_type IN ('guest_folio', 'master_folio', 'city_ledger', 'group_folio', 'ar_ledger'));

ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_transaction_type;
ALTER TABLE customer_ledgers ADD CONSTRAINT valid_transaction_type
    CHECK (transaction_type IN ('debit', 'credit'));

ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_post_type;
ALTER TABLE customer_ledgers ADD CONSTRAINT valid_post_type
    CHECK (post_type IS NULL OR post_type IN (
        'room_charge', 'room_tax', 'service_charge', 'tourism_tax',
        'fnb_restaurant', 'fnb_room_service', 'fnb_minibar', 'fnb_banquet',
        'laundry', 'telephone', 'internet', 'parking', 'spa', 'gym',
        'transportation', 'miscellaneous', 'advance_deposit', 'payment',
        'adjustment', 'rebate', 'discount', 'commission', 'refund',
        'transfer_in', 'transfer_out', 'city_ledger_transfer'
    ));

-- Create indexes for PAT fields
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_number ON customer_ledgers(folio_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_type ON customer_ledgers(folio_type);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_room_number ON customer_ledgers(room_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_posting_date ON customer_ledgers(posting_date);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_transaction_code ON customer_ledgers(transaction_code);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_department_code ON customer_ledgers(department_code);

-- Auto-generate folio number if not provided
CREATE OR REPLACE FUNCTION generate_folio_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.folio_number IS NULL THEN
        NEW.folio_number := CASE NEW.folio_type
            WHEN 'guest_folio' THEN 'GF-'
            WHEN 'master_folio' THEN 'MF-'
            WHEN 'city_ledger' THEN 'CL-'
            WHEN 'group_folio' THEN 'GP-'
            WHEN 'ar_ledger' THEN 'AR-'
            ELSE 'TX-'
        END || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;

    -- Calculate net_amount if not set
    IF NEW.net_amount IS NULL THEN
        NEW.net_amount := NEW.amount - COALESCE(NEW.tax_amount, 0) - COALESCE(NEW.service_charge, 0);
    END IF;

    -- Set posted_at timestamp
    IF NEW.is_posted = TRUE AND NEW.posted_at IS NULL THEN
        NEW.posted_at := CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_folio_number ON customer_ledgers;
CREATE TRIGGER trigger_generate_folio_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW
    EXECUTE FUNCTION generate_folio_number();

-- Create PAT transaction codes reference table
CREATE TABLE IF NOT EXISTS pat_transaction_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    post_type VARCHAR(50) NOT NULL,
    department_code VARCHAR(20),
    default_amount DECIMAL(10, 2),
    is_taxable BOOLEAN DEFAULT TRUE,
    is_service_chargeable BOOLEAN DEFAULT TRUE,
    gl_account_code VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default PAT transaction codes
INSERT INTO pat_transaction_codes (code, name, post_type, department_code, is_taxable, is_service_chargeable, sort_order) VALUES
    -- Room charges
    ('RM01', 'Room Charge', 'room_charge', 'FO', TRUE, TRUE, 1),
    ('RM02', 'Extra Bed Charge', 'room_charge', 'FO', TRUE, TRUE, 2),
    ('RM03', 'Early Check-in', 'room_charge', 'FO', TRUE, TRUE, 3),
    ('RM04', 'Late Check-out', 'room_charge', 'FO', TRUE, TRUE, 4),
    ('RM05', 'Room Upgrade', 'room_charge', 'FO', TRUE, TRUE, 5),

    -- Taxes
    ('TX01', 'Room Tax (6%)', 'room_tax', 'FO', FALSE, FALSE, 10),
    ('TX02', 'Service Charge (10%)', 'service_charge', 'FO', FALSE, FALSE, 11),
    ('TX03', 'Tourism Tax', 'tourism_tax', 'FO', FALSE, FALSE, 12),

    -- F&B
    ('FB01', 'Restaurant', 'fnb_restaurant', 'FB', TRUE, TRUE, 20),
    ('FB02', 'Room Service', 'fnb_room_service', 'FB', TRUE, TRUE, 21),
    ('FB03', 'Minibar', 'fnb_minibar', 'FB', TRUE, TRUE, 22),
    ('FB04', 'Banquet/Events', 'fnb_banquet', 'FB', TRUE, TRUE, 23),

    -- Other services
    ('SV01', 'Laundry', 'laundry', 'HK', TRUE, TRUE, 30),
    ('SV02', 'Telephone', 'telephone', 'FO', TRUE, FALSE, 31),
    ('SV03', 'Internet/WiFi', 'internet', 'FO', TRUE, FALSE, 32),
    ('SV04', 'Parking', 'parking', 'FO', TRUE, FALSE, 33),
    ('SV05', 'Spa Services', 'spa', 'SPA', TRUE, TRUE, 34),
    ('SV06', 'Gym/Fitness', 'gym', 'REC', TRUE, TRUE, 35),
    ('SV07', 'Transportation', 'transportation', 'FO', TRUE, FALSE, 36),
    ('SV08', 'Miscellaneous', 'miscellaneous', 'FO', TRUE, TRUE, 37),

    -- Payments & Credits
    ('PY01', 'Cash Payment', 'payment', 'FO', FALSE, FALSE, 50),
    ('PY02', 'Credit Card Payment', 'payment', 'FO', FALSE, FALSE, 51),
    ('PY03', 'Bank Transfer', 'payment', 'FO', FALSE, FALSE, 52),
    ('PY04', 'DuitNow Payment', 'payment', 'FO', FALSE, FALSE, 53),
    ('PY05', 'Cheque Payment', 'payment', 'FO', FALSE, FALSE, 54),
    ('PY06', 'Advance Deposit', 'advance_deposit', 'FO', FALSE, FALSE, 55),

    -- Adjustments
    ('AD01', 'Adjustment - Debit', 'adjustment', 'FO', FALSE, FALSE, 60),
    ('AD02', 'Adjustment - Credit', 'adjustment', 'FO', FALSE, FALSE, 61),
    ('AD03', 'Rebate', 'rebate', 'FO', FALSE, FALSE, 62),
    ('AD04', 'Discount', 'discount', 'FO', FALSE, FALSE, 63),
    ('AD05', 'Refund', 'refund', 'FO', FALSE, FALSE, 64),
    ('AD06', 'Commission', 'commission', 'FO', FALSE, FALSE, 65),

    -- Transfers
    ('TR01', 'Transfer to City Ledger', 'city_ledger_transfer', 'FO', FALSE, FALSE, 70),
    ('TR02', 'Transfer In', 'transfer_in', 'FO', FALSE, FALSE, 71),
    ('TR03', 'Transfer Out', 'transfer_out', 'FO', FALSE, FALSE, 72)
ON CONFLICT (code) DO NOTHING;

-- Create department codes reference table
CREATE TABLE IF NOT EXISTS pat_department_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default department codes
INSERT INTO pat_department_codes (code, name, description, sort_order) VALUES
    ('FO', 'Front Office', 'Front desk and reception operations', 1),
    ('FB', 'Food & Beverage', 'Restaurant, room service, and catering', 2),
    ('HK', 'Housekeeping', 'Laundry and room cleaning services', 3),
    ('SPA', 'Spa & Wellness', 'Spa and massage services', 4),
    ('REC', 'Recreation', 'Gym, pool, and recreation facilities', 5),
    ('ACC', 'Accounting', 'Finance and accounting department', 6),
    ('ADM', 'Administration', 'General administration', 7)
ON CONFLICT (code) DO NOTHING;

-- Add indexes for reference tables
CREATE INDEX IF NOT EXISTS idx_pat_transaction_codes_post_type ON pat_transaction_codes(post_type);
CREATE INDEX IF NOT EXISTS idx_pat_transaction_codes_department ON pat_transaction_codes(department_code);

-- Comments
COMMENT ON COLUMN customer_ledgers.folio_number IS 'PAT folio number (auto-generated based on folio_type)';
COMMENT ON COLUMN customer_ledgers.folio_type IS 'Type: guest_folio, master_folio, city_ledger, group_folio, ar_ledger';
COMMENT ON COLUMN customer_ledgers.transaction_type IS 'Debit or Credit transaction';
COMMENT ON COLUMN customer_ledgers.post_type IS 'Category of posting: room_charge, fnb, payment, adjustment, etc.';
COMMENT ON COLUMN customer_ledgers.department_code IS 'Department that originated the charge';
COMMENT ON COLUMN customer_ledgers.transaction_code IS 'Specific transaction code from pat_transaction_codes';
COMMENT ON COLUMN customer_ledgers.room_number IS 'Associated room number for room charges';
COMMENT ON COLUMN customer_ledgers.posting_date IS 'Date when transaction was posted';
COMMENT ON COLUMN customer_ledgers.transaction_date IS 'Date when transaction actually occurred';
COMMENT ON COLUMN customer_ledgers.is_reversal IS 'True if this is a reversal/correction of another transaction';
COMMENT ON COLUMN customer_ledgers.original_transaction_id IS 'Reference to original transaction if this is a reversal';
COMMENT ON TABLE pat_transaction_codes IS 'Reference table for PAT transaction codes';
COMMENT ON TABLE pat_department_codes IS 'Reference table for department codes';
