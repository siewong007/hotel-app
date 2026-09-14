# Guest Relations Phase 2 — Operational Layer

Extends `docs/superpowers/specs/2026-09-13-guest-relations-design.md` §8. Phase 1
(shipped: branch `guest-relations/2026-09-13`, merged at `bf47dbdd1`) built the
guest-scoped workspace. Phase 2 adds the cross-guest operational surface:
the overview dashboard, the follow-up queue, derived list segments, and the
open-issue row badge.

## 1. Scope

- Overview dashboard as the `/guest-relations` landing page (replacing the
  current redirect to `/guest-relations/guests`).
- Cross-guest follow-up queue at `/guest-relations/follow-ups`.
- Derived segments on the guest list (`returning`, `in_house`, `upcoming`,
  `inactive`) alongside the existing Phase 1 chips.
- `has_open_issue` badge on guest list rows (backend flag on the list payload).

Non-goals (unchanged from Phase 1): no new tables, no inferred preferences, no
duplication of bookings/support/reviews business logic — Phase 2 is read-model
aggregation plus links into the owning modules. The only mutation touched is
the existing follow-up completion path.

## 2. Backend

All new code lives in `src/modules/guest_relations/` and mounts two
non-guest-scoped routes in the same module router (merged under `/api`).

### 2.1 `GET /guest-relations/overview` — `guests:read`

One aggregate payload; each section carries `count` plus up to 5 preview items
so the page renders in a single round-trip.

| Section | Source | Definition |
|---|---|---|
| `arrivals` | `bookings` | `check_in = hotel_today()` and status in `confirmed`, `pending_confirmation`, `pending`, `pending_payment` |
| `in_house` | `bookings` | status `checked_in` / `auto_checked_in` |
| `departures` | `bookings` | `check_out = hotel_today()` and status `checked_in` / `auto_checked_in` |
| `vip_arrivals` | `bookings ⋈ guests` | same as `arrivals`, `guests.vip_status` non-null/non-empty |
| `support` | `support_conversations` | `status <> 'closed'`; count plus waiting-for-staff split |
| `reviews` | `guest_reviews` | `response IS NULL` |
| `follow_ups` | `guest_notes` | `follow_up_at <= now()`, `follow_up_completed_at IS NULL` (uses `idx_guest_notes_follow_up_open`) |

Preview items are the minimal link-set: guest id + display name, booking id +
status/dates or conversation number + status or note id + subject + due.

Section-level RBAC: `support` requires `support:read`, `reviews` requires
`reviews:read`; lacking sections are **omitted** from the payload (same
omit-not-null convention as `GuestSensitiveProfile` in Phase 1). Remaining
sections need only `guests:read`.

### 2.2 `GET /guest-relations/follow-ups` — `guests:read`

Paginated cross-guest queue over open follow-ups.

- Query: `due` ∈ `overdue | today | upcoming | all` (default `all`),
  `page`, `page_size`.
  - `overdue`: `follow_up_at < hotel today start`
  - `today`: within the hotel business day
  - `upcoming`: after today
- Row: `note_id`, `guest_id`, `guest_name`, `subject`, `interaction_type`,
  `follow_up_at`, `assigned_to` + resolved `assigned_to_name`, `created_by_name`,
  content snippet (truncated, sanitized fields only — private notes are
  excluded for callers without `guests:manage`, matching Phase 1 visibility).
- Ordering: `follow_up_at ASC` (overdue first).

Completion reuses the Phase 1 `PATCH /guests/{id}/interactions/{nid}` path —
no new mutation endpoint.

### 2.3 Guest list extensions

`GuestListQuery` (`models/guest.rs`) gains:

- `segment: Option<String>` — one of `returning`, `in_house`, `upcoming`,
  `inactive`. Implemented as EXISTS/count subqueries on `bookings`:
  - `returning`: ≥2 bookings in `checked_out`/`completed`
  - `in_house`: ≥1 booking `checked_in`/`auto_checked_in`
  - `upcoming`: ≥1 booking `confirmed`/`pending_confirmation` with
    `check_in >= hotel_today()`
  - `inactive`: zero bookings in `checked_out`/`completed` within the last
    365 days (window fixed; revisit if a settings knob is ever requested)
- `has_open_support: bool` added to the list item payload (the filter existed
  in Phase 1; the flag now also rides each row so the FE can badge unfiltered
  lists). Same `status <> 'closed'` semantics as the filter.

Both stay parameterized; `hotel_today()` for business-day math.

## 3. Seed / patch

No schema change (`idx_guest_notes_follow_up_open` already exists).

- `seed.sql`: repoint `route_access_policies` row `guest-relations` to
  `/guest-relations`; add `guest-relations-follow-ups` (`/guest-relations/follow-ups`, non-nav) +
  expected-table rows.
- Patch `0003_guest_relations_phase2.sql`: idempotent `INSERT … ON CONFLICT` /
  `UPDATE` for those two policy rows. Numbered 0003 — `0002` is reserved for
  the in-flight deposit patch on local master; versions must not collide.
  Register in `manifest.tsv`, `deploy/deploy.sh`, `deploy/deploy-staging.sh`,
  both `deploy*.yml` bundle lists (the catalog test enforces the set).

## 4. Frontend

- `/guest-relations` → `GuestRelationsOverviewPage` (new file route; index.tsx
  stops redirecting). Layout: stat-card row (arrivals / in-house / departures /
  VIP arrivals) then work-queue cards (open support, reviews awaiting,
  follow-ups due) with preview rows linking to Guest 360 / `/support` /
  `/bookings`. Sections degrade per permission via the omitted-section
  contract; page requires `guests:read`.
- `/guest-relations/follow-ups` → `GuestRelationsFollowUpsPage`: table of the
  queue with due-filter chips and a per-row complete action (existing PATCH).
- Guest list: `GuestSegmentChips` gains `returning`/`in_house`/`upcoming`/
  `inactive` mapping to the `segment` param; rows gain an open-issue badge
  (SupportAgent icon chip) when `has_open_support`.
- `routeRegistry`: `guest-relations` nav entry repoints to `/guest-relations`
  (dashboard is the workspace landing); verify sidebar active-state prefix
  matching still highlights for `/guest-relations/guests*` subroutes.
- Service/hooks/types extended in `api/guestRelations.service.ts`,
  `queryKeys.guests`, `useGuestRelationsQueries`.

## 5. Testing

Backend (`tests/guest_relations.rs`, live DB):

- Overview: counts vs seeded fixtures, preview caps, `support`/`reviews`
  sections omitted without their permissions, present with them.
- Follow-ups: due-bucket filtering, ordering, pagination, private-note
  visibility rule.
- Segments: each segment returns the expected fixture set; `has_open_support`
  flag appears on list rows.

Frontend (Vitest):

- Overview renders sections from the aggregate and maps links correctly.
- Follow-ups page maps `due` chips to params and completes a row.
- Segment chips emit `segment=`; badge renders when the flag is true.

Gates unchanged: cargo check/clippy/test (`DATABASE_URL`), openapi drift
regen, FE typecheck/lint/test/build.

## 6. Explicit non-goals

- No caching/materialized views — the aggregates are small EXISTS/COUNT
  queries on indexed columns.
- No segment editor UI — segments are derived, not stored.
- No notification/badge subsystem for due follow-ups (Phase 3 candidate).
- No changes to support/reviews semantics — counts reuse their definitions.
