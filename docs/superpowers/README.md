# Superpowers plans, specs, and reports

Working artifacts of the plan-driven workflow (plans = task checklists,
specs = design documents, reports = after-action notes). These are
**historical records**: they describe intent at the time of writing and are not
kept in sync with the code. For what the system does today, use the canonical
docs linked from [`../README.md`](../README.md).

Status verified against `master` on 2026-09-15.

## In progress

| Plan | Status |
|---|---|
| `plans/2026-09-14-i18n-zh.md` (+ `specs/2026-09-14-i18n-zh-design.md`) | **In progress** — Simplified Chinese as a third locale + 16-namespace split. Executing in worktree `.worktrees/i18n-zh` (branch `feat/i18n-zh`); ledger `.superpowers/sdd/2026-09-14-i18n-zh/`. Master remains `en` + `ms` — do not document zh as shipped until the branch lands. |
| `plans/2026-09-14-mobile-ux-density.md` (+ spec) | **Partially shipped** — phone-density pass; ledger `.superpowers/sdd/2026-09-14-mobile-ux-density/`. Some items remain open. |

## Shipped (merged to master)

| Plan | Shipped as |
|---|---|
| `2026-09-09-anonymous-booking-nickname` (+ spec) | `guests.nick_name` display names, `guest_name_taken` conflict code |
| `2026-09-09-email-payment-retry-design` (spec only) | `payment_retry` routes/services, `/booking.recover-payment/$token` page |
| `2026-09-10-login-page-redesign-design` (spec only) | Current login page |
| `2026-09-12-online-inventory-grid` (+ spec) | `/online-inventory` + `online_inventory_allocations` |
| `2026-09-13-admin-navigation-redesign` | Task-grouped sidebar nav (front_office / guests / revenue / finance / insights / administration / utility) |
| `2026-09-13-auto-refresh-design` (spec only) | Auto-refresh behaviour |
| `2026-09-13-db-baseline-seed-consolidation` | 22-patch lineage folded into `0001_v1_baseline.sql`; catalog republished from empty |
| `2026-09-13-deposit-checkout-guard-plan` (+ spec) | Checkout deposit guard + `deposit_forfeited` payment type (patch 1.2) |
| `2026-09-13-guest-relations` (+ spec) | `modules/guest_relations`, `/guest-relations/*` — see `architecture/guest-relations.md` |
| `2026-09-13-help-centre-redesign-design` (spec only) | `/help`, `/help/$slug` |
| `2026-09-13-insights-administration-redesign` (spec only) | `/insights` report library, administration nav group |
| `2026-09-13-legacy-deposit-refund-plan` (+ spec) | Deposit refund flow bounded by held deposit |
| `2026-09-13-modernization-pass` | Dependency upgrades — see `DEPENDENCIES.md` §"2026-09-13 modernization changes" |
| `2026-09-13-policy-pages-reading-experience` | `/legal/{terms,privacy,payment-terms,identity-verification}` |
| `2026-09-13-revenue-marketing-phase0-consolidation` … `phase4-segments` (+ `revenue-marketing-redesign-design` spec) | `modules/{revenue,segments}`, `/revenue`, `/rates`, `/campaigns`, `/segments`, `/communications`, `/online-inventory` — promotions moved to `/campaigns` |
| `2026-09-13-room-type-photos` (+ spec) | Room-type images (`room_type_images` tests) |
| `2026-09-13-ui-ux-consolidation` (+ audit + design specs) | Dark-flagship tokens, shared dialogs; residual items tracked in `ongoing-dev.md` |
| `2026-09-13-voucher-module-redesign` (+ spec) | Voucher lifecycle + `/api/admin/vouchers*`, portal claim/options |
| `2026-09-14-bookings-inventory-mobile` (+ spec) | Phone layouts for bookings + online inventory (merge `8da5d69d0`) |
| `2026-09-14-data-transfer-backup-redesign` | `hotel-backup` v3 + staged import pipeline (merge `67d806bd2`) — canonical doc `guides/data-transfer.md` |
| `2026-09-14-deposit-cancel-revert` (+ spec) | Cancel/revert deposit semantics |
| `2026-09-14-deposit-payment-method-plan` (+ spec) | Deposit payment-method handling |
| `2026-09-14-deposit-refund-card` (+ spec) | Refund card in checkout invoice modal |
| `2026-09-14-guest-portal-feedback` | Portal feedback submission (merge `35ce33d38`) |
| `2026-09-14-guest-portal-redesign` (+ spec) | Current guest portal |
| `2026-09-14-guest-relations-p2` (+ spec) | Overview dashboard, follow-up queue — see `architecture/guest-relations.md` |
| `2026-09-14-mobile-ux-overhaul` (+ spec) | Phone-first pass across staff + guest surfaces |
| `2026-09-14-nivo-charts` (+ spec) | All charts on Nivo (`HotelBarChart`/`HotelLineChart`/`HotelPieChart`/`HotelSparkline`); Recharts removed |

## Reports

- `reports/2026-09-14-mobile-ux-report.md` — mobile UX after-action.
- `reports/2026-09-14-nivo-charts-migration.md` — Recharts→Nivo migration record.

Housekeeping rule: when an in-progress plan merges, move its row to "Shipped"
and fold any lasting rationale into the canonical doc — don't leave the plan
describing itself as the source of truth.
