-- ============================================================================
-- USER-GUEST MANY-TO-MANY RELATIONSHIP
-- ============================================================================
-- Description: Establish many-to-many relationship between users and guests
--              - One user can manage multiple guests
--              - One guest can be associated with multiple users
--              - Guests cannot login but can be upgraded to users
-- Version: 1.0
-- Created: 2025-12-10
-- ============================================================================

-- Create junction table for user-guest relationships
CREATE TABLE IF NOT EXISTS user_guests (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'owner' CHECK (relationship_type IN ('owner', 'family', 'friend', 'assistant', 'colleague', 'other')),
    can_book_for BOOLEAN DEFAULT true, -- Can this user make bookings for this guest?
    can_view_bookings BOOLEAN DEFAULT true, -- Can this user view bookings for this guest?
    can_modify BOOLEAN DEFAULT true, -- Can this user modify guest information?
    notes TEXT, -- Optional notes about the relationship
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    linked_by BIGINT REFERENCES users(id),
    PRIMARY KEY (user_id, guest_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_guest_id ON user_guests(guest_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_relationship_type ON user_guests(relationship_type);

-- Add comment
COMMENT ON TABLE user_guests IS 'Many-to-many relationship between users and guests they can manage';

-- ============================================================================
-- HELPER FUNCTION: Automatically link guest when created by a user
-- ============================================================================
CREATE OR REPLACE FUNCTION link_guest_to_creator()
RETURNS TRIGGER AS $$
BEGIN
    -- If a guest is created by a user (created_by is not null),
    -- automatically link them with 'owner' relationship
    IF NEW.created_by IS NOT NULL THEN
        INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, linked_by)
        VALUES (NEW.created_by, NEW.id, 'owner', true, true, true, NEW.created_by)
        ON CONFLICT (user_id, guest_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link guests to their creator
DROP TRIGGER IF EXISTS trigger_link_guest_to_creator ON guests;
CREATE TRIGGER trigger_link_guest_to_creator
    AFTER INSERT ON guests
    FOR EACH ROW
    EXECUTE FUNCTION link_guest_to_creator();

-- ============================================================================
-- MIGRATION: Link existing guests to users based on email match
-- ============================================================================
-- This migration attempts to link existing guests to users who share the same email
-- This is a one-time migration to establish initial relationships
INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, linked_by)
SELECT
    u.id as user_id,
    g.id as guest_id,
    'owner' as relationship_type,
    true as can_book_for,
    true as can_view_bookings,
    true as can_modify,
    u.id as linked_by
FROM users u
INNER JOIN guests g ON LOWER(u.email) = LOWER(g.email)
WHERE g.deleted_at IS NULL
ON CONFLICT (user_id, guest_id) DO NOTHING;

-- ============================================================================
-- FUNCTION: Upgrade guest to user
-- ============================================================================
-- This function upgrades a guest to a user account when all required fields are provided
CREATE OR REPLACE FUNCTION upgrade_guest_to_user(
    p_guest_id BIGINT,
    p_username VARCHAR(100),
    p_password_hash VARCHAR(255),
    p_role VARCHAR(50) DEFAULT 'guest'
)
RETURNS BIGINT AS $$
DECLARE
    v_guest_email VARCHAR(255);
    v_guest_full_name VARCHAR(255);
    v_new_user_id BIGINT;
    v_existing_user_id BIGINT;
BEGIN
    -- Check if guest exists
    SELECT email, full_name INTO v_guest_email, v_guest_full_name
    FROM guests
    WHERE id = p_guest_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guest not found or deleted';
    END IF;

    -- Check if user with this email already exists
    SELECT id INTO v_existing_user_id
    FROM users
    WHERE LOWER(email) = LOWER(v_guest_email);

    IF FOUND THEN
        RAISE EXCEPTION 'User with email % already exists', v_guest_email;
    END IF;

    -- Create new user
    INSERT INTO users (username, email, password_hash, full_name, is_active, created_at, updated_at)
    VALUES (p_username, v_guest_email, p_password_hash, v_guest_full_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_new_user_id;

    -- Assign role
    INSERT INTO user_roles (user_id, role_name, granted_at)
    VALUES (v_new_user_id, p_role, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, role_name) DO NOTHING;

    -- Transfer all guest relationships to the new user
    -- Keep existing relationships but also link the new user as owner
    INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, linked_by)
    VALUES (v_new_user_id, p_guest_id, 'owner', true, true, true, v_new_user_id)
    ON CONFLICT (user_id, guest_id) DO NOTHING;

    -- Update guest record to mark it as upgraded
    UPDATE guests
    SET updated_at = CURRENT_TIMESTAMP,
        updated_by = v_new_user_id
    WHERE id = p_guest_id;

    RETURN v_new_user_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION upgrade_guest_to_user IS 'Upgrades a guest to a user account, preserving all relationships and bookings';

-- ============================================================================
-- VIEW: User's accessible guests
-- ============================================================================
-- This view shows all guests accessible to each user
CREATE OR REPLACE VIEW user_accessible_guests AS
SELECT
    ug.user_id,
    g.id as guest_id,
    g.uuid,
    g.full_name,
    g.email,
    g.phone,
    g.address_line1,
    g.city,
    g.state_province,
    g.postal_code,
    g.country,
    g.vip_status,
    g.guest_type,
    ug.relationship_type,
    ug.can_book_for,
    ug.can_view_bookings,
    ug.can_modify,
    g.created_at,
    g.updated_at
FROM user_guests ug
INNER JOIN guests g ON ug.guest_id = g.id
WHERE g.deleted_at IS NULL;

-- Add comment
COMMENT ON VIEW user_accessible_guests IS 'Shows all guests accessible to each user based on user_guests relationships';
