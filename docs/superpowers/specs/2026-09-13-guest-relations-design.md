# Guest Relations Module — Design Spec

Date: 2026-09-13
Status: Approved (design review)
Scope: Phase 1 implementation; Phase 2 items listed but deferred to a follow-up plan.

## 1. Purpose

Transform the existing guest management page into a Guest Relations workspace: a
central place for staff to find a guest, understand their situation, and act —
without duplicating booking, loyalty, voucher, billing, or housekeeping logic.

Optimized workflow: **find guest → understand situation → take action → follow up.**

## 2. Audit findings (verified against schema and code)

### Identity model

- `guests` is the canonical guest identity. `nick_name` is the booking display
  name; `first_name`/`last_name` are the legal name captured at check-in
  (`display_guest_name` prefers legal name only when BOTH halves exist).
- `users` = login accounts — staff AND guest-portal accounts
  (`users.guest_id` links a portal login to a guest).
- `user_guests` = a user account's right to book/manage on behalf of a guest
  (`can_book_for`, `can_view_bookings`, `can_modify`).
- `loyalty_members.guest_id` → `loyalty_memberships` → `loyalty_accounts`
  (tier, points). "Member management" = the loyalty module.
- `guests.guest_type` (`member`/`non_member`) is a rate-discount flag, NOT
  loyalty membership. Naming collision; document, do not merge.
- `vouchers.guest_id`, `email_deliveries.guest_id`,
  `notification_subscriptions.guest_id` all key to guests already.

### Existing backend

- `routes/guests.rs`: CRUD, paginated list with search (id, names, email,
  phone, IC, company, linked portal username) and filters (`guest_type`,
  `tourism_type`, `missing_tourism`, `missing_info`), `GET
  /guests/{id}/profile` (Guest-360 aggregate: `GuestSummary` metrics, eKYC
  summary, reservations, duplicate candidates), `/guests/{id}/bookings`,
  `/guests/{id}/credits`, link/unlink, upgrade-to-user, portal-account transfer.
- `modules/support`: complete ticketing inbox — queues, SLA due dates,
  assignment, escalation, resolution codes, reopen, categories via
  `support_categories` system setting
  (`["booking","stay","billing","loyalty","technical","other"]`).
  Conversations are guest-portal-originated only; **staff cannot create one on
  a guest's behalf** (`insert_conversation` exists; no staff route calls it).
- `modules/communications`: email campaigns/templates/audience/suppressions;
  per-guest consent `GET|POST /admin/communications/guests/{id}/consent`;
  `notification_subscriptions` + `email_deliveries` keyed by `guest_id`
  (per-guest comms history + consent are queryable today).
- `modules/consent`: versioned legal acceptances (`consent_records`).
- Orphaned schema (no API): `guest_notes` (note_type, is_alert, is_private,
  created_by), `guest_preferences` (category/key/value), `guest_reviews`
  (per-axis ratings + staff `response`/`response_at`/`response_by`),
  `guest_documents`.
- `guests` columns never exposed through the API model: `vip_status`, `tags`,
  `marketing_opt_in`, `communication_preference`, `language_preference`,
  `date_of_birth`, `job_title`, `notes`, `special_requests`, `is_blacklisted`,
  `blacklist_reason`, `id_type/id_number/id_expiry/id_country`,
  `address_line_2`, denormalized `total_stays/total_spend/average_rating`.
- Permissions already seeded: `guests:create/read/update/delete/manage`,
  `reviews:*`, `support:read/write/assign/escalate/manage`,
  `communications:read/compose/send/manage`, `navigation_*:read`.
  Allowed permission actions include `reveal` (seed checklist).

### Existing frontend

- `/guest-config` → `GuestConfigurationPage` (1855-line monolith: stat tiles,
  segment chips, DataTable, `GuestFormDialog`, `GuestProfileDialog`,
  complimentary credits, portal-account mgmt, tourism conversion, CSV export,
  eKYC + booking modals). Nav label "Guests", group `operations`.
