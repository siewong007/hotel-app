-- Patch: loyalty program / tier / rules bootstrap rows (PostgreSQL)
-- Date: 2026-07-27
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/data.sql, which now seeds the default loyalty program,
-- its three tiers, and the single loyalty_program_rules row.
--
-- These rows were present in the pre-PostgreSQL data.sql but were never
-- carried into the PostgreSQL V1 install set. The loyalty module has no CRUD
-- surface for them (src/modules/loyalty/repository.rs only SELECTs tiers and
-- rules, and UPDATEs rules WHERE id = 1), so a database missing them fails
-- every enrollment with "no rows returned by a query that expected to return
-- at least one row".
--
-- The statements below are verbatim from data.sql and are guarded, so a
-- database that already has loyalty data (for example one upgraded from the
-- SQLite era) is left untouched.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-27-loyalty-bootstrap-data.sql

BEGIN;

INSERT INTO loyalty_programs (name, description, points_per_dollar, currency, is_active)
SELECT 'Stay Rewards', 'Default guest loyalty program', 1.0000, 'USD', true
WHERE NOT EXISTS (SELECT 1 FROM loyalty_programs);

-- One statement per tier, lowest rank first: `LoyaltyRepository::list_rewards`
-- gating compares tier ids directly (`minimum_tier_id <= member.tier_id`), so
-- the generated ids must ascend with the tier rank.
INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'silver', 'Silver', 1, 0, 0, 0,
       '["Member rates","Points on eligible stays"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'silver');

INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'gold', 'Gold', 2, 5000, 10, 2500,
       '["Priority support","Late checkout when available","Bonus earning"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'gold');

INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'platinum', 'Platinum', 3, 15000, 30, 7500,
       '["Room upgrade priority","Welcome amenity","Highest earning rate"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'platinum');

INSERT INTO loyalty_program_rules
    (id, points_per_currency_unit, tier_qualification_metric, point_expiry_months,
     redemption_approval_required, earning_enabled, min_eligible_amount)
VALUES (1, 1, 'points', 24, true, true, 0)
ON CONFLICT (id) DO NOTHING;

COMMIT;
