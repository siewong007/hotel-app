# Admin Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-backed notification center: bell popover + `/notifications` page listing outbox deliveries in All / Transactional / Marketing tabs (tier derived from kind), unread badge = queued+sending, preserving the existing in-app alerts list.

**Architecture:** One read-only backend endpoint (`GET /api/admin/communications/deliveries`) over `email_deliveries` returning masked `DeliverySummary` items + totals + `unread`; frontend feature folder feeds both the existing `NotificationCenter` popover (reworked: server feed tabs + retained in-app "Alerts" tab) and a new full-page route wired through `routeRegistry`.

**Tech Stack:** Axum/sqlx (runtime-checked queries), TanStack Query polling, MUI Badge/Tabs/Chip. No schema change, no patch, no new permissions.

## Global Constraints

Spec: `docs/superpowers/specs/2026-08-26-notification-center-design.md`.
- Raw recipient emails never cross the API — reuse masked `DeliverySummary`.
- Tier derivation lives ONLY in `validation::TRANSACTIONAL_KINDS`; marketing = complement of transactional within known kinds.
- Backend gates verbatim: `cargo clippy --all-features -- -D warnings`; PG integration tests skip without `DATABASE_URL` (house pattern: rooms_housekeeping auth_headers/seed_actor/grant_permission helpers).
- FE gates: `bun run typecheck && bun run lint && bun run test` independently green.
- Route registration: registry-driven only (`navigation/routeRegistry.tsx`); NO src/routes dir.
- Deviation logged here (spec addendum): new nav entry uses `accessControlled: false` + `visibility: 'auth'` to avoid seed.sql route-policy surgery; the endpoint still enforces `communications:read`, so unauthorized staff get an empty/403 surface, not data.
- Existing in-app alerts (utils/notificationStore) are PRESERVED as an extra "Alerts" tab; badge = server `unread`.

---

### Task 1: Backend feed endpoint

**Files:**
- Modify: `hotel-app-be/src/modules/communications/models.rs` (query/response structs)
- Modify: `hotel-app-be/src/modules/communications/repository.rs` (`list_deliveries_page`)
- Modify: `hotel-app-be/src/modules/communications/service.rs` (`list_delivery_feed`)
- Modify: `hotel-app-be/src/modules/communications/handlers.rs` + `routes.rs`

**Interfaces:**
- Produces: `GET /api/admin/communications/deliveries?tier=all|transactional|marketing&status=<str>&page=&page_size=` →
  `{ items: [{...DeliverySummary, tier}], total, unread, page, page_size }`
- Reuses: `DeliveryListResponse` fields style, `DELIVERY_COLUMNS`, `delivery_from_row`, `normalize_page`, `mask_email`.

- [ ] **Step 1: models.rs** — add:
```rust
#[derive(Debug, Deserialize)]
pub struct DeliveryFeedQuery {
    pub tier: Option<String>,   // all|transactional|marketing
    pub status: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryFeedItem {
    #[serde(flatten)]
    pub summary: DeliverySummary,
    pub tier: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DeliveryFeedResponse {
    pub items: Vec<DeliveryFeedItem>,
    pub total: i64,
    pub unread: i64,
    pub page: i64,
    pub page_size: i64,
}
```
Add `pub fn delivery_tier(kind: &str) -> &'static str { if validation::TRANSACTIONAL_KINDS.contains(&kind) { "transactional" } else { "marketing" } }` (models or validation).

- [ ] **Step 2: repository.rs** — `list_deliveries_page(pool, kinds: &[&str], status: Option<&str>, limit, offset) -> Result<(Vec<EmailDelivery>, i64, i64 /*unread*/), ApiError>`:
  - WHERE built dynamically: `kind = ANY($1)`, optional `AND status = $n`;
  - page SELECT (ORDER BY id DESC LIMIT/OFFSET) + `COUNT(*)` same WHERE;
  - separate scalar: `COUNT(*) WHERE status IN ('queued','sending')` (unfiltered);
  - reuse DELIVERY_COLUMNS/delivery_from_row.
- [ ] **Step 3: service.rs** — `list_delivery_feed(pool, tier, status, page, page_size)`:
  - normalize via existing `normalize_page`;
  - tiers: `all` → every kind from kind_check vocabulary minus none (pass NULL to skip filter); `transactional` → TRANSACTIONAL_KINDS; `marketing` → `["campaign","birthday_voucher"]`;
  - map rows → `DeliveryFeedItem { summary (mask_email path reused), tier: delivery_tier(kind) }`;
  - validate tier/status strings (400 on garbage).
