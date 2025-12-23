-- ============================================================================
-- DATABASE INITIALIZATION SCRIPT
-- ============================================================================
-- This script runs all migrations in order to set up the complete database
-- ============================================================================

\echo '========================================';
\echo 'Hotel Management System - Database Setup';
\echo '========================================';
\echo '';

\echo '[0/18] Creating database user...';
\i /docker-entrypoint-initdb.d/00_create_user.sql

\echo '[1/18] Setting up core system...';
\i /docker-entrypoint-initdb.d/migrations/001_core_system_setup.sql

\echo '[2/18] Creating authentication & authorization...';
\i /docker-entrypoint-initdb.d/migrations/002_authentication_authorization.sql

\echo '[3/18] Setting up session management...';
\i /docker-entrypoint-initdb.d/migrations/003_session_management.sql

\echo '[4/18] Creating audit logs & system settings...';
\i /docker-entrypoint-initdb.d/migrations/004_audit_and_settings.sql

\echo '[5/18] Setting up guest management...';
\i /docker-entrypoint-initdb.d/migrations/005_guest_management.sql

\echo '[6/18] Creating loyalty program...';
\i /docker-entrypoint-initdb.d/migrations/006_loyalty_program.sql

\echo '[7/18] Setting up room management...';
\i /docker-entrypoint-initdb.d/migrations/007_room_management.sql

\echo '[8/18] Creating rate & pricing system...';
\i /docker-entrypoint-initdb.d/migrations/008_rate_pricing.sql

\echo '[9/18] Setting up bookings & reservations...';
\i /docker-entrypoint-initdb.d/migrations/009_bookings_reservations.sql

\echo '[10/18] Creating payments & services...';
\i /docker-entrypoint-initdb.d/migrations/010_payments_services.sql

\echo '[11/18] Adding tourism & extra bed fields...';
\i /docker-entrypoint-initdb.d/migrations/011_add_tourism_extra_bed_fields.sql

\echo '[12/18] Adding guest IC number field...';
\i /docker-entrypoint-initdb.d/migrations/012_add_guest_ic_number.sql

\echo '[13/18] Enhanced room status system...';
\i /docker-entrypoint-initdb.d/migrations/013_enhanced_room_status_system.sql

\echo '[14/18] Fix auto revert dirty status...';
\i /docker-entrypoint-initdb.d/migrations/014_fix_auto_revert_dirty_status.sql

\echo '[15/18] Enhanced check-in fields...';
\i /docker-entrypoint-initdb.d/migrations/015_enhanced_checkin_fields.sql

\echo '[16/18] Customer ledgers...';
\i /docker-entrypoint-initdb.d/migrations/016_customer_ledgers.sql

\echo '[17/18] PAT style ledger enhancement...';
\i /docker-entrypoint-initdb.d/migrations/017_pat_style_ledger_enhancement.sql

\echo '[18/18] Automatic room occupancy...';
\i /docker-entrypoint-initdb.d/migrations/018_automatic_room_occupancy.sql

\echo '';
\echo '========================================';
\echo 'Database schema created successfully!';
\echo '========================================';
\echo '';

-- Load seed data
\echo 'Loading seed data...';
\echo '';

\echo '[1/8] System configuration...';
\i /docker-entrypoint-initdb.d/seed-data/01_system_config_seed.sql

\echo '[2/8] Creating super admin...';
\i /docker-entrypoint-initdb.d/seed-data/02_create_super_admin.sql

\echo '[3/8] Users and staff...';
\i /docker-entrypoint-initdb.d/seed-data/02_users_staff_seed.sql

\echo '[4/8] Rate plans...';
\i /docker-entrypoint-initdb.d/seed-data/07_rate_plans_seed.sql

\echo '[5/8] Room types and rooms...';
\i /docker-entrypoint-initdb.d/seed-data/06_basic_sample_data.sql

\echo '[6/8] Guests and bookings...';
\i /docker-entrypoint-initdb.d/seed-data/03_guests_bookings_seed.sql

\echo '[7/8] Payments and invoices...';
\i /docker-entrypoint-initdb.d/seed-data/04_payments_invoices_seed.sql

\echo '[8/8] Loyalty and eKYC...';
\i /docker-entrypoint-initdb.d/seed-data/05_loyalty_ekyc_seed.sql

\echo '';
\echo '========================================';
\echo 'Seed data loaded successfully!';
\echo '========================================';
\echo '';
\echo 'Database initialization complete!';
\echo '';
