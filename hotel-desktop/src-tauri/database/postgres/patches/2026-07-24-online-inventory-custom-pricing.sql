-- Patch: daily custom online room prices (PostgreSQL)
-- Date: 2026-07-24
--
-- Purpose: allows the online inventory control to set a nightly price per
-- room type and stay date. A NULL custom_price continues to use the normal
-- room type / rate-plan price.
--
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-24-online-inventory-custom-pricing.sql

BEGIN;

ALTER TABLE public.online_inventory_allocations
    ADD COLUMN IF NOT EXISTS custom_price numeric(10,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'online_inventory_allocations_custom_price_check'
          AND conrelid = 'public.online_inventory_allocations'::regclass
    ) THEN
        ALTER TABLE public.online_inventory_allocations
            ADD CONSTRAINT online_inventory_allocations_custom_price_check
            CHECK (custom_price IS NULL OR custom_price > 0);
    END IF;
END $$;

COMMIT;
