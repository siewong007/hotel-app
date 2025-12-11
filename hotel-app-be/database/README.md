# Hotel Management System - Database Documentation

## Overview

The database schema is organized into three logical modules for better maintainability and separation of concerns:

1. **System Configuration** - Authentication, authorization, and system settings
2. **User Data** - Guest profiles, loyalty programs, and customer data
3. **Booking Data** - Rooms, reservations, payments, and services

## Directory Structure

```
database/
├── init-database.sql          # Main initialization script (executes all schemas and seed data)
├── schema/                    # Database schema files
│   ├── 01_system_config.sql  # System configuration schema
│   ├── 02_user_data.sql      # User and guest data schema
│   └── 03_booking_data.sql   # Booking and reservation schema
├── seed-data/                 # Seed data files
│   ├── 01_system_config_seed.sql  # Initial roles, permissions, admin user
│   ├── 02_user_data_seed.sql      # Sample guests, loyalty programs
│   └── 03_booking_data_seed.sql   # Sample rooms, bookings, services
└── archive/                   # Archived old schema files
    ├── init.sql.backup
    └── seed.sql.backup
```

## Schema Modules

### 1. System Configuration (01_system_config.sql)

**Purpose:** Core authentication, authorization, and system settings

**Tables:**
- `users` - User accounts with enhanced security tracking
- `roles` - Role definitions for RBAC
- `permissions` - Granular permissions
- `role_permissions` - Role-permission mapping
- `user_roles` - User-role assignment
- `refresh_tokens` - JWT refresh token storage
- `passkeys` - WebAuthn passkey credentials
- `passkey_challenges` - Temporary challenge storage
- `user_sessions` - Active session tracking
- `audit_logs` - Complete audit trail
- `system_settings` - Key-value configuration store
- `email_templates` - Email template management

**Features:**
- WebAuthn passwordless authentication support
- Failed login attempt tracking and account locking
- Comprehensive audit logging
- Session management with expiration
- Soft delete support for users
- Full-text search capabilities

**Seed Data:**
- 7 default roles (super_admin, admin, manager, front_desk, housekeeping, accountant, guest)
- 40+ granular permissions
- Default admin user (username: `admin`, password: `Admin@123`)
- System settings (hotel info, booking rules, payment config)
- Email templates (booking confirmation, check-in reminder, etc.)

### 2. User Data (02_user_data.sql)

**Purpose:** Guest profiles, customer relationships, and loyalty management

**Tables:**
- `guests` - Complete guest profiles with personal and contact information
- `guest_documents` - Identity document storage
- `guest_preferences` - Personalized preferences
- `guest_notes` - Staff notes and alerts
- `loyalty_programs` - Loyalty program definitions (Bronze, Silver, Gold, Platinum)
- `loyalty_memberships` - Guest loyalty enrollments
- `points_transactions` - Loyalty points tracking
- `guest_reviews` - Guest feedback and ratings
- `corporate_accounts` - Business account management
- `guest_corporate_links` - Employee-company relationships

**Features:**
- VIP and blacklist management
- Multi-tier loyalty programs with points
- Corporate account support with credit limits
- Guest review system with ratings
- Full-text search on guest data
- Marketing consent tracking

**Seed Data:**
- 4 loyalty programs (Bronze, Silver, Gold, Platinum)
- 8 sample guests with diverse profiles
- Guest preferences and notes
- 3 corporate accounts
- Sample guest reviews

### 3. Booking Data (03_booking_data.sql)

**Purpose:** Rooms, reservations, payments, and operational data

**Tables:**
- `room_types` - Room type definitions (Standard, Deluxe, Suite, etc.)
- `amenities` - Amenity catalog
- `room_type_amenities` - Room type amenity mapping
- `rooms` - Individual room inventory (80+ rooms across 8 floors)
- `room_availability` - Daily availability calendar
- `rate_plans` - Pricing strategies (standard, seasonal, promotional, corporate)
- `room_rates` - Specific pricing under rate plans
- `bookings` - Reservations with complete lifecycle tracking
- `booking_guests` - Additional guests in bookings
- `booking_modifications` - Change history
- `services` - Service catalog (room service, spa, transport, etc.)
- `booking_services` - Services ordered by guests
- `payments` - Payment processing and tracking
- `invoices` - Billing and invoicing
- `housekeeping_tasks` - Cleaning and maintenance tracking

**Features:**
- Dynamic pricing with rate plans
- Comprehensive booking lifecycle (pending → confirmed → checked_in → checked_out → completed)
- Multi-currency support
- Room availability checking function
- Housekeeping workflow management
- Additional services billing
- Corporate and OTA booking support
- Multiple payment method tracking

**Seed Data:**
- 6 room types
- 25+ amenities
- 80+ rooms (100-series to 800-series)
- 6 rate plans
- 18+ services (room service, spa, transport, etc.)
- 3 sample bookings (confirmed, checked-in, future)

## Database Initialization

### Fresh Install

When Docker Compose starts for the first time, it will automatically:

1. Execute `init-database.sql` which orchestrates the complete setup
2. Create all schema tables in order (system → user → booking)
3. Load seed data for each module
4. Display verification statistics

### Manual Execution

If you need to reinitialize the database manually:

```bash
# Connect to database container
docker-compose exec postgres psql -U hotel_admin -d hotel_management

# Run initialization
\i /docker-entrypoint-initdb.d/00-init-database.sql
```

### Database Reset

To completely reset the database:

```bash
# Stop and remove volumes
make down-volumes

# Restart with fresh database
make up
```

## Default Credentials

After initialization, the following admin account is available:

- **Username:** `admin`
- **Email:** `admin@hotel.com`
- **Password:** `Admin@123`

⚠️ **IMPORTANT:** Change this password immediately after first login!

## Key Features

### Security
- Password hashing with bcrypt
- Failed login tracking (locks after 5 attempts for 30 minutes)
- WebAuthn/passkey support
- JWT refresh tokens with expiration
- Comprehensive audit logging
- IP address tracking

### Performance
- Strategic indexes on all foreign keys
- Full-text search indexes
- Partial indexes for filtered queries
- Generated columns for computed values
- JSONB for flexible data storage

### Data Integrity
- Foreign key constraints with CASCADE/SET NULL
- Check constraints for data validation
- Unique constraints for business rules
- Triggers for automatic timestamp updates

### Flexibility
- Soft delete support for users and guests
- JSONB fields for extensible data
- Configurable system settings
- Multi-currency support
- Multi-language support

## Useful Views

Pre-created views for common queries:

- `user_complete` - Users with their roles and permissions
- `guest_summary` - Guest overview with loyalty info
- `available_rooms` - Currently available rooms
- `booking_summary` - Comprehensive booking information
- `daily_arrivals` - Upcoming check-ins
- `daily_departures` - Upcoming check-outs
- `occupancy_stats` - Real-time occupancy statistics
- `revenue_summary` - Monthly revenue breakdown

## Stored Functions

Helper functions for business logic:

- `is_room_available(room_id, check_in, check_out)` - Check room availability
- `calculate_booking_total(room_rate, nights, tax_rate, discount)` - Calculate booking totals
- `increment_failed_login(user_email)` - Handle failed login attempts
- `reset_failed_login(user_email)` - Reset login attempts on success
- `cleanup_expired_challenges()` - Remove expired WebAuthn challenges
- `cleanup_expired_sessions()` - Remove expired sessions and tokens

## Database Statistics

After initialization, you should have:

- **Users:** 1 (admin)
- **Roles:** 7 (super_admin, admin, manager, front_desk, housekeeping, accountant, guest)
- **Permissions:** 40+
- **Guests:** 8 sample guests
- **Loyalty Programs:** 4 (Bronze, Silver, Gold, Platinum)
- **Room Types:** 6 (Standard, Deluxe, Ocean View Suite, Presidential, Family, Accessible)
- **Rooms:** 80+ individual rooms
- **Amenities:** 25+
- **Rate Plans:** 6 (Standard, Weekend, Early Bird, Corporate, Summer, Holiday)
- **Services:** 18+ (room service, spa, transport, etc.)
- **Bookings:** 3 sample bookings
- **Corporate Accounts:** 3

## Migrations

For schema changes after initial deployment:

1. Create migration files in `database/migrations/` directory
2. Use sequential numbering: `001_add_feature.sql`, `002_modify_table.sql`
3. Always include rollback scripts
4. Test migrations on development environment first

## Backup & Restore

### Automatic Backups (Production)

When using production profile, automatic backups run daily:

```bash
make production
```

Backups are stored in the `postgres_backups` volume with 7-day retention.

### Manual Backup

```bash
make db-backup
```

### Restore from Backup

```bash
make db-restore BACKUP_FILE=/backups/hotel_db_backup_YYYYMMDD_HHMMSS.sql.gz
```

## Schema Evolution

This database schema is designed to be:

- **Extensible:** Add new tables without affecting existing structure
- **Versioned:** Track changes through migration files
- **Maintainable:** Clear separation of concerns
- **Scalable:** Indexed for performance at scale

## Development Tips

### Adding New Features

1. Determine which module the feature belongs to
2. Add tables to the appropriate schema file
3. Create corresponding seed data
4. Update this README with the changes
5. Test with fresh database initialization

### Querying the Database

```bash
# Open PostgreSQL shell
make db-shell

# Example queries
SELECT * FROM guest_summary WHERE vip_status = true;
SELECT * FROM booking_summary WHERE booking_category = 'In House';
SELECT * FROM occupancy_stats;
```

### Performance Monitoring

```sql
-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes ORDER BY idx_scan ASC;
```

## Support

For questions or issues:

1. Check the main project README.md
2. Review DOCKER_GUIDE.md for Docker-specific issues
3. Examine audit_logs table for debugging
4. Run `make help` for available commands

---

**Version:** 2.0
**Last Updated:** 2025-01-29
**PostgreSQL Version:** 15+