- `GuestProfileDialog` = current 360 as a modal (Overview / Reservations /
  Duplicates tabs).
- `GuestsPage.tsx` = dead code (exported from `features/guests/index.ts`,
  never routed or imported).
- `/support`, `/loyalty`, `/communications`, `/promotions` are separate nav
  items — they stay the authoritative management surfaces.
- Segments today are data-quality chips only (member / non / incomplete /
  tourist / missingTourism) computed client-side.

## 3. Domain boundary

| Capability | Canonical owner | Guest Relations role |
|---|---|---|
| Guest identity, profile fields, notes, preferences, interactions | `guests` + `guest_notes` + `guest_preferences` | Owns |
| Booking lifecycle, status, rooms | `bookings`, front desk | Display + link only |
| Loyalty points/tier/redemptions | `loyalty_*` | Read-only summary + link to `/loyalty` |
| Vouchers | `vouchers` (promotions) | Read-only list + link to `/promotions` |
| Support tickets, complaints workflow | `support_conversations` | Per-guest list + staff-initiated create |
| Guest reviews/feedback | `guest_reviews` | Read + staff response |
| Communication consent/history | `notification_subscriptions`, `email_deliveries`, communications module | Display + edit via existing endpoints |
| Payment/refund/folio | ledgers/payments | Outstanding balance display only |
| Housekeeping/maintenance tasks | housekeeping/maintenance | Not owned; no task engine in GR |

Non-negotiables: no second guest table, no duplicate point balance, no
duplicate voucher/booking/payment/campaign engine, no housekeeping task list.

## 4. Schema — patch `0016_guest_relations.sql` (additive, idempotent)

1. `guest_notes` add columns:
   - `subject varchar(255) NULL`
   - `interaction_type varchar(50) NOT NULL DEFAULT 'note'`
     (values: `note`, `call`, `email`, `in_person`, `follow_up`)
   - `booking_id bigint NULL` (FK to bookings, soft-checked in service)
   - `follow_up_at timestamptz NULL`
   - `follow_up_completed_at timestamptz NULL`
   - `assigned_to bigint NULL`
   - indexes: `(guest_id, created_at DESC)`; partial `(follow_up_at) WHERE
     follow_up_at IS NOT NULL AND follow_up_completed_at IS NULL`
2. `guest_preferences`: unique index `(guest_id, category, preference_key)`
   for upsert semantics.
3. `system_settings.support_categories` JSON array += `"service_request"`,
   `"complaint"` (idempotent update of the seeded row).
4. New permission `guests:reveal` — gates `id_*` fields and `date_of_birth`;
   granted to `admin`/`super_admin` role seeds.
5. `route_access_policies` rows for `/guest-relations` and
   `/guest-relations/guests/$guestId` (`guests:read`/`guests:manage`).

Registration obligations (enforced by `tests/postgres_patch_catalog.rs` and
`tests/postgres_patch_lifecycle.rs`): `patches/manifest.tsv`,
`.github/workflows/deploy.yml`, `deploy/deploy.sh`,
`.github/workflows/deploy-staging.yml`, `deploy/deploy-staging.sh`, plus the
four hardcoded spots in `postgres_patch_lifecycle.rs` (two `version BETWEEN 2
AND 16` bounds, expected-revision list, `revisions.len()`). Baseline +
`seed.sql` updated for fresh installs. Never edit a shipped patch.

## 5. Backend — new `src/modules/guest_relations/` domain module

Module layout per AGENTS.md: `mod.rs routes.rs handlers.rs service.rs
repository.rs models.rs validation.rs`. Registered via `.merge()` in
`routes/mod.rs::create_router`. All mutations go through
`services/audit.rs`; free text through `utils/sanitization.rs::Sanitizer`;
`validator` derives on inputs; `hotel_today` for business-day math;
`param!(N)` placeholders.