- [ ] **Step 4: handlers/routes** — `list_admin_deliveries_handler` mirroring `list_campaign_deliveries_handler` (permission `communications:read`); route inserted in routes.rs admin block near line 39: `.route("/admin/communications/deliveries", get(handlers::list_admin_deliveries_handler))`.
- [ ] **Step 5:** `cargo clippy --all-features -- -D warnings` clean; commit `feat(comms): paged delivery feed for notification center`.

### Task 2: Backend integration tests

**Files:** Create `tests/admin_communications_api.rs` (mirror rooms_housekeeping.rs: TEST_JWT_SECRET + `auth_headers(user_id)`, `seed_actor` 980_xxx block, `grant_permission`, serial lock, DATABASE_URL skip).

- [ ] Cases: 403 without permission; `all` returns mixed seeded kinds with correct `tier` per item + masked recipient (assert no raw local-part); `transactional`/`marketing` filters disjoint & exhaustive over seeds; `unread` counts only queued+sending regardless of tier filter; pagination total/page math; unknown tier → 400.
- [ ] Commit `test(comms): cover admin delivery feed endpoint`.

### Task 3: Frontend service/hooks/types

**Files:** Create `src/features/notifications/{api.ts,types.ts,hooks/useDeliveryFeed.ts,index.ts}`.

- [ ] types: `DeliveryTier='all'|'transactional'|'marketing'`, `DeliveryFeedItem = DeliverySummary & {tier:'transactional'|'marketing'}`, `DeliveryFeedResponse`.
- [ ] api.ts: `listDeliveries(params)` via ky `api.get('admin/communications/deliveries',{searchParams})`.
- [ ] hook: `useDeliveryFeed({tier,status,page}, {pollMs})` — queryKey factory `['notifications','feed',...]`, refetchInterval param (60_000 idle / 15_000 open), staleTime realtime.
- [ ] Gates quick pass; commit `feat(fe): notification center data layer`.

### Task 4: Bell rework (preserve alerts)

**Files:** Modify `src/components/layout/NotificationCenter.tsx` (+ its test), `src/features/notifications/components/DeliveryTabs.tsx` (shared list renderer).

- [ ] Popover gains MUI Tabs: **Alerts** (existing in-app list untouched) | **All** | **Transactional** | **Marketing** (server feed, top 10, status chips, relative time extracted from old private helper into shared util `src/features/notifications/utils/relativeTime.ts`).
- [ ] Badge switches to server `unread` (cap 99); polling 60s closed / 15s open (refetchInterval fn on open state).
- [ ] Existing unit tests updated minimally; new tests: tabs render, tier tab filters items, badge shows server unread.
- [ ] Gates; commit `feat(fe): server-backed priority tabs in the notification bell`.

### Task 5: Full page `/notifications`

**Files:** Create `src/features/notifications/pages/NotificationsPage.tsx` (+ test); Modify `src/navigation/routeRegistry.tsx` (lazy import ~line 90 area + entry after communications ~line 366): `{ id:'notifications', path:'/notifications', visibility:'auth', accessControlled:false, icon: NotificationsIcon, navGroup:'admin', navLabel:'Notifications', breadcrumbLabel:'Notifications', animationType:'fade' }`.
- [ ] Page: header, Tabs (same four), status Select (queued/sending/sent/failed/suppressed/cancelled), paginated table (masked recipient, kind, status chip, relative time), pagination controls.
- [ ] Extend STATUS_COLORS map used by chips with `queued:'info', sending:'warning', sent:'success', suppressed:'default'` (failed/error exists).
- [ ] Tests: renders tabs + rows from mocked feed; pagination buttons fire page change; empty state.
- [ ] Gates; commit `feat(fe): notifications center page`.

### Task 6: Verification + docs

- [ ] BE: full no-DB suite green; with-DATABASE_URL run of `admin_communications_api` green; clippy clean.
- [ ] FE: three gates green.
- [ ] openapi drift guard unaffected (new route must appear!): regenerate `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --test openapi_drift` and commit refreshed `docs/api/openapi.json` in Task 1's commit instead — **fold into Task 1 Step 5**: update spec skeleton so drift guard passes CI on first push.
- [ ] Tracker: append shipped line under P2 (or remove nothing — item wasn't tracked); note follow-ups (per-user read state, staff alerts).
