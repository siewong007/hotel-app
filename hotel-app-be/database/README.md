# Hotel Management System - Database Documentation

## Overview
This directory contains the complete database schema and seed data for the Hotel Management System. The database is organized into 10 comprehensive migration files that build the entire system from scratch.

## Directory Structure

```
database/
├── 00_init.sql                  # Main initialization script (runs all migrations)
├── migrations/                  # Database schema migrations (run in order)
│   ├── 001_core_system_setup.sql
│   ├── 002_authentication_authorization.sql
│   ├── 003_session_management.sql
│   ├── 004_audit_and_settings.sql
│   ├── 005_guest_management.sql
│   ├── 006_loyalty_program.sql
│   ├── 007_room_management.sql
│   ├── 008_rate_pricing.sql
│   ├── 009_bookings_reservations.sql
│   └── 010_payments_services.sql
└── seed-data/                   # Initial data for testing and development
    ├── 01_system_config_seed.sql
    ├── 02_create_super_admin.sql
    ├── 02_user_data_seed.sql
    ├── 03_booking_data_seed.sql
    ├── 04_loyalty_rewards_seed.sql
    └── 05_fix_occupied_rooms.sql
```

## Migration Files

### 001 - Core System Setup
- PostgreSQL extensions (uuid-ossp, pgcrypto)
- Core utility functions
- Timestamp management
- Session cleanup functions
- Login attempt tracking

### 002 - Authentication & Authorization
- Users table with enhanced security
- Roles and permissions (RBAC)
- User-role mappings
- User type separation (staff vs guest)
- Email verification
- Two-factor authentication support

### 003 - Session Management
- Refresh tokens for JWT authentication
- WebAuthn passkeys (passwordless login)
- Passkey challenges
- Active user sessions tracking

### 004 - Audit & System Settings
- Comprehensive audit logging
- System-wide configuration settings
- Email templates for notifications
- Activity tracking

### 005 - Guest Management
- Guest profiles and personal information
- Guest documents (ID, passport)
- Guest preferences
- Guest notes and alerts
- eKYC (electronic Know Your Customer) system
- Guest reviews and feedback
- Corporate accounts
- User-guest relationships (many-to-many)

### 006 - Loyalty Program
- Loyalty program definitions (tiers)
- Guest membership management
- Points transactions (earn, redeem, expire)
- Loyalty rewards catalog
- Reward redemptions tracking

### 007 - Room Management
- Room types (Standard, Deluxe, Suite)
- Amenities catalog
- Individual room inventory
- Room availability calendar
- Room events (maintenance, cleaning)
- Room status history
- Housekeeping tasks
- Auto check-in/check-out settings

### 008 - Rate & Pricing
- Rate plans (seasonal, promotional, corporate)
- Room rates by type
- Day-of-week pricing
- Date range applicability
- Booking constraints

### 009 - Bookings & Reservations
- Main bookings table
- Additional booking guests
- Booking modifications history
- Booking status changes audit trail
- Comprehensive booking views (arrivals, departures, occupancy)
- Revenue summary views

### 010 - Payments & Services
- Payment processing (multiple gateways)
- Payment transactions
- Invoicing system
- Additional services catalog (room service, laundry, spa)
- Booking services tracking

## Key Features

### Security
- Password hashing with bcrypt
- JWT-based authentication with refresh tokens
- WebAuthn passkey support for passwordless login
- Two-factor authentication (2FA)
- Email verification
- Failed login attempt tracking and account locking
- Audit logging for all critical actions

### Authorization
- Role-Based Access Control (RBAC)
- Fine-grained permissions system
- User-role and role-permission mappings
- Super admin support
- Permission inheritance

### Guest Management
- Comprehensive guest profiles
- eKYC verification system
- Guest documents management
- Preferences and special requests
- VIP and blacklist tracking
- Guest reviews by room type
- Corporate account linking

### Room Management
- Multiple room types with custom pricing
- Room status tracking (available, occupied, maintenance, cleaning)
- Room availability calendar
- Housekeeping task management
- Room event tracking
- Room status history for audit trail
- Auto check-in/check-out functionality

### Loyalty Program
- Multi-tier loyalty programs
- Points earning and redemption
- Rewards catalog with categories
- Membership management
- Points expiration handling

### Booking System
- Flexible booking management
- Multiple booking statuses
- Check-in/check-out tracking
- Additional guests support
- Booking modifications with history
- Corporate bookings
- Rate plans and special pricing

