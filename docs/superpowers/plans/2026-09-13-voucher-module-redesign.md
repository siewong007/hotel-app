# Voucher Module Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the staff voucher workspace (Vouchers tab of `/promotions`) into a premium, operationally efficient module backed by real summary/detail APIs.

**Architecture:** Additive backend (`GET /admin/vouchers/summary`, `GET /admin/vouchers/{id}`, `guest_name` join, `status=expired|expiring_soon` filter aliases) + frontend rebuild of the vouchers tab using existing shared components (`PageHeader`, `StatStrip`, `StatusChip`, `EmptyState`), a new `VoucherDetailsDrawer`, and a rebuilt `VoucherIssueDialog`. Guest-facing voucher UI untouched.

**Tech Stack:** Rust/Axum/SQLx (PostgreSQL) backend; React 19 + MUI v9 + TanStack Query + `ky` frontend; Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-13-voucher-module-redesign.md`

## Global Constraints

- Backend commands run in `hotel-app-be/`; frontend in `hotel-web-fe/` (`bun` is the package manager).
- All HTTP via `src/api/client.ts` (`api.get/post`) — never `fetch`.
- No new dependencies. MUI + existing shared components only.
- `toISOString().split/.slice` is lint-banned — use `src/utils/date.ts` helpers.
- Keep SQL parameterized; additive columns/filters only — no schema changes, no new patch files.
- `status=available` filter keeps returning all `available` rows (incl. past-expiry) — expired/expiring are *additional* aliases, existing behavior preserved.
- Dirty worktree: do NOT touch `src/features/rooms/**` or `src/theme.ts` (another session's in-flight work). `useAllRoomTypes` import from `features/rooms/hooks` is read-only usage — allowed.
- New routes drift `docs/api/openapi.json` — regenerate via `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
- Permissions: `vouchers:read`, `vouchers:manage`, `promotions:read`, `promotions:manage` already exist in seed.
- Staff only ever see `code_masked` (`••••` + last 4). Never expose raw codes.
- Commit style: short imperative subject; add the Devin trailer block to every commit:
  `Generated with [Devin](https://devin.ai)` + `Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`

---

### Task 1: Backend — voucher summary, detail, guest_name, status filter aliases

**Files:**
- Modify: `hotel-app-be/src/modules/promotions/models.rs`
- Modify: `hotel-app-be/src/modules/promotions/repository.rs`
- Modify: `hotel-app-be/src/modules/promotions/service.rs`
- Modify: `hotel-app-be/src/modules/promotions/handlers.rs`
- Modify: `hotel-app-be/src/modules/promotions/routes.rs`
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Produces: `GET /admin/vouchers/summary` → `VoucherSummary { total, available, redeemed, revoked, expired, expiring_soon, redemption_count, discount_given: [{ currency, amount }] }`; `GET /admin/vouchers/{id}` → `Voucher` (with `guest_name`); `GET /admin/vouchers?status=expired|expiring_soon`; `GET /admin/vouchers?promotion_id=N`; all voucher responses gain `guest_name: string | null`.

- [ ] **Step 1: Add models**

In `models.rs`, add to `Voucher` (serde field order doesn't matter):

```rust
    /// Display name of the owning guest (`guests.nick_name`). Only populated
    /// for staff/admin reads; guest-facing queries leave it `None`.
    pub guest_name: Option<String>,
    /// Why the voucher was revoked. Admin reads only; used by the details
    /// drawer lifecycle section.
    pub revocation_reason: Option<String>,
```

Append at end of file (before `#[cfg(test)]`):

```rust
#[derive(Debug, Serialize)]
pub struct VoucherSummaryDiscount {
    pub currency: String,
    pub amount: f64,
}

/// Aggregate counters for the staff voucher dashboard. `expired` and
/// `expiring_soon` are overlapping subsets of `available` (the persisted
/// status never changes), so `available + redeemed + revoked == total`.
#[derive(Debug, Serialize)]
pub struct VoucherSummary {
    pub total: i64,
    pub available: i64,
    pub redeemed: i64,
    pub revoked: i64,
    /// `available` rows whose `expires_at` is already past.
    pub expired: i64,
    /// `available` rows expiring within the next 7 days.
    pub expiring_soon: i64,
    /// `voucher_redemptions` rows with status `applied`.
    pub redemption_count: i64,
    /// Sum of applied `discount_amount` grouped by the promotion's currency.
    pub discount_given: Vec<VoucherSummaryDiscount>,
}
```

`PromotionListQuery` gains `promotion_id: Option<i64>` (used only by the voucher list; ignored elsewhere):

```rust
#[derive(Debug, Deserialize)]
pub struct PromotionListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub status: Option<String>,
    pub search: Option<String>,
    /// Optional voucher-list filter; promotion lists ignore it.
    pub promotion_id: Option<i64>,
}
```

- [ ] **Step 2: Repository — admin column set + joins + summary + expired filter**

In `repository.rs`, after `VOUCHER_COLUMNS`, add:

```rust
/// Admin projection: everything in [`VOUCHER_COLUMNS`] plus the owning guest's
/// display name. `guests.nick_name` is NOT NULL and is the established
/// `guest_name` convention (see other admin joins in the baseline schema).
const VOUCHER_COLUMNS_ADMIN: &str = r#"
    v.id,
    v.promotion_id,
    v.guest_id,
    p.name AS promotion_name,
    p.slug AS promotion_slug,
    p.is_cancellable,
    v.code,
    v.status,
    v.source,
    v.expires_at,
    v.claimed_at,
    v.redeemed_at,
    v.revoked_at,
    v.revocation_reason,
    v.created_at,
    g.nick_name AS guest_name
"#;

/// FROM clause for staff-facing voucher reads — adds the guests join needed
/// for `guest_name`. Guest-facing queries keep the promotions-only join.
const VOUCHER_ADMIN_FROM: &str =
    "FROM vouchers v JOIN promotions p ON p.id = v.promotion_id LEFT JOIN guests g ON g.id = v.guest_id";
```

In `voucher_from_row`, add to the `Voucher` literal:

```rust
        guest_name: row
            .try_get::<Option<String>, _>("guest_name")
            .ok()
            .flatten(),
        revocation_reason: row
            .try_get::<Option<String>, _>("revocation_reason")
            .ok()
            .flatten(),
```

Update the shared `VOUCHER_STATUSES`-style doc comment? No. Update `list_admin_vouchers` to use the admin columns/joins and add the `expired`/`expiring_soon` aliases + `promotion_id` filter. New signature and body:

```rust
    /// `status` accepts the persisted vocabulary plus the query aliases
    /// `expired` (available, past `expires_at`) and `expiring_soon`
    /// (available, expiring within 7 days).
    pub async fn list_admin_vouchers(
        pool: &DbPool,
        status: Option<&str>,
        search: Option<&str>,
        promotion_id: Option<i64>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Voucher>), ApiError> {
        let count_sql = r#"
                SELECT COUNT(*) FROM vouchers v
                JOIN promotions p ON p.id = v.promotion_id
                WHERE (
                    $1::text IS NULL
                    OR ($1 = 'expired' AND v.status = 'available' AND v.expires_at < CURRENT_TIMESTAMP)
                    OR ($1 = 'expiring_soon' AND v.status = 'available'
                        AND v.expires_at >= CURRENT_TIMESTAMP
                        AND v.expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days')
                    OR ($1 <> 'expired' AND $1 <> 'expiring_soon' AND v.status = $1)
                )
                  AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
                  AND ($3::bigint IS NULL OR v.promotion_id = $3)
            "#;
        let total = query_scalar::<_, i64>(count_sql)
            .bind(status)
            .bind(search)
            .bind(promotion_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {VOUCHER_COLUMNS}
                    {VOUCHER_ADMIN_FROM}
                    WHERE (
                        $1::text IS NULL
                        OR ($1 = 'expired' AND v.status = 'available' AND v.expires_at < CURRENT_TIMESTAMP)
                        OR ($1 = 'expiring_soon' AND v.status = 'available'
                            AND v.expires_at >= CURRENT_TIMESTAMP
                            AND v.expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days')
                        OR ($1 <> 'expired' AND $1 <> 'expiring_soon' AND v.status = $1)
                    )
                      -- Raw codes are masked in staff responses. Only allow an exact
                      -- code lookup so substring searches cannot become a code oracle.
                      AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
                      AND ($3::bigint IS NULL OR v.promotion_id = $3)
                    ORDER BY v.created_at DESC LIMIT $4 OFFSET $5
                "#
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS_ADMIN)
        .replace("{VOUCHER_ADMIN_FROM}", VOUCHER_ADMIN_FROM);
        let rows = query(&sql)
            .bind(status)
            .bind(search)
            .bind(promotion_id)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((
            total,
            rows.iter()
                .map(|row| voucher_from_row(row, false))
                .collect(),
        ))
    }
```

Update `find_voucher_admin` to use admin columns + joins (same `include_code = false`):

```rust
        let sql = "SELECT {VOUCHER_COLUMNS} {VOUCHER_ADMIN_FROM} WHERE v.id = $1"
            .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS_ADMIN)
            .replace("{VOUCHER_ADMIN_FROM}", VOUCHER_ADMIN_FROM);
```

Add `voucher_admin_summary` to `impl PromotionRepository` (before the closing `}`):

```rust
    pub async fn voucher_admin_summary(pool: &DbPool) -> Result<VoucherSummary, ApiError> {
        let status_row = query(
            r#"
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'available') AS available,
                    COUNT(*) FILTER (WHERE status = 'redeemed') AS redeemed,
                    COUNT(*) FILTER (WHERE status = 'revoked') AS revoked,
                    COUNT(*) FILTER (
                        WHERE status = 'available' AND expires_at < CURRENT_TIMESTAMP
                    ) AS expired,
                    COUNT(*) FILTER (
                        WHERE status = 'available'
                          AND expires_at >= CURRENT_TIMESTAMP
                          AND expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days'
                    ) AS expiring_soon
                FROM vouchers
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let redemption_count = query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM voucher_redemptions WHERE status = 'applied'",
        )
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let discount_rows = query(
            r#"
                SELECT p.currency AS currency, COALESCE(SUM(r.discount_amount), 0) AS amount
                FROM voucher_redemptions r
                JOIN promotions p ON p.id = r.promotion_id
                WHERE r.status = 'applied'
                GROUP BY p.currency
                ORDER BY p.currency
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(VoucherSummary {
            total: status_row.try_get("total").unwrap_or_default(),
            available: status_row.try_get("available").unwrap_or_default(),
            redeemed: status_row.try_get("redeemed").unwrap_or_default(),
            revoked: status_row.try_get("revoked").unwrap_or_default(),
            expired: status_row.try_get("expired").unwrap_or_default(),
            expiring_soon: status_row.try_get("expiring_soon").unwrap_or_default(),
            redemption_count,
            discount_given: discount_rows
                .iter()
                .map(|row| VoucherSummaryDiscount {
                    currency: row
                        .try_get("currency")
                        .unwrap_or_else(|_| "USD".to_string()),
                    amount: decimal_to_f64(get_decimal(row, "amount")),
                })
                .collect(),
        })
    }
```

Update the import: `use super::models::{Promotion, PublicPromotion, Voucher, VoucherSummary, VoucherSummaryDiscount};`

- [ ] **Step 3: Service — filter aliases, detail, summary + unit tests**

In `service.rs`, replace the `status` handling inside `list_admin_vouchers` and add the new functions:

```rust
/// Maps the admin voucher `status` query param to a repository filter. The
/// aliases `expired` / `expiring_soon` become date predicates in SQL — they
/// are never persisted statuses.
fn normalized_voucher_status_filter(value: Option<String>) -> Result<Option<String>, ApiError> {
    match normalized_filter(value) {
        None => Ok(None),
        Some(raw)
            if raw.eq_ignore_ascii_case("expired")
                || raw.eq_ignore_ascii_case("expiring_soon") =>
        {
            Ok(Some(raw.to_ascii_lowercase()))
        }
        Some(raw) => validation::validate_voucher_status(&raw).map(Some),
    }
}

pub async fn list_admin_vouchers(
    pool: &DbPool,
    query: PromotionListQuery,
) -> Result<VoucherListResponse, ApiError> {
    let (page, page_size, offset) = pagination(&query);
    let status = normalized_voucher_status_filter(query.status)?;
    let search = normalized_filter(query.search);
    let promotion_id = query.promotion_id.filter(|id| *id > 0);
    let (total, items) = PromotionRepository::list_admin_vouchers(
        pool,
        status.as_deref(),
        search.as_deref(),
        promotion_id,
        page_size,
        offset,
    )
    .await?;
    Ok(VoucherListResponse {
        items,
        total,
        page,
        page_size,
    })
}

pub async fn get_admin_voucher(pool: &DbPool, voucher_id: i64) -> Result<Voucher, ApiError> {
    PromotionRepository::find_voucher_admin(pool, voucher_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Voucher not found".to_string()))
}

pub async fn voucher_admin_summary(pool: &DbPool) -> Result<VoucherSummary, ApiError> {
    PromotionRepository::voucher_admin_summary(pool).await
}
```

Add `VoucherSummary` to the service imports from `super::models`.

Add a `#[cfg(test)] mod tests` at the bottom of `service.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::normalized_voucher_status_filter;

    #[test]
    fn voucher_status_filter_accepts_query_aliases() {
        assert_eq!(
            normalized_voucher_status_filter(Some("expired".to_string())).unwrap(),
            Some("expired".to_string())
        );
        assert_eq!(
            normalized_voucher_status_filter(Some("Expiring_Soon".to_string())).unwrap(),
            Some("expiring_soon".to_string())
        );
    }

    #[test]
    fn voucher_status_filter_normalizes_persisted_statuses() {
        assert_eq!(
            normalized_voucher_status_filter(Some(" Available ".to_string())).unwrap(),
            Some("available".to_string())
        );
    }

    #[test]
    fn voucher_status_filter_rejects_non_voucher_statuses() {
        assert!(normalized_voucher_status_filter(Some("paused".to_string())).is_err());
        assert!(normalized_voucher_status_filter(Some("archived".to_string())).is_err());
    }

    #[test]
    fn voucher_status_filter_passes_through_empty() {
        assert_eq!(normalized_voucher_status_filter(None).unwrap(), None);
        assert_eq!(
            normalized_voucher_status_filter(Some("   ".to_string())).unwrap(),
            None
        );
    }
}
```

- [ ] **Step 4: Handlers + routes**

In `handlers.rs` — import `VoucherSummary` and add:

```rust
pub async fn get_admin_voucher_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(voucher_id): Path<i64>,
) -> Result<Json<Voucher>, ApiError> {
    require_permission_helper(&pool, &headers, "vouchers:read").await?;
    Ok(Json(service::get_admin_voucher(&pool, voucher_id).await?))
}

pub async fn voucher_admin_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<VoucherSummary>, ApiError> {
    require_permission_helper(&pool, &headers, "vouchers:read").await?;
    Ok(Json(service::voucher_admin_summary(&pool).await?))
}
```

In `routes.rs`, inside the vouchers block:

```rust
        .route(
            "/admin/vouchers/summary",
            get(handlers::voucher_admin_summary_handler),
        )
        .route(
            "/admin/vouchers/{id}",
            get(handlers::get_admin_voucher_handler),
        )
```

(`summary` is a static segment — axum/matchit prioritizes it over `{id}`; `{id}` vs `{id}/revoke` do not collide.)

- [ ] **Step 5: Verify backend compiles + unit tests pass**

Run: `cd hotel-app-be && cargo check --all-features && cargo test --all-features normalized_voucher_status -- --nocapture`
Expected: compiles clean; 4 new tests pass. (DB-backed tests skip without `DATABASE_URL` — fine.)

- [ ] **Step 6: Clippy + OpenAPI regen**

Run: `cd hotel-app-be && cargo clippy --all-features -- -D warnings`
Run: `cd hotel-app-be && HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`
Expected: clippy clean; `docs/api/openapi.json` updated with the two new paths + `promotion_id`/`guest_name`/`VoucherSummary` schema bits.

- [ ] **Step 7: Commit**

```bash
git add hotel-app-be/src/modules/promotions docs/api/openapi.json
git commit -m "feat(be): voucher summary/detail endpoints, guest names, expiry filters"
```

---

### Task 2: Frontend — types, API, query keys, hooks, utils

**Files:**
- Modify: `hotel-web-fe/src/features/promotions/types.ts`
- Modify: `hotel-web-fe/src/features/promotions/api/promotionsApi.ts`
- Modify: `hotel-web-fe/src/api/queryKeys.ts`
- Modify: `hotel-web-fe/src/features/promotions/hooks/usePromotionAdmin.ts`
- Modify: `hotel-web-fe/src/features/promotions/utils.ts`
- Modify: `hotel-web-fe/src/features/promotions/constants.ts`
- Test: `hotel-web-fe/src/features/promotions/utils.test.ts` (new)

**Interfaces:**
- Produces: `PromotionsApi.getVoucher(id)`, `PromotionsApi.getVoucherSummary()`, `PromotionsApi.getAdminPromotion(id)`; hooks `useAdminVoucher(id|null)`, `useVoucherSummary(enabled)`, `useAdminPromotion(id|null)`; utils `voucherDisplayStatus`, `relativeExpiryLabel`, `voucherSourceLabel`, `promotionClaimIssue`, `formatCurrencyAmount`, `guestDisplayName`; `VoucherStatusChip` props `{ voucher: Voucher; size?: 'small' | 'medium' }`.

- [ ] **Step 1: Write failing util tests** — create `utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Promotion, Voucher } from './types';
import {
  promotionClaimIssue,
  relativeExpiryLabel,
  voucherDisplayStatus,
  voucherSourceLabel,
  formatCurrencyAmount,
} from './utils';

const NOW = new Date('2026-09-13T12:00:00Z').getTime();

const baseVoucher: Voucher = {
  id: 1,
  promotion_id: 2,
  promotion_name: 'Offer',
  promotion_slug: 'offer',
  code_masked: '••••AB12',
  status: 'available',
  source: 'admin_issue',
  is_cancellable: true,
  guest_id: 9,
  expires_at: null,
  created_at: '2026-09-01T00:00:00Z',
};

describe('voucherDisplayStatus', () => {
  it('flags expired only for available vouchers past expiry', () => {
    expect(
      voucherDisplayStatus(
        { ...baseVoucher, expires_at: '2026-09-12T12:00:00Z' },
        NOW,
      ),
    ).toBe('expired');
    expect(
      voucherDisplayStatus(
        {
          ...baseVoucher,
          status: 'redeemed',
          expires_at: '2026-09-12T12:00:00Z',
        },
        NOW,
      ),
    ).toBe('redeemed');
    expect(
      voucherDisplayStatus(
        { ...baseVoucher, expires_at: '2026-09-20T12:00:00Z' },
        NOW,
      ),
    ).toBe('available');
    expect(voucherDisplayStatus(baseVoucher, NOW)).toBe('available');
  });
});

describe('relativeExpiryLabel', () => {
  it('describes missing, past, today, and future expiries', () => {
    expect(relativeExpiryLabel(null, NOW)).toBe('No expiry');
    expect(relativeExpiryLabel('2026-09-10T12:00:00Z', NOW)).toBe('Expired 3d ago');
    expect(relativeExpiryLabel('2026-09-13T06:00:00Z', NOW)).toBe('Expired today');
    expect(relativeExpiryLabel('2026-09-13T18:00:00Z', NOW)).toBe('Expires today');
    expect(relativeExpiryLabel('2026-09-16T12:00:00Z', NOW)).toBe('Expires in 3d');
  });
});

describe('voucherSourceLabel', () => {
  it('maps known sources and humanizes unknowns', () => {
    expect(voucherSourceLabel('guest_claim')).toBe('Guest claim');
    expect(voucherSourceLabel('admin_issue')).toBe('Issued by staff');
    expect(voucherSourceLabel('partner_api')).toBe('Partner api');
  });
});

describe('promotionClaimIssue', () => {
  const published: Promotion = {
    id: 1, slug: 'x', name: 'X', status: 'published',
    promotion_kind: 'voucher', discount_type: 'percentage',
    discount_value: 10, currency: 'USD', claimed_count: 0,
    per_guest_limit: 1, is_public: true, room_type_ids: [],
    version: 1, created_at: '', updated_at: '',
  };

  it('returns a reason for unpublished, unopened, closed, and exhausted offers', () => {
    expect(promotionClaimIssue({ ...published, status: 'draft' }, NOW)).toBe('Not published');
    expect(
      promotionClaimIssue(
        { ...published, claim_starts_at: '2026-09-14T00:00:00Z' }, NOW,
      ),
    ).toBe('Claims not open yet');
    expect(
      promotionClaimIssue(
        { ...published, claim_ends_at: '2026-09-12T00:00:00Z' }, NOW,
      ),
    ).toBe('Claim window closed');
    expect(
      promotionClaimIssue(
        { ...published, claim_limit: 5, claimed_count: 5 }, NOW,
      ),
    ).toBe('Claim limit reached');
    expect(promotionClaimIssue(published, NOW)).toBeNull();
  });
});

describe('formatCurrencyAmount', () => {
  it('formats with the given currency', () => {
    expect(formatCurrencyAmount(1234.5, 'USD')).toContain('1,234');
  });
});
```

Run: `cd hotel-web-fe && bun run test -- src/features/promotions/utils.test.ts`
Expected: FAIL (functions don't exist).

- [ ] **Step 2: Implement utils** — append to `utils.ts` (imports add `Voucher`, `VoucherDisplayStatus`):

```ts
import { formatStatusLabel } from '../../utils/formatters';
import type { Promotion, PromotionDiscountType, Voucher, VoucherDisplayStatus } from './types';

/** The status staff see: a still-`available` voucher past `expires_at` reads
 *  as expired — matching the backend `status=expired` query alias. */