Endpoints (all under existing `/guests/{id}` and `/support` prefixes):

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /guests/{id}/notes` | `guests:read` | Interactions + notes timeline (paged, newest first) |
| `POST /guests/{id}/notes` | `guests:update` | Create note/interaction (type, subject, body, booking_id, follow_up_at, assigned_to, is_alert, is_private) |
| `PATCH /guests/{id}/notes/{nid}` | `guests:update` | Edit content / complete follow-up |
| `DELETE /guests/{id}/notes/{nid}` | `guests:update` | Remove (soft behavior per repo convention) |
| `GET /guests/{id}/preferences` | `guests:read` | Grouped by category |
| `PUT /guests/{id}/preferences` | `guests:update` | Bulk upsert (category, key, value)[], delete-by-absent-key optional flag |
| `GET /guests/{id}/reviews` | `reviews:read` | Guest reviews + response state |
| `POST /guests/{id}/reviews/{rid}/response` | `reviews:update` | Staff response text |
| `GET /guests/{id}/loyalty` | `guests:read` | Member no., tier, point balances, recent redemptions — read via loyalty repository, no new ledger logic |
| `GET /guests/{id}/vouchers` | `guests:read` | Voucher list w/ status, code, expiry — read-only |
| `GET /guests/{id}/communications` | `communications:read` | Recent deliveries + notification_subscriptions + marketing_opt_in |
| `GET /guests/{id}/support` | `support:read` | Conversations for guest (add `guest_id` filter to staff list query) |
| `POST /support/conversations` | `support:write` | Staff-initiated conversation (guest_id, category incl. `service_request`/`complaint`, subject, message, booking_id, priority, assignee) — reuses `insert_conversation` + first staff message + event |

Extend guest read models:

- `Guest` (single-fetch and profile payloads only — list payload unchanged):
  `vip_status`, `tags`, `job_title`, `notes`, `special_requests`,
  `marketing_opt_in`, `communication_preference`, `language_preference`,
  `is_blacklisted`, `blacklist_reason`.
- `GuestUpdateInput` += same fields (validated; `tags` bounded length/count).
- `id_type/id_number/id_expiry/id_country`, `date_of_birth`: included in the
  profile payload ONLY when caller holds `guests:reveal`; editable only with
  `guests:reveal` + `guests:update`. Never returned by the list endpoint, never
  logged.
- New list filters on `GET /guests`: `vip` (vip_status IS NOT NULL),
  `blacklisted`, `has_open_support` (EXISTS open support_conversations) —
  implemented in `find_paginated` alongside existing filters.

Service-level notes:

- Notes timeline distinguishes confirmed preferences (guest_preferences) from
  staff notes (guest_notes) — never merge them into one stream.
- Support create validates category against enabled `support_categories`
  setting (same path as guest-created).
- No writes to `loyalty_*`, `vouchers`, `bookings`, `email_deliveries` —
  read-only joins.

## 6. Frontend — `src/features/guestRelations/` (Phase 1)

Navigation: `guest-config` nav entry relabeled "Guest Relations", path becomes
`/guest-relations`; `/guest-config` retained as a redirect. Registry +
`route_access_policies` updated together (sidebar reads registry; policies
drive the RBAC admin panel).

Pages:

1. **Guest list** `/guest-relations`
   - Server-side search (existing endpoint fields) + filter chips: Member /
     Non-member / Tourist / Missing info / Missing tourism / VIP / Blacklisted
     / Has open request.
   - Columns: Name (nick + legal), Contact (email/phone), Type + VIP chip,
     Last stay, Next stay, Alerts (open support count, alert notes,
     blacklist), Account status, row actions (View profile, Edit, New booking).
   - DataTable (existing component), skeleton rows, empty state, no-results
     state, error state with retry, pagination, responsive collapse.
2. **Guest 360 page** `/guest-relations/guests/$guestId`
   - Header: display name (legal-preferred), guest id, chips (Member, VIP,
     Returning, Blacklisted warning), email/phone/alt phone, last + next stay,
     quick actions: Edit · New Booking (UnifiedBookingModal) · Add Note ·
     Record Interaction · Open Support Conversation.
   - Tabs (each permission-gated, degraded when lacking):
     - **Overview**: metric tiles (stays, nights, revenue, balance), current /
       upcoming stay card, open items (open support count, follow-ups due,
       unresolved reviews), alerts (blacklist, alert notes, duplicates).
     - **Stays**: reservations table (existing profile payload), link to
       `/bookings` record.
     - **Preferences**: structured editor on `guest_preferences` grouped by
       category + `special_requests` display. Confirmed vs staff-note vs
       inferred are kept visually distinct; no inferred preferences are
       fabricated — only stored data shown.
     - **Interactions**: timeline of `guest_notes` w/ type badge, subject,
       actor, booking link, follow-up indicator; inline add form; complete
       follow-up action.
     - **Loyalty & Vouchers**: tier, member no., balances, recent redemptions,
       vouchers; deep links to `/loyalty`, `/promotions`. Read-only.
     - **Support & Feedback**: conversations (status/queue/priority chips,
       link to `/support`), reviews w/ rating + staff response form.
     - **Communication**: marketing_opt_in + communication_preference +
       notification_subscriptions grid + recent deliveries; edit consent via
       existing staff consent endpoint.
   - `GuestProfileDialog` retained for quick-peek call sites; the 360 page is
     the canonical workspace. (Final keep/replace decision in the plan.)
3. **Decomposition**: `GuestConfigurationPage` (1855 lines) is replaced, not
   edited in place — its create/edit dialog, credits panel, portal-account
   tools, and tourism tools are preserved as components under the new feature.
   `GuestsPage.tsx` dead code deleted.

## 7. Permissions & privacy

- `guests:read` → view list + profile + non-sensitive fields.
- `guests:update` → edit profile, notes/interactions, preferences.
- `guests:reveal` → `id_*` fields + `date_of_birth` (profile payload only).
- `reviews:read`/`reviews:update`, `support:read`/`support:write`,
  `communications:read` gate their tabs/actions independently — tabs hide or
  show an access note when missing.
- `is_private` notes visible only to their author and `guests:manage` holders.
- Sensitive fields never in list payload, search clause, or audit details.

## 8. Phase 2 (deferred — separate plan)

- Guest Relations overview dashboard `/guest-relations` landing: arrivals /
  in-house / departures today (from bookings), open support queue metrics,
  reviews awaiting response, follow-ups due, VIP arrivals.
- Derived segments (returning, VIP, in-house, upcoming, inactive) + segment
  filtering on the list.
- Follow-up queue view across guests.
- `has_open_issue` badge on list rows (backend exists from Phase 1 filter).

## 9. Testing

Backend (requires `DATABASE_URL`; verify by run count not exit code):

- `guest_relations` integration test file: notes CRUD + interaction fields,
  follow-up completion, preferences upsert, reviews list + response,
  loyalty/vouchers/communications/support read endpoints, staff support
  create, `guests:reveal` gating on profile fields, new list filters.
- Patch lifecycle/catalog tests updated (manifest, deploy lists, bounds).
- OpenAPI drift regenerated (`HOTEL_APP_UPDATE_OPENAPI=1 cargo test
  --all-features --test openapi_drift`).

Frontend:

- Vitest: list filter state, notes timeline rendering, preferences editor,
  permission-gated tab visibility, service layer URL/params.
- Gates: `bun run typecheck && bun run lint && bun run test && bun run build`;
  `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`,
  `cargo test --all-features` with `DATABASE_URL`.

## 10. Explicit non-goals

- No marketing automation / campaign builder inside GR.
- No merge of `guests.guest_type` with loyalty membership.
- No new guest identity, point ledger, voucher engine, or task engine.
- No fabrication of "inferred" preferences — only stored data.
- No changes to booking/payment/housekeeping workflows.