### Payment & Invoicing
- Multiple payment methods
- Payment gateway integration (Stripe, PayPal)
- Comprehensive invoicing
- Additional services billing
- Refund tracking
- Corporate billing support

## Database Functions

### Utility Functions
- `update_updated_at_column()` - Automatically updates updated_at timestamps
- `cleanup_expired_challenges()` - Removes expired passkey challenges
- `cleanup_expired_sessions()` - Cleans up expired sessions and tokens
- `increment_failed_login(email)` - Tracks failed login attempts
- `reset_failed_login(email)` - Resets login attempts on successful login

### Business Logic Functions
- `is_room_available(room_id, check_in, check_out)` - Checks room availability
- `calculate_booking_total(rate, nights, tax, discount)` - Calculates booking totals

## Views

### User Management
- `user_complete` - Users with their roles and permissions

### Guest Management
- `guest_summary` - Guest overview with loyalty info and alerts

### Room Management
- `available_rooms` - Currently available rooms with pricing

### Booking Management
- `booking_summary` - Comprehensive booking information
- `daily_arrivals` - Arrivals by date
- `daily_departures` - Departures by date
- `occupancy_stats` - Real-time occupancy statistics
- `revenue_summary` - Monthly revenue breakdown

## Running Migrations

### Initial Setup
```bash
# Run the main initialization script
psql -U postgres -d hotel_db -f 00_init.sql
```

### Individual Migration
```bash
# Run a specific migration
psql -U postgres -d hotel_db -f migrations/001_core_system_setup.sql
```

### With Docker
```bash
# The migrations run automatically when the container starts
docker-compose up -d postgres
```

## Seed Data

After running migrations, populate the database with seed data:

```bash
# Run seed data in order
psql -U postgres -d hotel_db -f seed-data/01_system_config_seed.sql
psql -U postgres -d hotel_db -f seed-data/02_create_super_admin.sql
psql -U postgres -d hotel_db -f seed-data/03_booking_data_seed.sql
psql -U postgres -d hotel_db -f seed-data/04_loyalty_rewards_seed.sql
```

## Database Diagram

```
┌─────────────┐
│   Users     │◄────┐
└─────────────┘     │
       │            │
       ▼            │
┌─────────────┐    │
│   Roles     │    │
└─────────────┘    │
       │            │
       ▼            │
┌─────────────┐    │
│ Permissions │    │
└─────────────┘    │
                    │
┌─────────────┐    │
│   Guests    │────┘
└─────────────┘
       │
       ├──────► Documents
       ├──────► Preferences
       ├──────► Notes
       ├──────► Loyalty Memberships
       │               │
       │               ▼
       │        Points Transactions
       │               │
       │               ▼
       │        Reward Redemptions
       │
       └──────► Bookings
                   │
                   ├──────► Booking Guests
                   ├──────► Booking Services
                   ├──────► Payments
                   ├──────► Invoices
                   └──────► Rooms
                               │
                               ├──────► Room Types
                               ├──────► Room Events
                               ├──────► Room History
                               └──────► Housekeeping Tasks
```

## Indexes

All tables include optimized indexes for:
- Foreign key relationships
- Frequently queried columns
- Date ranges
- Status fields
- Full-text search (guests)

## Triggers

Automatic triggers for:
- Updated timestamp management
- Audit trail generation
- Data validation

## Best Practices

1. **Always run migrations in order** - Dependencies exist between migrations
2. **Use transactions** - Wrap database changes in transactions when possible
3. **Backup before migration** - Always backup production data before running migrations
4. **Test seed data** - Verify seed data doesn't conflict with production data
5. **Review audit logs** - Check audit_logs table for security events

## Troubleshooting

### Migration Failures
If a migration fails:
1. Check the error message carefully
2. Verify all previous migrations ran successfully
3. Check for existing conflicting data
4. Review foreign key constraints

### Performance Issues
If experiencing slow queries:
1. Check if indexes are being used (EXPLAIN ANALYZE)
2. Review table statistics (ANALYZE command)
3. Consider adding additional indexes
4. Check for missing foreign key indexes

## Support

For questions or issues:
- Review the migration file comments
- Check the database views for data examples
- Review audit logs for operation history

## Version History

- **v2.0** (2025-01-29) - Complete restructure into 10 comprehensive migrations
  - Consolidated all schema files
  - Enhanced eKYC system
  - Improved audit trailing
  - Added room status tracking
  - Enhanced payment gateway support
  - Added loyalty program
  - Improved user-guest separation

---

**Last Updated:** 2025-12-16
**Database Version:** 2.0
**PostgreSQL Version:** 14+