export function voucherDisplayStatus(
  voucher: Pick<Voucher, 'status' | 'expires_at'>,
  nowMs: number = Date.now(),
): VoucherDisplayStatus {
  if (
    voucher.status === 'available' &&
    voucher.expires_at &&
    new Date(voucher.expires_at).getTime() < nowMs
  ) {
    return 'expired';
  }
  return voucher.status;
}

const DAY_MS = 86_400_000;

/** Short operational expiry line for tables/drawers. */
export function relativeExpiryLabel(
  expiresAt?: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!expiresAt) return 'No expiry';
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = ms - nowMs;
  const days = Math.abs(Math.round(diff / DAY_MS));
  if (diff < 0) return days === 0 ? 'Expired today' : `Expired ${days}d ago`;
  if (diff < DAY_MS) return 'Expires today';
  return `Expires in ${days}d`;
}

export function voucherSourceLabel(source: string): string {
  if (source === 'guest_claim') return 'Guest claim';
  if (source === 'admin_issue') return 'Issued by staff';
  return formatStatusLabel(source);
}

/** Why a promotion can't issue a voucher right now — mirrors backend
 *  `ensure_admin_issueable` so the dialog never offers dead options. */
export function promotionClaimIssue(
  promotion: Promotion,
  nowMs: number = Date.now(),
): string | null {
  if (promotion.status !== 'published') return 'Not published';
  if (
    promotion.claim_starts_at &&
    new Date(promotion.claim_starts_at).getTime() > nowMs
  ) {
    return 'Claims not open yet';
  }
  if (
    promotion.claim_ends_at &&
    new Date(promotion.claim_ends_at).getTime() < nowMs
  ) {
    return 'Claim window closed';
  }
  if (
    promotion.claim_limit != null &&
    promotion.claimed_count >= promotion.claim_limit
  ) {
    return 'Claim limit reached';
  }
  return null;
}

