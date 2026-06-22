-- Backfill portal loyalty members for SQLite databases that already had
-- guests marked as members before the portal loyalty tables existed.

INSERT OR IGNORE INTO loyalty_members (guest_id, member_number, status, enrolled_at)
SELECT
    id,
    printf('LP%08d', id),
    'active',
    COALESCE(created_at, datetime('now'))
FROM guests
WHERE deleted_at IS NULL
  AND guest_type = 'member';

INSERT OR IGNORE INTO loyalty_accounts (
    member_id,
    current_tier_id,
    lifetime_points,
    qualifying_points,
    qualifying_nights,
    qualifying_spend
)
SELECT
    lm.id,
    (
        SELECT id
        FROM loyalty_tiers
        WHERE is_active = 1
        ORDER BY sort_order, id
        LIMIT 1
    ),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.total_stays, 0),
    COALESCE(g.total_spent, 0)
FROM loyalty_members lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.deleted_at IS NULL
  AND g.guest_type = 'member'
  AND NOT EXISTS (
      SELECT 1
      FROM loyalty_accounts existing
      WHERE existing.member_id = lm.id
  );

INSERT INTO loyalty_transactions (
    member_id,
    account_id,
    transaction_type,
    points_delta,
    available_delta,
    balance_after,
    source_type,
    source_id,
    description,
    created_at
)
SELECT
    lm.id,
    la.id,
    'adjusted',
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    'legacy_guest_points',
    g.id,
    'Opening balance from guest loyalty points',
    COALESCE(g.created_at, datetime('now'))
FROM loyalty_members lm
JOIN loyalty_accounts la ON la.member_id = lm.id
JOIN guests g ON g.id = lm.guest_id
WHERE g.deleted_at IS NULL
  AND g.guest_type = 'member'
  AND COALESCE(g.loyalty_points, 0) <> 0
  AND NOT EXISTS (
      SELECT 1
      FROM loyalty_transactions existing
      WHERE existing.member_id = lm.id
        AND existing.source_type = 'legacy_guest_points'
        AND existing.source_id = g.id
        AND existing.transaction_type = 'adjusted'
  );
