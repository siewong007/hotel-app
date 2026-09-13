# Voucher Module Redesign — Design Spec

Date: 2026-09-13
Status: Approved decisions locked (drawer detail view, additive backend endpoints, shared chrome upgrade)

## Goal

Upgrade the staff-facing voucher management experience inside `features/promotions`
(`/promotions` route, Vouchers tab) to a premium, operationally efficient workspace —
without breaking guest-facing voucher flows (VoucherWallet, VoucherCard, portal claim).

## Domain model (existing, unchanged)

- `promotions` = offer template: discount_type (`percentage`/`fixed_amount`), discount_value,
  max_discount_amount, currency, claim window (`claim_starts_at`/`claim_ends_at`),
  stay window, min/max nights, min_subtotal, claim_limit, claimed_count,
  per_guest_limit (backend enforces =1: one voucher per guest per promotion),
  is_public, is_cancellable, room_type_ids, status (`draft|published|paused|archived`), version.
- `vouchers` = issued code: promotion_id, guest_id (required; UNIQUE(promotion_id, guest_id)),
  code (unique, staff see `code_masked` = `••••` + last4 only), status
  (`available|redeemed|revoked`), source (`guest_claim|admin_issue`), expires_at,
  claimed_at, redeemed_at, revoked_at, revoked_by, revocation_reason, issued_by.
- `voucher_redemptions` = applied/reversed rows w/ gross_subtotal, discount_amount,
  net_total, booking_id. Real revenue-impact data; not currently exposed to admins.

Derived status: a voucher `available` with `expires_at < now` is effectively **Expired**
(displayed state; DB status stays `available`).

## Backend changes (additive only — no behavior change to existing endpoints)

1. `GET /admin/vouchers/summary` (permission `vouchers:read`)
   Response `VoucherSummary`:
   - `total`, `available`, `redeemed`, `revoked` — COUNT(*) grouped by status
   - `expired` — status='available' AND expires_at < now
   - `expiring_soon` — status='available' AND now <= expires_at <= now + 7 days
   - `redemption_count` — COUNT(*) from voucher_redemptions WHERE status='applied'
   - `discount_given` — array of `{ currency, amount }` summed over applied
     redemptions joined to promotions.currency (multi-currency-safe)
2. `GET /admin/vouchers/{id}` (permission `vouchers:read`)
   Returns `Voucher` + `guest_name`. Reuses `PromotionRepository::find_voucher_admin`.
   404 when missing.
3. `guest_name` on voucher list + detail rows — `LEFT JOIN guests g`,
   `TRIM(g.first_name || ' ' || g.last_name)` (precedent exists in codebase).
   Field added to `Voucher` model as `Option<String>`; additive JSON field.
4. `status=expired` accepted as a list filter: service maps `expired` →
   status='available' + `expires_at < now` predicate before `validate_voucher_status`.
   `expired` is NOT a persisted status; `validate_voucher_status` unchanged.

Audit logging: none needed (read-only additions). No schema change → no patch entry.
`docs/api/openapi.json` regenerated via `HOTEL_APP_UPDATE_OPENAPI=1 cargo test
--all-features --test openapi_drift`.

## Frontend changes (all inside `features/promotions` + shared components)

### Shared chrome (both tabs benefit)

- Replace gradient hero with shared `PageHeader`: kicker `MARKETING`, title
  "Promotions & vouchers", subtitle, right-aligned primary CTA switching per tab
  ("Create promotion" / "Issue voucher"), permission-gated as today.
- Replace hand-rolled metric `Paper`s with `StatStrip`:
  - Promotions tab: total matching, published (page-scoped → labeled "on this page"), claims.
  - Vouchers tab (from summary endpoint): Total, Available now, Expiring ≤7d, Expired,
    Redeemed, Discounts given (per-currency). Cards clickable → apply status filter.
- Filter bar: keep search (deferred), add refresh button (exists), status
  `ToggleButtonGroup` incl. **Expired** for vouchers, result count chip, clear filters.
- Error state: `Alert` + retry button calling `refetch()`.

### `VoucherAdminTable` (rebuilt, same props contract + row click)

- Columns: Code (monospace masked chip + copy-to-clipboard icon w/ tooltip + copied
  feedback), Offer (promotion name + discount summary e.g. "15% off" — needs
  promotion fields on list? NO — keep name only; discount shown in drawer),
  Guest (guest_name w/ fallback `#id`), Status (`StatusChip` w/ derived Expired),
  Expires (absolute date + relative urgency line: "in 3 days" / "Expired 2d ago" /
  "No expiry"), Source (`Guest claim`/`Issued by staff`), Issued (created_at date),
  Actions (view details always; revoke icon for available+unexpired, canManage only).
- Skeleton rows during loading (replaces spinner), EmptyState w/ contextual copy
  (filtered vs unfiltered), TablePagination kept (server-side).
- Mobile (<sm): card list layout via `useMediaQuery` — code + status + expiry +
  guest condensed; tap → drawer.
- Row click opens `VoucherDetailsDrawer`.

### `VoucherDetailsDrawer` (new component)

Right `Drawer` (width ~440px, full-width on xs) keyed by voucher id; fetches
`GET /admin/vouchers/{id}` fresh (staleTime short) so revoke state is live.