export function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function guestDisplayName(voucher: Voucher): string {
  const name = voucher.guest_name?.trim();
  if (name) return name;
  return voucher.guest_id != null ? `Guest #${voucher.guest_id}` : '—';
}
```

`types.ts` additions:

```ts
/** Display-only voucher status: `available` rows past `expires_at`. Never persisted. */
export type VoucherDisplayStatus = VoucherStatus | 'expired';

/** `status` query param values — display statuses plus the `expiring_soon`
 *  alias (a filter can never be a row's own display status). */
export type VoucherStatusFilter = VoucherDisplayStatus | 'expiring_soon';

export interface VoucherSummaryDiscount {
  currency: string;
  amount: number;
}

export interface VoucherSummary {
  total: number;
  available: number;
  redeemed: number;
  revoked: number;
  expired: number;
  expiring_soon: number;
  redemption_count: number;
  discount_given: VoucherSummaryDiscount[];
}
```

`Voucher` gains `revocation_reason?: string | null` (admin-populated).

`VoucherListParams.status` widens to `VoucherStatusFilter`.

- [ ] **Step 3: API + query keys + hooks**

`promotionsApi.ts` — add methods + import `VoucherSummary`:

```ts
  getVoucher(voucherId: number): Promise<Voucher> {
    return api.get(`admin/vouchers/${voucherId}`).json<Voucher>();
  },

  getVoucherSummary(): Promise<VoucherSummary> {
    return api.get('admin/vouchers/summary').json<VoucherSummary>();
  },

  getAdminPromotion(promotionId: number): Promise<Promotion> {
    return api.get(`admin/promotions/${promotionId}`).json<Promotion>();
  },
