# Guest Relations Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the cross-guest operational layer to Guest Relations: overview dashboard at `/guest-relations`, follow-up queue at `/guest-relations/follow-ups`, derived list segments, and an open-issue row badge.

**Architecture:** Two non-guest-scoped GET routes in `modules/guest_relations` (`/guest-relations/overview`, `/guest-relations/follow-ups`) read-only aggregating bookings/support/reviews/guest_notes. `GuestListQuery` gains a `segment` enum and the list payload gains `has_open_support`. Frontend adds two pages plus chip/badge extensions. No schema changes; one seed patch for route policies.

**Spec:** `docs/superpowers/specs/2026-09-14-guest-relations-p2-design.md` (normative definitions — read it first).

**Tech Stack:** Rust/Axum/SQLx backend; React/TS/MUI/TanStack frontend; Bun.

## Global Constraints

- Backend layout: `modules/guest_relations/{models,repository,service,handlers,routes}.rs`; all routes merged in `src/routes/mod.rs` already — new paths go inside `modules/guest_relations/routes.rs`.
- Business-day math uses `hotel_today(executor)` from `core/db.rs` — never `Utc::now()`/`Local::now()` for "today".
- SQL parameterized; no interpolated user input. Filter `segment`/`due` values through a `match` on known literals — never into SQL strings.
- `guests:read` gates the two new routes; `support` section additionally needs `support:read`, `reviews` needs `reviews:read` — omit sections, never null them (`skip_serializing_if = "Option::is_none"`).
- Open support = `status <> 'closed'` (inbox definition).
- Private notes (`is_private`) are excluded from the follow-ups queue unless the caller is the note's author or holds `guests:manage` — same rule as `list_interactions`.
- Runtime-only SQLx `FromRow` over new column sets needs a live-PostgreSQL test.
- Every new route drifts `docs/api/openapi.json` — regen at Task 5.
- FE: all HTTP via `src/api/client.ts` service pattern; TanStack Query hooks in `useGuestRelationsQueries.ts`; query keys under `queryKeys.guests`; no `toISOString().split` — use `src/utils/date.ts`.
- Dates/times: existing `toHotelDateString`/`formatHotelDate` helpers.
- Patch number is **0003** (`0002` is reserved for the in-flight deposit patch on local master — do not take it).
- Worktree: `.worktrees/guest-relations-p2`, branch `guest-relations-p2/2026-09-14`.

---

### Task 1: `segment` filter + `has_open_support` list flag

**Files:**
- Modify: `hotel-app-be/src/models/guest.rs` (`GuestPaginationParams` ~line 510, `Guest` list struct)
- Modify: `hotel-app-be/src/repositories/guest.rs` (`select_cols` ~line 132, `list_filter_clause` ~line 1330, unit tests ~line 1385)

**Interfaces:**
- Consumes: `GuestPaginationParams` fields `vip`, `blacklisted`, `has_open_support` (existing pattern).
- Produces: `GuestPaginationParams.segment: Option<String>`; `Guest.has_open_support: Option<bool>`; segment values `returning | in_house | upcoming | inactive`.

- [ ] **Step 1: failing unit tests** in `list_filter_clause_tests` (`repositories/guest.rs` bottom):

```rust
#[test]
fn segment_returning_adds_two_completed_stays_clause() {
    let mut p = params();
    p.segment = Some("returning".into());
    let clause = list_filter_clause(&p);
    assert!(clause.contains("checked_out"));
    assert!(clause.contains("completed"));
    assert!(clause.contains(">= 2") || clause.contains(">=2"));
}

#[test]
fn segment_in_house_uses_checked_in_statuses() {
    let mut p = params();
    p.segment = Some("in_house".into());
    let clause = list_filter_clause(&p);
    assert!(clause.contains("checked_in"));
}

#[test]
fn segment_unknown_value_is_ignored() {
    let mut p = params();
    p.segment = Some("nonsense".into());
    assert_eq!(list_filter_clause(&p), "");
}
```

