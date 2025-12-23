-- ============================================================================
-- CREATE DATABASE USER
-- ============================================================================
-- This script creates the hotel_admin user for the application
-- ============================================================================

-- Create the hotel_admin user if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'hotel_admin') THEN
        CREATE USER hotel_admin WITH PASSWORD 'SecureHotelPassword2025!';
    END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hotel_management TO hotel_admin;
ALTER DATABASE hotel_management OWNER TO hotel_admin;

-- Grant schema permissions
GRANT USAGE ON SCHEMA public TO hotel_admin;
GRANT CREATE ON SCHEMA public TO hotel_admin;

-- Grant permissions on all existing tables and sequences
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hotel_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hotel_admin;

-- Grant permissions on future tables and sequences
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hotel_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hotel_admin;

\echo 'User hotel_admin created successfully with full permissions';