```

`queryKeys.ts` — inside `promotions` object:

```ts
    adminVoucher: (voucherId: number) =>
      [...promotions, 'admin', 'voucher', voucherId] as const,
    voucherSummary: () => [...promotions, 'admin', 'voucherSummary'] as const,
    adminPromotionDetail: (promotionId: number) =>
      [...promotions, 'admin', 'promotion', promotionId] as const,
```

`usePromotionAdmin.ts` — add:

```ts
export function useAdminVoucher(voucherId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminVoucher(voucherId ?? 0),
    queryFn: () => PromotionsApi.getVoucher(voucherId as number),
    enabled: enabled && voucherId != null,
    staleTime: queryStaleTime.short,
  });
}

export function useVoucherSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.voucherSummary(),
    queryFn: () => PromotionsApi.getVoucherSummary(),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useAdminPromotion(promotionId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminPromotionDetail(promotionId ?? 0),
    queryFn: () => PromotionsApi.getAdminPromotion(promotionId as number),
    enabled: enabled && promotionId != null,
    staleTime: queryStaleTime.short,
  });
}
```

`constants.ts` — add display + filter labels (import `VoucherStatusFilter`, `VoucherDisplayStatus`):

```ts
export const VOUCHER_DISPLAY_STATUS_LABELS: Record<VoucherDisplayStatus, string> = {
  available: 'Available',
  expired: 'Expired',
  redeemed: 'Redeemed',
  revoked: 'Revoked',
};

