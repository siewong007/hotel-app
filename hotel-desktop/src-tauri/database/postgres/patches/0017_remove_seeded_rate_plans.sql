-- Removes the seeded demo rate plans (COMP, RACK, EARLY, WKND, CORP, GROUP)
-- and their room_rates rows from installed databases.
--
-- These plans were demo data whose room_rates prices were anchored to a base
-- price the room_types catalogue never carried (e.g. DLX seeded base 250 vs.
-- the live 105), so every seeded "discount" plan actually quoted above the
-- real sold rate. Worse, the COMP plan carried a 0.00 room rate at the highest
-- priority, making seeded room types bookable online for RM 0.00.
--
-- The pricing model this ships with: public online pricing resolves
-- room_types base/weekday/weekend rates plus explicit online-inventory custom
-- prices — nightly_rates no longer consults rate plans at all, so leftover
-- plans are inert for guests regardless. Complimentary nights are member
-- free-night credit redemptions, never a sellable rate.
--
-- Only the six seeded codes are removed; any plan an operator created by hand
-- is preserved (it simply no longer affects public pricing). A seeded plan
-- that a booking still references is left in place to respect the foreign
-- key — it is equally inert — while its room_rates rows are still removed.
--
-- Idempotent: re-running deletes nothing that is already gone.
DO $remove_seeded_rate_plans$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rate_plans'
    ) THEN
        RAISE EXCEPTION 'remove_seeded_rate_plans preflight failed: rate_plans is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'room_rates'
    ) THEN
        RAISE EXCEPTION 'remove_seeded_rate_plans preflight failed: room_rates is missing';
    END IF;

    DELETE FROM public.room_rates
    WHERE rate_plan_id IN (
        SELECT id FROM public.rate_plans
        WHERE code IN ('COMP', 'RACK', 'EARLY', 'WKND', 'CORP', 'GROUP')
    );

    DELETE FROM public.rate_plans
    WHERE code IN ('COMP', 'RACK', 'EARLY', 'WKND', 'CORP', 'GROUP')
      AND NOT EXISTS (
          SELECT 1 FROM public.bookings
          WHERE bookings.rate_plan_id = rate_plans.id
      );
END;
$remove_seeded_rate_plans$;