- [ ] **Step 2:** run `cargo test --all-features --lib guest::` — expect the new tests to fail to compile (`segment` field missing). Note `params()` in the test mod constructs `GuestPaginationParams` field-by-field — add `segment: None` there once the field exists.

- [ ] **Step 3: implement**

`models/guest.rs` — add to `GuestPaginationParams` after `has_open_support`:

```rust
    /// Derived segment: "returning" | "in_house" | "upcoming" | "inactive".
    pub segment: Option<String>,
```

Add `pub has_open_support: Option<bool>` to the `Guest` struct's optional tail fields (next to `is_blacklisted`).

`repositories/guest.rs` — in `list_filter_clause`, after the `has_open_support` block:

```rust
    match params.segment.as_deref() {
        Some("returning") => filter_clause.push_str(
            " AND (SELECT COUNT(*) FROM bookings b \
             WHERE b.guest_id = guests.id \
               AND b.status IN ('checked_out', 'completed')) >= 2",
        ),
        Some("in_house") => filter_clause.push_str(
            " AND EXISTS (SELECT 1 FROM bookings b \
             WHERE b.guest_id = guests.id \
               AND b.status IN ('checked_in', 'auto_checked_in'))",
        ),
        Some("upcoming") => filter_clause.push_str(
            " AND EXISTS (SELECT 1 FROM bookings b \
             WHERE b.guest_id = guests.id \
               AND b.status IN ('confirmed', 'pending_confirmation') \
               AND b.check_in_date >= CURRENT_DATE)",
        ),
        Some("inactive") => filter_clause.push_str(
            " AND NOT EXISTS (SELECT 1 FROM bookings b \
             WHERE b.guest_id = guests.id \
               AND b.status IN ('checked_out', 'completed') \
               AND b.check_out_date >= CURRENT_DATE - INTERVAL '365 days')",
        ),
        _ => {}
    }
```