export const VOUCHER_STATUS_FILTER_LABELS: Record<VoucherStatusFilter, string> = {
  ...VOUCHER_DISPLAY_STATUS_LABELS,
  expiring_soon: 'Expiring soon',
};
```

`VOUCHER_FILTERS` lives in `PromotionManagementPage.tsx` — update in Task 6.

- [ ] **Step 4: Run util tests + typecheck**

Run: `cd hotel-web-fe && bun run test -- src/features/promotions/utils.test.ts && bun run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/promotions hotel-web-fe/src/api/queryKeys.ts
git commit -m "feat(fe): voucher api surface, hooks, and status/expiry utils"
```

---

### Task 3: `VoucherStatusChip` + `VoucherAdminTable` rebuild

**Files:**
- Create: `hotel-web-fe/src/features/promotions/components/VoucherStatusChip.tsx`
- Modify: `hotel-web-fe/src/features/promotions/components/VoucherAdminTable.tsx`
- Test: `hotel-web-fe/src/features/promotions/components/VoucherAdminTable.test.tsx` (new)

**Interfaces:**
- Consumes: Task 2 utils/constants/types.
- Produces: `VoucherAdminTable` props `{ vouchers, total, page, pageSize, isLoading, canManage, isRevoking, onView(voucher), onRevoke(id, displayCode), onPageChange, onPageSizeChange }` — adds `onView`; `VoucherStatusChip { voucher, size? }`.

- [ ] **Step 1: Write failing table tests** — `VoucherAdminTable.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Voucher } from '../types';
import { VoucherAdminTable } from './VoucherAdminTable';

function buildVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 11,
    promotion_id: 2,
    promotion_name: 'Stay longer',
    promotion_slug: 'stay-longer',
    code_masked: '••••AB12',
    status: 'available',
    source: 'admin_issue',
    is_cancellable: true,
    guest_id: 9,
    guest_name: 'Aisha',
    expires_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function renderTable(
  overrides: Partial<React.ComponentProps<typeof VoucherAdminTable>> = {},
) {
  const props = {
    vouchers: [buildVoucher()],
    total: 1,
    page: 0,
    pageSize: 25,
    isLoading: false,
    canManage: true,
    isRevoking: false,
    onView: vi.fn(),
    onRevoke: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
  render(<VoucherAdminTable {...props} />);
  return props;
}

describe('VoucherAdminTable', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }),
    });
  });

  afterEach(() => cleanup());

  it('renders masked code, guest name, source, and an Available chip', () => {
    renderTable();
    expect(screen.getByText('••••AB12')).toBeTruthy();
    expect(screen.getByText('Aisha')).toBeTruthy();
    expect(screen.getByText('Issued by staff')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('falls back to the guest id when no name is returned', () => {
    renderTable({ vouchers: [buildVoucher({ guest_name: null })] });
    expect(screen.getByText('Guest #9')).toBeTruthy();
  });

  it('badges an available voucher past expiry as Expired and hides revoke', () => {
    renderTable({
      vouchers: [
        buildVoucher({ expires_at: '2020-01-01T00:00:00Z' }),
      ],
    });
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Revoke voucher' }),
    ).toBeNull();
  });

  it('calls onView when the row is clicked', () => {
    const voucher = buildVoucher();
    const { onView } = renderTable({ vouchers: [voucher] });
    fireEvent.click(screen.getByText('Aisha'));
    expect(onView).toHaveBeenCalledWith(voucher);
  });

  it('shows an empty state instead of a bare message', () => {
    renderTable({ vouchers: [], total: 0 });
    expect(screen.getByText('No vouchers found')).toBeTruthy();
  });
});
```

Run: `bun run test -- src/features/promotions/components/VoucherAdminTable.test.tsx` → FAIL.

- [ ] **Step 2: Implement `VoucherStatusChip.tsx`**

```tsx
import StatusChip from '../../../components/common/StatusChip';
import type { StatusTone } from '../../../components/common/StatusChip';
import { VOUCHER_DISPLAY_STATUS_LABELS } from '../constants';
import type { Voucher } from '../types';
import { voucherDisplayStatus } from '../utils';

const TONES: Record<string, StatusTone> = {
  available: 'success',
  expired: 'warning',
  redeemed: 'info',
  revoked: 'error',
};

export function VoucherStatusChip({
  voucher,
  size = 'small',
}: {
  voucher: Pick<Voucher, 'status' | 'expires_at'>;
  size?: 'small' | 'medium';
}) {
  const display = voucherDisplayStatus(voucher);
  return (
    <StatusChip
      status={display}
      label={VOUCHER_DISPLAY_STATUS_LABELS[display] ?? display}
      tone={TONES[display] ?? 'neutral'}
      size={size}
    />
  );
}
```

- [ ] **Step 3: Rebuild `VoucherAdminTable.tsx`**

Structure (MUI, matching `PromotionAdminTable` conventions):

- `useMediaQuery(theme.breakpoints.down('sm'))` → mobile card list.
- Desktop `Table size="small" sx={{ minWidth: 960 }}` columns: **Voucher** (masked code `Chip` monospace + copy `IconButton` copying `code_masked ?? code` via `navigator.clipboard` w/ local `copiedId` state → check icon + "Copied" tooltip), **Offer** (`promotion_name` + slug caption), **Guest** (`guestDisplayName`), **Status** (`VoucherStatusChip`), **Expires** (`formatPromotionDate` + `relativeExpiryLabel` caption, error color when expired), **Source** (`voucherSourceLabel`), **Issued** (`formatPromotionDate(created_at)`), **Actions** (Visibility `IconButton` "View details" → `onView`; BlockIcon revoke when `canManage && status==='available' && !expired`, `stopPropagation` on both).
- Loading: 5 skeleton `TableRow`s (`Skeleton variant="text"`) — desktop; card skeletons mobile.
- Empty: `TableRow` with `EmptyState` (`ConfirmationNumberOutlinedIcon`, "No vouchers found", description "Try a different search or status filter, or issue a voucher to a guest.").
- `TablePagination` unchanged (server-side, [10,25,50]).
- Row: `hover`, `onClick={() => onView(voucher)}`, `sx={{ cursor: 'pointer' }}`; actions cell wraps in `Box onClick={e => e.stopPropagation()}`.
- Mobile card: `Paper` list item — top row code chip + copy, `VoucherStatusChip`; below: guest, expiry label, offer name; `onClick` → `onView`.

Full file (write it — replaces the whole component):

```tsx
import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import EmptyState from '../../../components/common/EmptyState';
import type { Voucher } from '../types';
import {
  formatPromotionDate,
  guestDisplayName,
  relativeExpiryLabel,
  voucherDisplayStatus,
  voucherSourceLabel,
} from '../utils';
import { VoucherStatusChip } from './VoucherStatusChip';

