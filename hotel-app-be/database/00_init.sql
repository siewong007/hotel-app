-- ============================================================================
-- DATABASE INITIALIZATION SCRIPT
-- ============================================================================
-- This script runs all migrations in order to set up the complete database
-- ============================================================================

\echo '========================================';
\echo 'Hotel Management System - Database Setup';
\echo '========================================';
\echo '';

\echo '[0/10] Creating database user...';
\i /docker-entrypoint-initdb.d/00_create_user.sql

\echo '[1/10] Setting up core extensions & functions...';
\i /docker-entrypoint-initdb.d/migrations/001_core_extensions_functions.sql

\echo '[2/10] Creating authentication & RBAC...';
\i /docker-entrypoint-initdb.d/migrations/002_authentication_rbac.sql

\echo '[3/10] Setting up system settings & audit...';
\i /docker-entrypoint-initdb.d/migrations/003_system_settings_audit.sql

\echo '[4/10] Creating guest management...';
\i /docker-entrypoint-initdb.d/migrations/004_guest_management.sql

\echo '[5/10] Setting up loyalty program...';
\i /docker-entrypoint-initdb.d/migrations/005_loyalty_program.sql

\echo '[6/10] Creating room management...';
\i /docker-entrypoint-initdb.d/migrations/006_room_management.sql

\echo '[7/10] Setting up rate & pricing...';
\i /docker-entrypoint-initdb.d/migrations/007_rate_pricing.sql

\echo '[8/10] Creating bookings & reservations...';
\i /docker-entrypoint-initdb.d/migrations/008_bookings.sql

\echo '[9/10] Setting up payments & invoices...';
\i /docker-entrypoint-initdb.d/migrations/009_payments_invoices.sql

\echo '[10/10] Creating customer ledgers (PAT system)...';
\i /docker-entrypoint-initdb.d/migrations/010_customer_ledgers.sql

\echo '';
\echo '========================================';
\echo 'Database schema created successfully!';
\echo '========================================';
\echo '';

-- Load seed data
\echo 'Loading seed data...';
\echo '';

\echo '[1/5] System configuration, roles & admin...';
\i /docker-entrypoint-initdb.d/seed-data/01_system_roles_admin.sql

\echo '[2/5] Users and staff accounts...';
\i /docker-entrypoint-initdb.d/seed-data/02_users_staff.sql

\echo '[3/5] Room types, rooms & rate plans...';
\i /docker-entrypoint-initdb.d/seed-data/03_rooms_rates.sql

\echo '[4/5] Guests, bookings & payments...';
\i /docker-entrypoint-initdb.d/seed-data/04_guests_bookings.sql

\echo '[5/5] Loyalty programs & memberships...';
\i /docker-entrypoint-initdb.d/seed-data/05_loyalty_data.sql

\echo '';
\echo '========================================';
\echo 'Seed data loaded successfully!';
\echo '========================================';
\echo '';
\echo 'Database initialization complete!';
\echo '';
