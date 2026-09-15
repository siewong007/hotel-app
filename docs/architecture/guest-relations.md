# Guest Relations

Staff-facing CRM workspace: find a guest → understand their situation → take
action → follow up. Lives in `modules/guest_relations/` (backend) and
`src/features/guestRelations/` (frontend). Phase 1 shipped 2026-09-13; Phase 2
(overview dashboard, follow-up queue, list segments, open-issue badge) shipped
2026-09-14. This document is the canonical record — the design specs were
removed after shipping (git history has them if needed).

## Boundary — what the module owns vs links to

| Capability | Canonical owner | Guest Relations role |
|---|---|---|
| Guest profile fields, notes/interactions, preferences, segments | `guests`, `guest_notes`, `guest_preferences` | Owns |
| Guest reviews + staff response | `guest_reviews` | Read + respond |
| Bookings, stays, rooms | `bookings`, front desk | Display + deep link |
| Loyalty tier/points/redemptions | `loyalty_*` | Read-only summary + link to `/loyalty` |
| Vouchers | `vouchers` (promotions) | Read-only list + link to `/promotions` |
| Support conversations | `support_conversations` | Per-guest list + staff-initiated create |
| Communications consent/deliveries | `notification_subscriptions`, `email_deliveries` | Display; consent edits go through the existing `communications` endpoint |
| Payments, folios, balances | ledgers/payments | Outstanding-balance display only |
| Housekeeping/maintenance tasks | housekeeping/maintenance | Not owned — no task engine in GR |

Non-negotiables: no second guest table, no point ledger, no voucher/booking/
payment/campaign engine duplication, no fabricated "inferred" preferences.

## Identity model

- `guests` is the canonical guest identity. `nick_name` is the booking display
  name; `first_name`/`last_name` are the legal name captured at check-in.
  `display_guest_name` (FE mirror: `features/guestRelations/utils.ts`) prefers
  the legal name only when BOTH halves exist.
- `users.guest_id` links a guest-portal login to a guest (portal accounts live
  in `users`, not `guests`).
- `user_guests` = delegation: a user account's right to book/view/modify on
  behalf of a guest (`can_book_for`, `can_view_bookings`, `can_modify`).
- `loyalty_members.guest_id` → `loyalty_memberships` → `loyalty_accounts`.
- `guests.guest_type` (`member`/`non_member`) is a **rate-discount flag, NOT
  loyalty membership** — a naming collision that is documented, not merged.
- `vouchers.guest_id`, `email_deliveries.guest_id`,
  `notification_subscriptions.guest_id`, `support_conversations.guest_id`,
  `guest_notes.guest_id`, `guest_preferences.guest_id`, `guest_reviews` all key
  to `guests.id` — the 360 page is a join surface, not a new identity.

## Endpoints