- Header: masked code + copy button, StatusChip (incl. derived Expired), close.
- Summary strip: promotion name (link-styled button → switches to Promotions tab?
  NO — keep simple text + slug chip), guest name, source, cancellable badge when
  `is_cancellable === false` ("locks booking — non-cancellable").
- Lifecycle timeline: Issued (created_at/claimed_at) → Redeemed (redeemed_at) |
  Revoked (revoked_at + revocation_reason) | Expires (expires_at w/ countdown).
- "Offer rules" section: `GET /admin/promotions/{id}` → discount, currency,
  claim window, stay window, min/max nights, min subtotal, per-guest limit,
  room types (names via `useAllRoomTypes`), public/private, claim limit usage bar.
- Actions footer: Revoke button (destructive, only when available+unexpired+
  canManage). Clicking expands an inline confirm section *inside the drawer*:
  optional reason TextField (maps to `revocation_reason`) + "Revoke voucher"
  destructive button + Cancel — no stacked dialogs.

### `VoucherIssueDialog` (rebuilt)

- Promotion select: published AND currently inside claim window AND under claim
  limit (client-side check mirroring `ensure_admin_issueable`); menu items show
  name + discount + remaining claims; disabled items annotated why.
- Guest: `Autocomplete` using `GuestsService.getGuestsPage({search, page_size:10})`
  debounced; renders name + email; free-solo disabled (backend needs guest_id).
- Custom code field: optional; helper "8–64 letters/numbers; auto-generated if
  blank"; client normalization preview; surface backend Conflict errors
  (duplicate guest/promotion, code taken, claim limit) as human messages.
- Expiry: `datetime-local`, min = now; error if past; helper "Leave blank for no
  expiry". Note `expires_at` semantics = voucher code expiry, not promotion window.
- Success: keep dialog open briefly? NO — close + `emitApiNotification` +
  invalidate (existing), but ALSO show issued masked code in the toast? Toast
  stays simple "Voucher issued"; the new row appears in table (list refetches,
  sorted created_at DESC → visible top). Detail drawer auto-opens on the new
  voucher for immediate copy/verification.

### Copy-to-clipboard

Small `useCopyToClipboard`-style local hook inside feature (check existing utils
first; `src/utils` may already have one — reuse if present). Feedback via icon
swap to check + tooltip "Copied".

### Status handling

`voucherDisplayStatus(voucher, now)` util → `available | redeemed | revoked |
expired` (expired when available && expires_at < now). StatusChip tones:
available=success, redeemed=info, revoked=error, expired=warning. Label always
text (no color-only). `expired` also sent to API as `status=expired` filter.

### Files

- `pages/PromotionManagementPage.tsx` — header/metrics/filters rewrite, drawer wiring.
- `components/VoucherAdminTable.tsx` — rebuild.
- `components/VoucherDetailsDrawer.tsx` — new.
- `components/VoucherIssueDialog.tsx` — rebuild.
- `components/VoucherStatusChip.tsx` — new small wrapper (display status → StatusChip).
- `api/promotionsApi.ts` — `voucherSummary()`, `getVoucher(id)`; types update.
- `hooks/usePromotionAdmin.ts` — `useVoucherSummary`, `useAdminVoucher(id)`.
- `types.ts` — `Voucher.guest_name`, `VoucherSummary`, `VoucherStatus|expired`
  display union `VoucherDisplayStatus`.
- `utils.ts` — `voucherDisplayStatus`, `relativeExpiryLabel`, `sourceLabel`.
- `constants.ts` — `VOUCHER_FILTERS` add expired; tone map.
- `api/queryKeys.ts` — `promotions.adminVoucher(id)`, `promotions.voucherSummary`.
- `index.ts` — unchanged (internals only).

### Tests

- FE: update `PromotionAdminTable.test.tsx`-style tests; new tests for
  `voucherDisplayStatus`/`relativeExpiryLabel` utils, VoucherAdminTable render
  (expired badge, guest_name fallback), VoucherIssueDialog validation,
  drawer render + revoke gating. Existing test files for the table/dialog are
  updated to new contracts.
- BE: unit tests for expired-filter mapping + summary shape where testable
  without DB (status mapping fn); DB-backed paths rely on existing integration
  suite patterns (`#[ignore]`/early-return conventions respected).

## Explicitly out of scope

- Guest portal: VoucherWallet, VoucherCard, OffersPage, portal APIs — untouched.
- PromotionAdminTable columns/behavior — only shared chrome around it changes.
- Editing issued vouchers (no backend capability; deliberately not added —
  revoke+reissue is the lifecycle).
- Deleting vouchers (no concept exists; audit trail preserved).
- Multi-select/bulk actions (revoke-one is the only mutation; bulk adds risk).
- Export/import (no backend support).
- New nav items/routes (drawer keeps IA flat).

## Risks / notes

- `code_masked` is the only staff-visible code — copy action copies masked value;
  acceptable for lookups (search supports exact code match — but masked code is
  not the real code, so copy is mainly for references). Full codes only exist
  guest-side; do not expose.
- `per_guest_limit` hard-cap 1 → issue dialog communicates "each guest can hold
  one voucher per promotion".
- Summary endpoint counts global (unfiltered) — cards act as filter shortcuts.
- `guest_name` join: guests may have null first/last → TRIM/COALESCE, fallback `#id`.