interface VoucherAdminTableProps {
  vouchers: Voucher[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  isRevoking: boolean;
  onView: (voucher: Voucher) => void;
  onRevoke: (voucherId: number, displayCode: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const COLUMN_COUNT = 8;

function voucherCodeLabel(voucher: Voucher): string {
  return voucher.code_masked ?? voucher.code ?? `#${voucher.id}`;
}

function CodeCell({ voucher }: { voucher: Voucher }) {
  const [copied, setCopied] = useState(false);
  const label = voucherCodeLabel(voucher);
  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(label);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (non-secure context) — nothing useful to show
    }
  };
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        sx={{
          height: 24,
          fontFamily: 'monospace',
          letterSpacing: '0.04em',
          '& .MuiChip-label': { px: 0.75 },
        }}
      />
      <Tooltip title={copied ? 'Copied' : 'Copy code'}>
        <IconButton
          size="small"
          aria-label={copied ? 'Copied' : `Copy voucher code ${label}`}
          onClick={copy}
        >
          {copied ? (
            <CheckIcon fontSize="small" color="success" />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function ExpiryCell({ voucher }: { voucher: Voucher }) {
  const expired = voucherDisplayStatus(voucher) === 'expired';
  const relative = relativeExpiryLabel(voucher.expires_at);
  return (
    <Box>
      <Typography variant="body2">
        {formatPromotionDate(voucher.expires_at) ?? '—'}
      </Typography>
      {relative ? (
        <Typography
          variant="caption"
          sx={{ color: expired ? 'error.main' : 'text.secondary' }}
        >
          {relative}
        </Typography>
      ) : null}
    </Box>
  );
}
```

Then the exported component: skeleton branch (rows of `TableCell`/`Skeleton`), empty branch (`EmptyState` inside a full-width `TableRow`), mobile branch (map vouchers to `Paper` list items containing `CodeCell`, `VoucherStatusChip`, guest, `ExpiryCell`, offer name; whole item clickable → `onView`), and the desktop table per the column spec above, ending with `TablePagination`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run test -- src/features/promotions/components/VoucherAdminTable.test.tsx && bun run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/promotions/components/VoucherStatusChip.tsx hotel-web-fe/src/features/promotions/components/VoucherAdminTable.tsx hotel-web-fe/src/features/promotions/components/VoucherAdminTable.test.tsx
git commit -m "feat(fe): rebuild voucher admin table with status chips and skeletons"
```

---

### Task 4: `VoucherDetailsDrawer`

**Files:**
- Create: `hotel-web-fe/src/features/promotions/components/VoucherDetailsDrawer.tsx`
- Test: `hotel-web-fe/src/features/promotions/components/VoucherDetailsDrawer.test.tsx` (new)

**Interfaces:**
- Consumes: `useAdminVoucher`, `useAdminPromotion`, `useAllRoomTypes`, Task 2–3 utils/components.
- Produces: `<VoucherDetailsDrawer voucherId={number|null} open canManage isRevoking onClose onRevoke={(voucherId, displayCode, reason?) => void} />`

- [ ] **Step 1: Write failing drawer tests** — `VoucherDetailsDrawer.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Promotion, Voucher } from '../types';

const voucherFixture: Voucher = {
  id: 11,
  promotion_id: 2,
  promotion_name: 'Stay longer',
  promotion_slug: 'stay-longer',
  code_masked: '••••AB12',
  status: 'available',
  source: 'admin_issue',
  is_cancellable: true,
  guest_id: 9,
  guest_name: 'Aisha',
  expires_at: '2099-01-01T00:00:00Z',
  claimed_at: '2026-09-01T10:00:00Z',
  created_at: '2026-09-01T10:00:00Z',
};

const promotionFixture: Promotion = {
  id: 2, slug: 'stay-longer', name: 'Stay longer', status: 'published',
  promotion_kind: 'voucher', discount_type: 'percentage', discount_value: 15,
  currency: 'USD', claimed_count: 3, claim_limit: 50, per_guest_limit: 1,
  is_public: true, room_type_ids: [], version: 4,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

const useAdminVoucherMock = vi.fn();
const useAdminPromotionMock = vi.fn();

vi.mock('../hooks/usePromotionAdmin', () => ({
  useAdminVoucher: (id: number | null, enabled?: boolean) =>
    useAdminVoucherMock(id, enabled),
  useAdminPromotion: (id: number | null, enabled?: boolean) =>
    useAdminPromotionMock(id, enabled),
}));

vi.mock('../../rooms/hooks', () => ({
  useAllRoomTypes: () => ({ data: [] }),
}));

import { VoucherDetailsDrawer } from './VoucherDetailsDrawer';

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof VoucherDetailsDrawer>> = {},
) {
  const props = {
    voucherId: 11,
    open: true,
    canManage: true,
    isRevoking: false,
    onClose: vi.fn(),
    onRevoke: vi.fn(),
    ...overrides,
  };
  render(<VoucherDetailsDrawer {...props} />);
  return props;
}

describe('VoucherDetailsDrawer', () => {
  afterEach(() => cleanup());

  it('renders code, status, lifecycle, and offer rules', () => {
    useAdminVoucherMock.mockReturnValue({
      data: voucherFixture,
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({
      data: promotionFixture,
      isLoading: false,
    });
    renderDrawer();
    expect(screen.getByText('••••AB12')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('Aisha')).toBeTruthy();
    expect(screen.getByText('Stay longer')).toBeTruthy();
    expect(screen.getByText(/15% off/)).toBeTruthy();
    expect(screen.getByText('Issued')).toBeTruthy();
    expect(screen.getByText('Expires')).toBeTruthy();
  });

  it('hides revoke for redeemed vouchers', () => {
    useAdminVoucherMock.mockReturnValue({
      data: { ...voucherFixture, status: 'redeemed', redeemed_at: '2026-09-05T00:00:00Z' },
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({ data: promotionFixture, isLoading: false });
    renderDrawer();
    expect(
      screen.queryByRole('button', { name: 'Revoke voucher' }),
    ).toBeNull();
  });

  it('captures a reason and revokes through the inline panel', () => {
    useAdminVoucherMock.mockReturnValue({
      data: voucherFixture,
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({ data: promotionFixture, isLoading: false });
    const { onRevoke } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke voucher' }));
    fireEvent.change(
      screen.getByLabelText('Reason (optional)'),
      { target: { value: 'Duplicate issue' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(onRevoke).toHaveBeenCalledWith(11, '••••AB12', 'Duplicate issue');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `VoucherDetailsDrawer.tsx`**

Structure:

```tsx
import BlockIcon from '@mui/icons-material/Block';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import {
  Alert, Box, Button, Chip, Divider, Drawer, IconButton,
  LinearProgress, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import DateText from '../../../components/common/DateText';
import { useAllRoomTypes } from '../../rooms/hooks';
import { useAdminPromotion, useAdminVoucher } from '../hooks/usePromotionAdmin';
import { formatPromotionDiscount, guestDisplayName, relativeExpiryLabel, voucherDisplayStatus, voucherSourceLabel } from '../utils';
import type { Voucher } from '../types';
import { VoucherStatusChip } from './VoucherStatusChip';
```

Sections inside `<Drawer anchor="right" open onClose PaperProps sx width {xs:'100%',sm:440}>`:

1. **Header** — code chip (monospace) + copy `IconButton` (same copy pattern as `CodeCell`), `VoucherStatusChip`, spacer, close `IconButton` (`aria-label="Close voucher details"`).
2. **Body** (`Box p={2.5}` `Stack spacing={2.5}`):
   - loading → `Skeleton` stack; error → `Alert` + `getQueryErrorMessage`.
   - **Details grid** (`dl`-style rows via helper `InfoRow({label, children})`): Offer (`promotion_name` + slug caption), Guest (`guestDisplayName`), Source (`voucherSourceLabel`), Issued (`DateText dateTime created_at`), and when `is_cancellable === false` a warning `Chip` "Locks booking — non-cancellable".
   - **Lifecycle** — `Typography subtitle2 "Lifecycle"` + vertical list of events w/ small dot icons + label + `DateText dateTime`: Issued (`claimed_at ?? created_at`), Redeemed (`redeemed_at` — only if set), Revoked (`revoked_at` + `revocation_reason`? — reason isn't on the Voucher model! **Check**: `Voucher` model has no `revocation_reason`. Keep row "Revoked" + date only, or add `revocation_reason` to admin projection — it IS in the table. Add `v.revocation_reason` to `VOUCHER_COLUMNS_ADMIN` + `Option<String>` on Voucher → include in Task 1 SQL + model + FE type `revocation_reason?: string | null`.), Expires (`expires_at` + `relativeExpiryLabel`).
   - **Offer rules** — from `promotionQuery`: discount (`formatPromotionDiscount`, `MoneyText` not needed since format includes currency), claim window (`DateText` range), stay window, min/max nights, min subtotal, per-guest limit, room types (map `room_type_ids` → names via `useAllRoomTypes`, join or "All room types"), claim usage `LinearProgress` (`claimed_count/claim_limit`), public/private chip.
   - **Revoke panel** — visible when `canManage && voucherDisplayStatus === 'available'`: button "Revoke voucher" (`color="error" variant="outlined"`) → expands `Stack` w/ `TextField label="Reason (optional)"` + "Confirm revoke" (`color="error" variant="contained"`, disabled `isRevoking`) + "Keep voucher". `onRevoke(voucher.id, codeLabel, reason || undefined)`.
3. Data wiring: `useAdminVoucher(voucherId, open)`; `useAdminPromotion(voucher?.promotion_id ?? null, open && !!voucher)`; `useAllRoomTypes(open)`.
4. `useEffect` on `open` → reset `confirmingRevoke`/`reason`/`copied`.

- [ ] **Step 3: Run tests + typecheck** → PASS/clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fe): voucher details drawer with lifecycle and offer rules"
```

---

### Task 5: `VoucherIssueDialog` rebuild

**Files:**
- Modify: `hotel-web-fe/src/features/promotions/components/VoucherIssueDialog.tsx`
- Test: `hotel-web-fe/src/features/promotions/components/VoucherIssueDialog.test.tsx` (new)

**Interfaces:**
- Produces: same props + `errorMessage?: string | null`; guest picked via `Autocomplete` (needs `Guest` from `src/types/guest.types`); still calls `onIssue(VoucherIssueInput)`.

- [ ] **Step 1: Write failing tests** — `VoucherIssueDialog.test.tsx` mocking `GuestsService` (module `../../../api/guests.service` → `{ GuestsService: { getGuestsPage: vi.fn() } }`):

```tsx
// Key cases:
// - promotion options exclude offers whose claim window closed / limit reached
//   (promotionClaimIssue) — render menu, assert "Closed offer" disabled/absent
// - submitting without guest shows "Choose a guest" error
// - expiry in the past shows "Expiry must be in the future"
// - valid flow emits { promotion_id, guest_id, code: undefined, expires_at: iso }
// - custom code 'ab-12 34cd' normalizes to 'AB1234CD' in payload
```

Use `QueryClientProvider` wrapper (hook for guest search uses `useQuery`).

- [ ] **Step 2: Implement** — full rewrite:

- Promotion `Autocomplete` (or `Select`): `options = promotions`; `getOptionDisabled = (p) => promotionClaimIssue(p) != null`; option render = name + `formatPromotionDiscount` + reason caption when disabled; `TextField label="Offer" required`.
- Guest `Autocomplete<Guest>`: `inputValue` state → `useDeferredValue` → `useQuery(['guests','picker',deferred], () => GuestsService.getGuestsPage({ search: deferred || undefined, page_size: 10 }))` `enabled: open`; `getOptionLabel = (g) => g.nick_name || \`Guest #${g.id}\``; option secondary line `g.email`; `isOptionEqualToValue={(a,b) => a.id === b.id}`; `filterOptions={(x) => x}` (server-side search); `noOptionsText="No guests match"`.
- `guestQuery` key → add `queryKeys.guests.picker`? Check `queryKeys.guests` shape first; reuse an existing pattern if one exists (e.g. `guests.list(params)`). If none fits, inline key `['guests','voucher-picker',deferred]` is acceptable — verify against `queryKeys.ts` conventions during implementation.
- Custom code `TextField`: helper "Optional — 8–64 letters/numbers, generated if blank"; inline error when non-empty and `!/^[A-Za-z0-9]{8,64}$/.test(code.replace(/[\s-]/g,''))`.
- Expiry `datetime-local`: `error` when set and `<= Date.now()` → "Expiry must be in the future"; helper "Leave blank for no expiry".
- `errorMessage` prop → `Alert severity="error"` (mutation errors surfaced by parent).
- Submit: validation order promotion→guest→code→expiry; single `Alert` for client errors (`validationError` state); `Button disabled={isSaving}` label `Issuing…`.

- [ ] **Step 3: Tests + typecheck** → PASS/clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fe): rebuild voucher issue dialog with guest picker and claimable offers"
```

---

### Task 6: `PromotionManagementPage` — shared chrome + drawer wiring + filters

**Files:**
- Modify: `hotel-web-fe/src/features/promotions/pages/PromotionManagementPage.tsx`
- Modify: `hotel-web-fe/src/features/promotions/constants.ts` (if labels map needed)

**Interfaces:**
- Consumes: everything prior.
- Produces: upgraded page; `VOUCHER_FILTERS` gains `expiring_soon`/`expired`.

- [ ] **Step 1: Rewrite page chrome**

- Replace gradient `Box` hero with `<PageHeader kicker="Marketing" title="Promotions & vouchers" subtitle="Create offers, control availability, and track every guest voucher." actions={…}>` — actions = tab-conditional contained `Button` (existing permission gates).
- Replace 3 `Paper` metrics with `StatStrip`:
  - **Promotions tab:** Total matching (`activeTotal`, clears filters on click when filtered), Published (`publishedCountQuery.data?.total` — add `useAdminPromotions({page:1,page_size:1,status:'published'})`), Drafts (same for `draft`), Claims on this page (non-clickable hint "Across loaded page"). Active card highlight when its status filter is applied (`active` prop).
  - **Vouchers tab:** `summaryQuery = useVoucherSummary(canReadVouchers && tab==='vouchers')` → Total, Available (click → `status=available`), Expiring ≤7d (click → `expiring_soon`), Expired (click → `expired`), Redeemed (click → `redeemed`), Discounts given (`formatCurrencyAmount` per `discount_given` entry joined by ' · ', `—` when empty; hint `${redemption_count} redemptions`).
  - `isLoading` → `Skeleton` in value slot (`<Skeleton width={48}/>`).
- `VOUCHER_FILTERS` = `[all, available, expiring_soon, expired, redeemed, revoked]` using `VOUCHER_STATUS_FILTER_LABELS` (build via explicit array — `expired`/`expiring_soon` aren't in `VOUCHER_STATUS_LABELS`).
- Error `Alert` gains `action` retry `Button` → `activeQuery.refetch()`.
- Voucher params: add `promotion_id` state (nullable, set from drawer link) — include in `voucherParams` memo; show a removable `Chip` "Offer: <name>" when set (clears back to unfiltered list). Keep simple: set via drawer "View all vouchers for this offer" button? — cut if it complicates; the param support exists, wire it only if trivial: `const [voucherPromotionFilter, setVoucherPromotionFilter] = useState<number | null>(null)` added to params; clear chip. Include it — it's ~15 lines.

- [ ] **Step 2: Wire drawer + issue success**

- `const [drawerVoucherId, setDrawerVoucherId] = useState<number | null>(null)`.
- Table: `onView={(v) => setDrawerVoucherId(v.id)}`.
- `<VoucherDetailsDrawer voucherId={drawerVoucherId} open={drawerVoucherId != null} canManage={canManageVouchers} isRevoking={revokeMutation.isPending} onClose={() => setDrawerVoucherId(null)} onRevoke={revokeVoucher} />`
- `revokeVoucher(voucherId, displayCode, reason?)` — drop the old `useConfirm` wrapper for the *drawer* path? No — keep confirm for row revoke (no reason); drawer passes reason, skips `useConfirm` (its inline panel already confirmed). Signature stays `(id, label, reason?)`; row passes no reason → keep confirm + default reason text `'Revoked by administrator'`; drawer → `reason` present → call mutation directly. Also `onSuccess` → `setDrawerVoucherId(null)` when the revoked id is the open one? Simpler: keep drawer open, `useAdminVoucher` refetches (invalidate covers `promotions.all` — adminVoucher key is under `promotions`) and status flips to Revoked live. Keep open.
- Issue success: `issueMutation.mutate(input, { onSuccess: (voucher) => { setIssueDialogOpen(false); setDrawerVoucherId(voucher.id); emitApiNotification({message:'Voucher issued',severity:'success'}) } })`.
- Issue dialog: `errorMessage={getQueryErrorMessage(issueMutation.error, null)}` — `getQueryErrorMessage` returns `error.message || fallback`; pass fallback `null`… signature is `(error, fallback='Request failed')` returns string|null — pass `'Unable to issue voucher'` and render only when defined.
- Keep `resetPageForSearch`, `clearFilters` (clear `voucherPromotionFilter` too).

- [ ] **Step 3: Typecheck + lint + full promotions tests**

Run: `bun run typecheck && bun run lint && bun run test -- src/features/promotions`
Expected: clean; all tests pass (update any stale tests that referenced the old table API — `VoucherAdminTable` had no test file previously; `PromotionManagementPage` has none).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fe): premium voucher workspace — metrics, filters, details drawer"
```

---

### Task 7: Full verification

- [ ] `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test` — all green.
- [ ] `cd hotel-app-be && cargo check --all-features && cargo clippy --all-features -- -D warnings && cargo test --all-features` — green; note run count (~209 lib tests without `DATABASE_URL` is expected; if `DATABASE_URL` is set expect ~513).
- [ ] `git status` — only intended files changed; no stray edits to `features/rooms` or `theme.ts`.
- [ ] Manual reasoning pass over the diff: no raw `code` rendered for staff, expired logic consistent between card counts, filter aliases, and `relativeExpiryLabel`.

---

## Self-Review Notes

- **Spec coverage:** summary endpoint ✓ (T1), detail endpoint ✓ (T1), guest_name ✓ (T1+T2), expired + expiring_soon filters ✓ (T1; pill filters T6), PageHeader/StatStrip chrome ✓ (T6), table rebuild ✓ (T3), drawer ✓ (T4), issue dialog ✓ (T5), copy-to-clipboard ✓ (T3/T4), skeleton/empty/error states ✓ (T3/T4/T6), mobile cards ✓ (T3), revoke-with-reason ✓ (T4), openapi regen ✓ (T1), tests ✓ (each task).
- **`revocation_reason`** added to admin projection + Voucher model + FE type (needed by drawer lifecycle section) — captured in Task 1.
- **`promotion_id` filter** added to `PromotionListQuery` + voucher SQL — powers "vouchers for this offer" (drawer → list chip in T6).
- Type consistency: `VoucherSummary`, `VoucherDisplayStatus`, hook names (`useAdminVoucher`, `useVoucherSummary`, `useAdminPromotion`) uniform across tasks.