(`CURRENT_DATE` is hotel-local because the pool sets the timezone per connection — verify this assumption holds in `find_paginated`'s call path; if the connection tz is not guaranteed, pass `hotel_today(pool)` in and bind it.)

In `select_cols` (the `find_paginated` projection ~line 132), append to the column list:

```rust
            (EXISTS (SELECT 1 FROM support_conversations sc
                WHERE sc.guest_id = guests.id AND sc.status <> 'closed')) AS has_open_support
```

- [ ] **Step 4:** `cargo test --all-features --lib` — unit tests pass; `cargo check --all-features` clean. The `Guest` row mapping is `FromRow`-ish/manual — confirm `has_open_support` actually lands on the struct (check the row-mapping code in the same file; the runtime mapping test happens in Task 4's live tests).

- [ ] **Step 5: commit**

```bash
git add hotel-app-be/src/models/guest.rs hotel-app-be/src/repositories/guest.rs
git commit -m "feat(guests): segment filter + has_open_support list flag"
```

---

### Task 2: GR repository — overview + follow-ups queries

**Files:**
- Modify: `hotel-app-be/src/modules/guest_relations/models.rs`
- Modify: `hotel-app-be/src/modules/guest_relations/repository.rs`

**Interfaces:**
- Consumes: `bookings` (check_in_date, check_out_date, status, id, guest_id), `guests` (id, nick_name/first_name/last_name, vip_status), `support_conversations` (id, conversation_number, status, subject, priority), `guest_reviews` (id, guest_id, rating, comment?, created_at), `guest_notes` (id, guest_id, subject, content, interaction_type, follow_up_at, follow_up_completed_at, is_private, created_by, assigned_to), `users` (display name for assignee/author).
- Produces:
  - `OverviewResponse { arrivals: Section<ArrivalItem>, in_house: Section<StayItem>, departures: Section<StayItem>, vip_arrivals: Section<ArrivalItem>, support: Option<SupportSection>, reviews: Option<ReviewSection>, follow_ups: Section<FollowUpItem> }` where `Section<T> { count: i64, items: Vec<T> }`.
  - `FollowUpQueueRow { note_id, guest_id, guest_name, subject, interaction_type, follow_up_at, assigned_to, assigned_to_name, created_by_name, snippet }` and `list_follow_up_queue(pool, due: &str, include_private: bool, viewer_id: i64, page, page_size) -> Result<(i64, Vec<FollowUpQueueRow>)>`.
  - `overview(pool, hotel_today: NaiveDate, caps: OverviewCaps) -> Result<OverviewResponse>` where `OverviewCaps { include_support: bool, include_reviews: bool }` lets the service decide which sections to run.

- [ ] **Step 1:** read `models.rs`/`repository.rs` conventions (existing `list_interactions`, `list_support_conversations`, `GuestConsentState`) and the baseline column names for `guest_reviews` (rating/comment/response/created_at) and `support_conversations` (conversation_number, priority, sla_due_at).

- [ ] **Step 2: write models** — serde `Serialize` DTOs:

```rust
#[derive(Debug, Serialize)]
pub struct OverviewSection<T> {
    pub count: i64,
    pub items: Vec<T>,
}

#[derive(Debug, Serialize)]
pub struct OverviewBookingItem {
    pub booking_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub status: String,
    pub room_label: Option<String>,
    pub is_vip: bool,
}

#[derive(Debug, Serialize)]
pub struct OverviewSupportItem {
    pub conversation_id: i64,
    pub conversation_number: String,
    pub guest_id: Option<i64>,
    pub guest_name: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub subject: String,
}

#[derive(Debug, Serialize)]
pub struct OverviewSupportSection {
    pub open: i64,
    pub waiting_for_staff: i64,
    pub items: Vec<OverviewSupportItem>,
}

#[derive(Debug, Serialize)]
pub struct OverviewReviewItem {
    pub review_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub rating: Option<f64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct FollowUpQueueItem {
    pub note_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub subject: Option<String>,
    pub interaction_type: String,
    pub follow_up_at: DateTime<Utc>,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub created_by_name: Option<String>,
    pub snippet: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OverviewResponse {
    pub arrivals: OverviewSection<OverviewBookingItem>,
    pub in_house: OverviewSection<OverviewBookingItem>,
    pub departures: OverviewSection<OverviewBookingItem>,
    pub vip_arrivals: OverviewSection<OverviewBookingItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support: Option<OverviewSupportSection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviews: Option<OverviewSection<OverviewReviewItem>>,
    pub follow_ups: OverviewSection<FollowUpQueueItem>,
}
```

(Adjust field names to actual column names — `guest_reviews` may use `review_text` not `comment`; check baseline ~line 4400 and `list_reviews`.)

- [ ] **Step 3: repository methods.** `overview` runs the section queries with `hotel_today` bound as `$1`; previews `LIMIT 5`. Guest display name: `COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), nick_name, 'Guest #' || g.id)` — match whatever `list_interactions` uses for guest_name if it computes one; otherwise this expression.

Support section (only when `include_support`):

```sql
SELECT sc.id, sc.conversation_number, sc.guest_id,
       COALESCE(NULLIF(TRIM(g.first_name || ' ' || g.last_name), ''), g.nick_name) AS guest_name,
       sc.status, sc.priority, sc.subject
FROM support_conversations sc
LEFT JOIN guests g ON g.id = sc.guest_id
WHERE sc.status <> 'closed'
ORDER BY CASE sc.status WHEN 'waiting_for_staff' THEN 0 ELSE 1 END, sc.updated_at DESC
LIMIT 5
```

plus `COUNT(*) FILTER` for `open` / `waiting_for_staff`.

Follow-ups queue (`list_follow_up_queue`): base WHERE is `n.follow_up_at IS NOT NULL AND n.follow_up_completed_at IS NULL`; `due` bucket adds `n.follow_up_at < $today`, `< $tomorrow` or `>= $tomorrow` (`all` = no extra). Privacy: `AND (n.is_private = false OR n.created_by = $viewer)` when `!include_private`. Snippet: `LEFT(n.content, 160)`. Order `follow_up_at ASC`. Return `(total, items)` with `COUNT(*) OVER()` or a separate count query — match the pagination style `list_interactions` uses.

- [ ] **Step 4:** `cargo check --all-features` + `cargo clippy --all-features -- -D warnings`. No route yet — mark methods `#[allow(dead_code)]` only if the compiler complains; prefer wiring in Task 3 same-session.

- [ ] **Step 5: commit**

```bash
git add hotel-app-be/src/modules/guest_relations/{models.rs,repository.rs}
git commit -m "feat(guest-relations): overview + follow-up queue repository queries"
```

---

### Task 3: GR service + handlers + routes

**Files:**
- Modify: `hotel-app-be/src/modules/guest_relations/{service.rs,handlers.rs,routes.rs}`

**Interfaces:**
- Consumes: Task 2's `overview`, `list_follow_up_queue`; `check_permission(pool, user_id, "support:read")`/`("reviews:read")`/`("guests:read")`; `hotel_today(&pool)`; existing handler auth pattern (see `list_interactions_handler` — extracts user via headers, `require_permission`).
- Produces:
  - `GET /guest-relations/overview` → `overview_handler`
  - `GET /guest-relations/follow-ups` → `follow_ups_handler` with `Query<FollowUpQueueQuery { due, page, page_size }>`

- [ ] **Step 1:** in `service.rs`:

```rust
pub async fn overview(pool: &DbPool, user_id: i64) -> Result<OverviewResponse, ApiError> {
    let today = hotel_today(pool).await?;
    let caps = OverviewCaps {
        include_support: check_permission(pool, user_id, "support:read").await.unwrap_or(false),
        include_reviews: check_permission(pool, user_id, "reviews:read").await.unwrap_or(false),
    };
    GuestRelationsRepository::overview(pool, today, caps).await
}
```

(Match how existing service fns check permissions — read `list_support_conversations` in this file for the exact helper signature; `check_permission` returns `Result<bool, _>` or `bool` — follow it.)

`follow_ups`: resolve `include_private = check_permission(pool, user_id, "guests:manage")`, clamp `page_size` to the module's existing cap (check `list_interactions` for the limit constant).

- [ ] **Step 2:** handlers — thin wrappers: `require_auth` → permission `guests:read` → service → `Json`. Follow `list_interactions_handler` verbatim for auth/error mapping.

- [ ] **Step 3:** routes — append to `routes()`:

```rust
        .route("/guest-relations/overview", get(handlers::overview_handler))
        .route("/guest-relations/follow-ups", get(handlers::follow_ups_handler))
```

- [ ] **Step 4:** `cargo check` + `cargo clippy -D warnings` green. OpenAPI drift expected — regen happens in Task 5.

- [ ] **Step 5: commit**

```bash
git add hotel-app-be/src/modules/guest_relations/{service.rs,handlers.rs,routes.rs}
git commit -m "feat(guest-relations): overview + follow-ups endpoints"
```

---

### Task 4: live-DB integration tests

**Files:**
- Modify: `hotel-app-be/tests/guest_relations.rs`

**Interfaces:**
- Consumes: existing fixture block (`GUEST_*` ids, `grt986` markers, `Self::cleanup` at test start, `session_token`, `call` helpers).
- Produces: tests covering overview shape/permission gating, follow-ups buckets/pagination/privacy, segment filters, `has_open_support` row flag.

- [ ] **Step 1:** extend the fixture seed (inside the existing seed fn, after the support-conversation block):
  - One booking `check_in_date = CURRENT_DATE` status `confirmed` for `GUEST_OPEN_SUPPORT`'s guest... (pick a dedicated fixture guest; mark booking_number `BK-GRT986-P2-%` so cleanup's existing `LIKE 'BK-GRT986-%'` clause still matches).
  - One `checked_in` booking; one `check_out_date = CURRENT_DATE` + `checked_in`; one future `check_in` (`CURRENT_DATE + 7`) `confirmed`; a second completed booking on the returning guest (that guest already has one — verify).
  - One `guest_notes` row `follow_up_at = CURRENT_TIMESTAMP - INTERVAL '1 day'`, `follow_up_completed_at NULL` (overdue), one `+ 1 day` (upcoming), one completed (must NOT appear).
  - One `is_private = true` follow-up authored by `USER_AUTHOR` to prove the queue hides it from other readers.
  - One `guest_reviews` row with `response IS NULL` (a second one may already exist — check fixture).
  - `vip_status = 'gold'` on the arriving guest so `vip_arrivals` is non-empty.
- [ ] **Step 2:** tests:
  - `overview_returns_counts_and_previews` — call `GET /guest-relations/overview` with the manager token; assert `arrivals.count >= 1`, `follow_ups.items` contains the overdue row, `vip_arrivals` non-empty, `support.open >= 1`, `reviews.awaiting` count ≥ seeded.
  - `overview_omits_support_and_reviews_without_permissions` — call with the `noperm`/`reader` token (whichever has `guests:read` but not `support:read`/`reviews:read` — check the fixture roles; `grt986_reader` likely fits, else grant a fresh role); assert JSON body has no `support`/`reviews` keys (not null — absent).
  - `follow_ups_filters_by_due_bucket` — `due=overdue` returns only the overdue note; `due=upcoming` only the upcoming; `due=all` both; `page`/`page_size` respected.
  - `follow_ups_hides_private_notes_from_non_authors` — reader token does not see the private row; author token does.
  - `guest_list_segment_filters` — `POST /guests` list with `segment=returning` contains the two-stay guest and excludes a one-stay guest; `in_house` returns the checked-in fixture; `upcoming` the future booking; `inactive` a guest with no recent stays. Assert `has_open_support` is `true` on the open-support guest's row and `false`/absent on a clean guest.
- [ ] **Step 3:** run against a disposable DB:

```bash
DB=gr_p2_verify
docker exec hotel-db psql -U hotel_admin -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
docker exec -i hotel-db psql -U hotel_admin -d $DB < database/postgres/migrations/0001_v1_baseline.sql
docker exec -i hotel-db psql -U hotel_admin -d $DB < database/postgres/seed.sql
DATABASE_URL="postgres://hotel_admin:hotel_admin_password@127.0.0.1:5432/$DB" \
  cargo test --all-features --test guest_relations
```

(If `hotel-db` container is gone, use `createdb -h 127.0.0.1 -U hotel_admin` from libpq: `PATH="/opt/homebrew/Cellar/libpq/18.6/bin:$PATH"`.)

- [ ] **Step 4:** all tests pass; then commit:

```bash
git add hotel-app-be/tests/guest_relations.rs
git commit -m "test(guest-relations): overview, follow-up queue, segments, list flag"
```

---

### Task 5: seed/patch + openapi + backend gates

**Files:**
- Create: `hotel-app-be/database/postgres/patches/0003_guest_relations_phase2.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`, `hotel-app-be/database/postgres/seed.sql`, `deploy/deploy.sh`, `deploy/deploy-staging.sh`, `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml`, `docs/api/openapi.json` (regen)

**Interfaces:**
- Produces: route policy `guest-relations` repointed to `/guest-relations`; new non-nav policy `guest-relations-follow-ups` → `/guest-relations/follow-ups`.

- [ ] **Step 1:** read the existing `route_access_policies` INSERT in `seed.sql` (~line 1174) and copy the column list. In seed.sql:
  - `UPDATE` the `guest-relations` row's path to `/guest-relations` (edit the INSERT tuple in place).
  - Add `('guest-relations-follow-ups', '/guest-relations/follow-ups', NULL, NULL, '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, false, true)`.
  - Add `'guest-relations-follow-ups'` to `expected_route_access_policies` (~line 253).
- [ ] **Step 2:** `0003_guest_relations_phase2.sql` — idempotent (this catalog runs `_begin.sql` guards; body wrapped like prior patches — read `database/postgres/patches/` history via `git show dab5919a1:hotel-app-be/database/postgres/patches/0019_guest_relations.sql` for the exact DO-block shape):

```sql
UPDATE route_access_policies SET path = '/guest-relations' WHERE route_id = 'guest-relations';
INSERT INTO route_access_policies (route_id, path, label, nav_group, staff_permissions, staff_roles, staff_surfaces, guest_permissions, guest_roles, guest_surfaces, show_in_nav, is_active)
SELECT 'guest-relations-follow-ups', '/guest-relations/follow-ups', NULL, NULL,
       '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
       '[]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, false, true
WHERE NOT EXISTS (SELECT 1 FROM route_access_policies WHERE route_id = 'guest-relations-follow-ups');
```

  - `sha256sum` the file → manifest row `1<TAB>3<TAB>guest-relations-phase2<TAB>sha256:<hash><TAB>0003_guest_relations_phase2.sql`.
  - Add `database/patches/0003_guest_relations_phase2.sql` to the payload/bundle lists in `deploy/deploy.sh`, `deploy/deploy-staging.sh`, `.github/workflows/deploy.yml`, `deploy-staging.yml` (copy the `_end.sql` lines as the template).
- [ ] **Step 3:** openapi regen:

```bash
HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift
git diff --stat docs/api/openapi.json   # expect +2 paths, no churn
```

- [ ] **Step 4:** full gates: `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`, `cargo clippy --all-features --tests -- -D warnings`, then the full suite on the disposable DB (`cargo test --all-features`, PATH must include libpq). Catalog test (`postgres_patch_catalog`) must pass — it cross-checks manifest↔deploy lists. Lifecycle suite is manifest-driven — confirm it still passes (`--test postgres_patch_lifecycle`).
- [ ] **Step 5: commit**

```bash
git add hotel-app-be/database/ deploy/ .github/workflows/ docs/api/openapi.json
git commit -m "chore(db): 0003 route policies for guest-relations phase 2 + openapi"
```

---

### Task 6: FE types + service + hooks

**Files:**
- Modify: `hotel-web-fe/src/types/guestRelations.types.ts`, `hotel-web-fe/src/api/guestRelations.service.ts`, `hotel-web-fe/src/api/queryKeys.ts`, `hotel-web-fe/src/features/guestRelations/hooks/useGuestRelationsQueries.ts`, `hotel-web-fe/src/types/guest.types.ts` (`has_open_support`)

**Interfaces:**
- Produces: `GuestRelationsOverview` (mirrors `OverviewResponse`), `FollowUpQueueItem`, `FollowUpDue` (`'overdue'|'today'|'upcoming'|'all'`), `GuestRelationsService.getOverview()`, `.listFollowUps({due,page,page_size})`; hooks `useGuestRelationsOverview()`, `useGuestFollowUps(due, page)`, `useCompleteFollowUp()` (wraps `useUpdateInteraction` mutation with `{follow_up_completed: true}`).

- [ ] **Step 1:** mirror the backend DTOs in `guestRelations.types.ts` — `support`/`reviews` fields optional (`?:`) since the backend omits them.
- [ ] **Step 2:** service methods via the existing `api` client pattern (read `listSupportConversations` in the service for shape). Follow-ups URL `guest-relations/follow-ups` with `URLSearchParams` (`due`, `page`, `page_size`) — include `due` only when set, booleans never serialized false.
- [ ] **Step 3:** `queryKeys.guests` — add `overview: [...,'overview']` and `followUps: (due,page) => [...,'follow-ups',due,page]`; hooks with `staleTime` matching existing hooks; `useCompleteFollowUp` invalidates `followUps` + `interactions` + `overview`.
- [ ] **Step 4:** `guest.types.ts` — `has_open_support?: boolean` on `Guest`.
- [ ] **Step 5:** `bun run typecheck` green; commit.

```bash
git commit -m "feat(fe): guest-relations overview/follow-ups types, service, hooks"
```

---

### Task 7: Overview page + routing

**Files:**
- Create: `hotel-web-fe/src/features/guestRelations/pages/GuestRelationsOverviewPage.tsx`
- Create: `hotel-web-fe/src/features/guestRelations/components/OverviewSectionCard.tsx`
- Modify: `hotel-web-fe/src/routes/guest-relations/index.tsx` (redirect → page), `hotel-web-fe/src/navigation/routeRegistry.tsx` (entry path `/guest-relations/guests` → `/guest-relations`), `hotel-web-fe/src/routeTree.gen.ts` (regen via `bun run build` or the vite plugin)

**Interfaces:**
- Consumes: `useGuestRelationsOverview`, `StatCard`/`StatStrip`/`PageHeader` from `components/common`, `GUEST_DESIGN` tokens (CSS vars — `color-mix` for alpha, never MUI `alpha()`), compat `Link`/`navigate` (untyped — build path strings manually).
- Produces: overview page rendering stat cards (Arrivals / In house / Departures / VIP arrivals / Open support / Awaiting review / Follow-ups due) with ≤5-item preview lists per section; each preview row links to `/guest-relations/guests/{id}`; section headers link to `/bookings`, `/support`, `/guest-relations/follow-ups` as appropriate.

- [ ] **Step 1:** failing test `GuestRelationsOverviewPage.test.tsx` — mock `useGuestRelationsOverview` (see how `GuestRelationsPage.test.tsx` mocks hooks), assert cards render counts, a preview row navigates to the guest 360 path, and a missing `support` section renders nothing for it.
- [ ] **Step 2:** implement page + section card. Keep it flat: one `PageHeader` ("Guest Relations"), a `StatStrip`/grid of counts, then MUI `Card`s per section with a List of preview rows and a "View all" link. Empty section → friendly empty text, not a crash.
- [ ] **Step 3:** `index.tsx` — replace `Navigate` with the page component import. Registry: repoint `guest-relations` `path` to `/guest-relations` — then check the sidebar active-state matcher highlights `/guest-relations/guests*` subroutes (read `SidebarContent`/`routeRegistry` matching — if it's exact-match only, keep the entry on the longest prefix or add a hidden secondary entry; do not break the existing detail-page highlight).
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun run test -- src/features/guestRelations` green; `bun run build` to regen `routeTree.gen.ts` — commit both.
- [ ] **Step 5: commit**

```bash
git commit -m "feat(fe): guest-relations overview dashboard as /guest-relations landing"
```

---

### Task 8: Follow-ups page

**Files:**
- Create: `hotel-web-fe/src/features/guestRelations/pages/GuestRelationsFollowUpsPage.tsx`
- Create: `hotel-web-fe/src/routes/guest-relations/follow-ups.tsx`
- Modify: `hotel-web-fe/src/features/guestRelations/index.ts` (exports)

**Interfaces:**
- Consumes: `useGuestFollowUps`, `useCompleteFollowUp`, `DataTable` (shared component — read `GuestListTable` for `ColumnDef` usage), `PageHeader`.
- Produces: paginated table (Guest | Subject | Type | Due | Assignee | Snippet | Actions), due-filter chips (`Overdue`/`Today`/`Upcoming`/`All`), per-row Complete button → PATCH `{follow_up_completed: true}` then invalidate; guest name links to 360 page.

- [ ] **Step 1:** failing test — chips map to `due` params; complete button calls the mutation with the right ids; private-flagged rows show a lock icon (the row has no `is_private` field in the queue DTO — if needed add it to the backend row in Task 2; decide in review).
- [ ] **Step 2:** implement; overdue rows tinted (`color-mix` over `var(--hotel-danger)`).
- [ ] **Step 3:** file route `follow-ups.tsx` mounts the page; no nav registry entry (dashboard "View all" links to it) but DO confirm `route_access_policies`/`canOpen` needs no frontend registry row — detail pages aren't in the registry either.
- [ ] **Step 4:** gates green; commit.

```bash
git commit -m "feat(fe): cross-guest follow-up queue page"
```

---

### Task 9: list segments + open-issue badge

**Files:**
- Modify: `hotel-web-fe/src/features/guestRelations/segments.ts`, `GuestSegmentChips.tsx`, `GuestListTable.tsx`, `useGuestStatTotals.ts` (if it aggregates chip counts), `segments.test.ts`

**Interfaces:**
- Consumes: Task 1's `segment` param + `has_open_support` flag.
- Produces: segment keys `returning`, `inHouse`, `upcoming`, `inactive` mapping to `{segment: '<value>'}`; `Guest.has_open_support` badge (SupportAgent icon chip) on list rows.

- [ ] **Step 1:** update `segments.test.ts` first — new keys map to `{segment: 'returning'}` etc.; `guestMatchesSegment` returns `true` for derived segments (server-side only, same as `openRequests` — update the `openRequests` case to actually check `guest.has_open_support === true` now that the flag exists).
- [ ] **Step 2:** implement — extend `GuestRelationsSegment` union, `getGuestRelationsSegmentQueryParams`, `guestMatchesSegment`, `GUEST_RELATIONS_SEGMENTS` labels ('Returning', 'In house', 'Upcoming', 'Inactive'), `GuestRelationsSegmentCounts` + `getGuestRelationsSegmentCounts` (new count inputs: `{segment:'x'}, page_size=1` queries — see `useGuestStatTotals` pattern).
- [ ] **Step 3:** badge in `GuestListTable` — where `is_blacklisted`/VIP chips render, add:

```tsx
{guest.has_open_support && (
  <Chip size="small" icon={<OpenRequestsIcon sx={{ fontSize: 13 }} />} label="Open request"
    sx={{ bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.blue} 10%, transparent)`, color: GUEST_DESIGN.blue, fontWeight: 700 }} />
)}
```

- [ ] **Step 4:** gates (`typecheck`, `lint`, `test -- src/features/guestRelations`); commit.

```bash
git commit -m "feat(fe): derived list segments + open-issue row badge"
```

---

### Task 10: docs + full gates + final review

**Files:**
- Modify: `docs/architecture/guest-relations.md` (new endpoints + Phase 2 status), `docs/architecture/architecture-flow.md` (one line if the GR section mentions scope)
- Verify: `docs/superpowers/specs/2026-09-14-guest-relations-p2-design.md` implemented-vs-spec

- [ ] **Step 1:** doc updates — endpoint table gains the two routes; boundary table unchanged (still read-only joins); note `has_open_support` list flag + segments.
- [ ] **Step 2:** full gates from clean state: BE `check`/`clippy`/`clippy --tests`/full `cargo test` on a FRESH disposable DB (fixture pollution between suite reruns is a known wart — recreate the DB first), FE `typecheck`/`lint`/`test`/`build`, openapi drift clean.
- [ ] **Step 3:** whole-branch self-review: diff `origin/master...HEAD`, check no stray changes, confirm spec coverage.
- [ ] **Step 4: commit**

```bash
git commit -m "docs: guest-relations phase 2 architecture notes"
```