Module routes (`modules/guest_relations/routes.rs`, merged in
`routes/mod.rs`). Guest-scoped routes hang under the existing `/guests/{id}`
prefix; the spec's `/notes` segment shipped as `/interactions`:

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /guests/{id}/interactions` | `guests:read` | Paged timeline, newest first |
| `POST /guests/{id}/interactions` | `guests:update` | Create note/call/email/in-person/follow-up |
| `PATCH /guests/{id}/interactions/{nid}` | `guests:update` + author-or-`guests:manage` on private rows | Edit / complete follow-up |
| `DELETE /guests/{id}/interactions/{nid}` | same private-row rule | Remove |
| `GET /guests/{id}/preferences` | `guests:read` | Structured preferences by category |
| `PUT /guests/{id}/preferences` | `guests:update` | Upsert entries; `replace_categories` deletes keys absent from the submission |
| `GET /guests/{id}/reviews` | `reviews:read` | Reviews + response state |
| `POST /guests/{id}/reviews/{rid}/response` | `reviews:update` | Staff response |
| `GET /guests/{id}/loyalty` | `guests:read` | Member no., tier, balances, recent redemptions (200 + `null` for non-members) |
| `GET /guests/{id}/vouchers` | `guests:read` | Voucher list w/ status/code/expiry |
| `GET /guests/{id}/communications` | `communications:read` | Deliveries + subscriptions + opt-in flags |
| `GET /guests/{id}/support` | `support:read` | Per-guest conversation list |
| `POST /support/conversations` | `support:write` | Staff-initiated conversation on a guest's behalf (in `modules/support`, not the GR module) |

Phase 2 added two non-guest-scoped routes under the `/guest-relations`
workspace prefix — read-only aggregates over the owning domains' tables:

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /guest-relations/overview` | `guests:read`; the `support` section also needs `support:read`, `reviews` needs `reviews:read` — unauthorized sections are omitted from the payload, never nulled | Dashboard aggregate: `arrivals`, `in_house`, `departures`, `vip_arrivals`, `follow_ups` (due-now) + optional `support` (open / waiting_for_staff counts + items), `reviews` (awaiting response). Each section is a full count + ≤5 preview rows |
| `GET /guest-relations/follow-ups` | `guests:read` | Cross-guest open-follow-up queue in the shared `{data,total,page,page_size}` envelope; `due=overdue\|today\|upcoming\|all` (business-day buckets), `page`, `page_size`. Ordered `follow_up_at ASC`; `is_private` notes visible only to their author or a `guests:manage` holder (the overview's follow-up section always excludes them). Completion reuses `PATCH /guests/{id}/interactions/{nid}` |

Pre-existing guest endpoints extended rather than duplicated: `GET /guests`
grew `vip` / `blacklisted` / `has_open_support` list filters plus a `segment`
filter (`returning` = ≥2 `checked_out`/`completed` stays, `in_house`,
`upcoming`, `inactive` = no completed stay in 365 days — booking-derived
EXISTS/COUNT subqueries, unknown values ignored) in
`repositories/guest.rs::find_paginated`. `has_open_support`
(`support_conversations.status <> 'closed'`) also rides each list row so
unfiltered lists can badge open requests. `GET /guests/{id}/profile` remains
the 360 aggregate.

## Permission model

- `guests:read` → list, profile, non-sensitive fields.
- `guests:update` → profile edits, interactions, preferences.
- `guests:reveal` → `id_*` fields + `date_of_birth` on the profile payload only
  (`GuestSensitiveProfile`). Never in the list payload, never in audit details;
  editing those fields requires `guests:reveal` + `guests:update`.
- `reviews:read`/`reviews:update`, `support:read`/`support:write`/`support:assign`,
  `communications:read`/`communications:manage` gate their tabs and actions
  independently — FE hides a missing-permission tab entirely rather than
  disabling it.
- `is_private` notes are visible/mutable only to their author and
  `guests:manage` holders (mirrored client-side in `InteractionsTab`). The
  follow-up queue enforces the same rule server-side; the overview's due-now
  section never includes private rows.
- `<resource>:manage` implies all actions of that resource (standard RBAC
  rule), so `guests:manage` covers read/update/reveal/delete.

## Frontend surface

- `/guest-relations` → overview dashboard (the Phase 2 landing that replaced
  the redirect): stat cards for arrivals / in-house / departures / VIP
  arrivals plus work queues for open support, reviews awaiting response, and
  follow-ups due. Permission-bound sections render only when the API includes
  them; preview rows deep-link into Guest 360, `/bookings`, `/support`, and
  `/guest-relations/follow-ups`.
- `/guest-relations/guests` — list page: search, segment chips (Phase 1's
  VIP/Blacklisted/Open-requests plus the derived Returning / In-house /
  Upcoming / Inactive set → `segment=` param), CSV export, an "Open request"
  badge on rows where `has_open_support` is true.
- `/guest-relations/follow-ups` — cross-guest queue page (due-filter chips,
  per-row complete via the existing interactions PATCH). No nav entry —
  reached from the dashboard — and bound to its own seeded
  `guest-relations-follow-ups` route-access policy. The sidebar's
  prefix-match (`isNavItemActive`) keeps the Guest Relations item highlighted
  for every `/guest-relations/*` subroute.
- `/guest-relations/guests/$guestId` — Guest 360: header (identity chips,
  quick actions) + tabs Overview / Stays / Preferences / Interactions /
  Loyalty & Vouchers / Support & Feedback / Communication.
- `/guest-config` is retained as a redirect that forwards `?search=`/`?guest_id=`
  to the list (global-search results keep working).
- Service layer: `src/api/guestRelations.service.ts`; hooks:
  `features/guestRelations/hooks/useGuestRelationsQueries.ts`.
- `guest_notes.follow_up_at` is `timestamptz` fed by a hotel-local date picker —
  the FE anchors it at noon hotel-local (`toHotelInstantIso`) so the stored
  instant stays on the picked calendar date in every timezone.
