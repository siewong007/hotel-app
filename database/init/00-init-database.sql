-- ============================================================================
-- HOTEL MANAGEMENT SYSTEM - DATABASE INITIALIZATION
-- ============================================================================
-- This script initializes the complete database schema and seed data
-- Execute this file to set up a fresh database instance
--
-- Order of execution:
-- 1. System configuration (users, roles, permissions, settings)
-- 2. User data (guests, loyalty programs, reviews, corporate accounts)
-- 3. Booking data (rooms, bookings, payments, services)
-- 4. Seed data for each module
-- ============================================================================

\echo '============================================================================'
\echo 'HOTEL MANAGEMENT SYSTEM - DATABASE INITIALIZATION'
\echo '============================================================================'
\echo ''

-- ============================================================================
-- SCHEMA CREATION
-- ============================================================================

\echo '>>> Step 1/6: Creating system configuration schema...'
\i /docker-entrypoint-initdb.d/schema/01_system_config.sql
\echo '>>> System configuration schema created successfully!'
\echo ''

\echo '>>> Step 2/6: Creating user data schema...'
\i /docker-entrypoint-initdb.d/schema/02_user_data.sql
\echo '>>> User data schema created successfully!'
\echo ''

\echo '>>> Step 3/6: Creating booking data schema...'
\i /docker-entrypoint-initdb.d/schema/03_booking_data.sql
\echo '>>> Booking data schema created successfully!'
\echo ''

-- ============================================================================
-- SEED DATA LOADING
-- ============================================================================

\echo '>>> Step 4/6: Loading system configuration seed data...'
\i /docker-entrypoint-initdb.d/seed-data/01_system_config_seed.sql
\echo '>>> System configuration seed data loaded successfully!'
\echo ''

\echo '>>> Step 5/6: Loading user data seed data...'
\i /docker-entrypoint-initdb.d/seed-data/02_user_data_seed.sql
\echo '>>> User data seed data loaded successfully!'
\echo ''

\echo '>>> Step 6/6: Loading booking data seed data...'
\i /docker-entrypoint-initdb.d/seed-data/03_booking_data_seed.sql
\echo '>>> Booking data seed data loaded successfully!'
\echo ''

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo '============================================================================'
\echo 'DATABASE INITIALIZATION COMPLETE!'
\echo '============================================================================'
\echo ''
\echo 'Database Statistics:'
\echo '--------------------'

SELECT 'Users: ' || COUNT(*)::TEXT FROM users;
SELECT 'Roles: ' || COUNT(*)::TEXT FROM roles;
SELECT 'Permissions: ' || COUNT(*)::TEXT FROM permissions;
SELECT 'Guests: ' || COUNT(*)::TEXT FROM guests;
SELECT 'Loyalty Programs: ' || COUNT(*)::TEXT FROM loyalty_programs;
SELECT 'Room Types: ' || COUNT(*)::TEXT FROM room_types;
SELECT 'Rooms: ' || COUNT(*)::TEXT FROM rooms;
SELECT 'Amenities: ' || COUNT(*)::TEXT FROM amenities;
SELECT 'Rate Plans: ' || COUNT(*)::TEXT FROM rate_plans;
SELECT 'Services: ' || COUNT(*)::TEXT FROM services;
SELECT 'Bookings: ' || COUNT(*)::TEXT FROM bookings;
SELECT 'Corporate Accounts: ' || COUNT(*)::TEXT FROM corporate_accounts;

\echo ''
\echo 'Default Admin Credentials:'
\echo '--------------------------'
\echo 'Username: admin'
\echo 'Email: admin@hotel.com'
\echo 'Password: Admin@123'
\echo ''
\echo '⚠️  IMPORTANT: Change the admin password immediately after first login!'
\echo ''
\echo '============================================================================'
