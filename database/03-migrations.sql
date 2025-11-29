-- Combined Database Migrations
-- This file runs all migrations in order
-- Automatically executed by PostgreSQL on first container start

-- Create migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration 001: Add audit logging tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '001_add_audit_logs') THEN
        -- Audit log table
        CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGSERIAL PRIMARY KEY,
            table_name VARCHAR(100) NOT NULL,
            record_id BIGINT NOT NULL,
            action VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
            old_values JSONB,
            new_values JSONB,
            changed_by BIGINT REFERENCES users(id),
            changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            ip_address INET,
            user_agent TEXT
        );

        -- Indexes for audit logs
        CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON audit_logs(changed_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by ON audit_logs(changed_by);

        -- Function to create audit log entry
        CREATE OR REPLACE FUNCTION create_audit_log()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                INSERT INTO audit_logs (table_name, record_id, action, old_values, changed_by)
                VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD), current_setting('app.user_id', true)::BIGINT);
                RETURN OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_by)
                VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW), current_setting('app.user_id', true)::BIGINT);
                RETURN NEW;
            ELSIF TG_OP = 'INSERT' THEN
                INSERT INTO audit_logs (table_name, record_id, action, new_values, changed_by)
                VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW), current_setting('app.user_id', true)::BIGINT);
                RETURN NEW;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        -- Record migration
        INSERT INTO schema_migrations (version) VALUES ('001_add_audit_logs');
        RAISE NOTICE 'Migration 001_add_audit_logs applied';
    END IF;
END $$;

-- Migration 002: Add booking history tracking
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '002_add_booking_history') THEN
        -- Booking history table
        CREATE TABLE IF NOT EXISTS booking_history (
            id BIGSERIAL PRIMARY KEY,
            booking_id BIGINT REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
            status VARCHAR(20) NOT NULL,
            changed_by BIGINT REFERENCES users(id),
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- Index for booking history
        CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id ON booking_history(booking_id);
        CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at);

        -- Function to track booking status changes
        CREATE OR REPLACE FUNCTION track_booking_status_change()
        RETURNS TRIGGER AS $$
        BEGIN
            IF OLD.status IS DISTINCT FROM NEW.status THEN
                INSERT INTO booking_history (booking_id, status, changed_by, notes)
                VALUES (NEW.id, NEW.status, current_setting('app.user_id', true)::BIGINT, 
                        'Status changed from ' || OLD.status || ' to ' || NEW.status);
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Trigger to track booking status changes
        DROP TRIGGER IF EXISTS track_booking_status ON bookings;
        CREATE TRIGGER track_booking_status
            AFTER UPDATE OF status ON bookings
            FOR EACH ROW
            WHEN (OLD.status IS DISTINCT FROM NEW.status)
            EXECUTE FUNCTION track_booking_status_change();

        -- Record migration
        INSERT INTO schema_migrations (version) VALUES ('002_add_booking_history');
        RAISE NOTICE 'Migration 002_add_booking_history applied';
    END IF;
END $$;
