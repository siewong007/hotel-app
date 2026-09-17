# i18n coverage inventory

Full-coverage audit for `hotel-web-fe`, produced at the close of the
`feat/i18n-coverage` branch (2026-09-15) and refreshed 2026-09-17 for the
`zh-TW` locale and the namespaces added since. The design spec was removed
with the shipped-plan cleanup (repo rule: plans delete on merge — git
history has it); usage guide:
[guides/internationalization.md](guides/internationalization.md).

- Locales: **en** (source of truth), **ms**, **zh** (`Intl` tag `zh-CN`),
  **zh-TW** (`Intl` tag `zh-TW`; `zh-Hant*` tags resolve here, `zh-Hans*`
  and bare `zh` resolve to `zh`)
- Namespaces: **30** bundles per locale under
  `hotel-web-fe/src/i18n/resources/<locale>/`
- Flattened leaf keys: **en 7,652 · ms 7,596 · zh 7,584 · zh-TW 7,532** —
  ms/zh/zh-TW counts are lower *by design*: `Intl.PluralRules` gives Malay
  and both Chinese locales only the `other` category, so `_one`/`_zero`
  variants legitimately do not exist there. The parity suite accounts for
  this.

## Locale coverage matrix

| Assertion | en | ms | zh | zh-TW | Enforced by |
|---|---|---|---|---|---|
| Every en key exists | — | ✅ | ✅ | ✅ | `resources.test.ts` (`hotel-web-fe/src/i18n/resources.test.ts`) |
| No extra keys | — | ✅ | ✅ | ✅ | same |
| Plural categories render for every count the language produces | ✅ | ✅ | ✅ | ✅ | same |
| Placeholder agreement (no `{{var}}` en does not declare) | ✅ | ✅ | ✅ | ✅ | same |
| No blank values | ✅ | ✅ | ✅ | ✅ | same |
| Every bundle on disk is registered | ✅ | ✅ | ✅ | ✅ | same |
| Every literal `t('…')`/`tOr('…')`/`translate*()`/`statusLabel()` key exists in en | ✅ | — | — | — | `keyUsage.test.ts` (`hotel-web-fe/src/i18n/keyUsage.test.ts`) |
| No un-allowlisted hardcoded JSX text / props | ✅ | — | — | — | `hardcoded.test.ts` (`hotel-web-fe/src/i18n/hardcoded.test.ts`) |
| Server email catalogs | ✅ | ✅ | ✅ | ✅ | `core::i18n` tests (`hotel-app-be/src/core/i18n.rs`) |

The durable gates are the test files — the dev helper
`hotel-web-fe/scripts/i18n-scan.mjs` is advisory (see "Scanner blind spots").

## Namespace × locale key counts

Flattened leaf keys per bundle (generated: `node` script flattening each
`resources/<locale>/<ns>.json` and counting leaves):

| Namespace | en | ms | zh | zh-TW | Primary consumers |
|---|---|---|---|---|---|
| `admin` | 800 | 779 | 779 | 780 | features/admin, features/user |
| `auth` | 276 | 272 | 272 | 272 | features/auth, features/user |
| `bookings` | 518 | 515 | 515 | 514 | features/bookings (+ admin/rooms/dashboard) |
| `channels` | 168 | 168 | 168 | 168 | features/channels, channel surfaces in bookings/rates |
| `common` | 179 | 175 | 175 | 175 | shared chrome, src/components, src/desktop |
| `communications` | 86 | 86 | 86 | 85 | features/communications |
| `dashboard` | 186 | 186 | 186 | 175 | features/dashboard, features/insights |
| `dataTransfer` | 185 | 185 | 185 | 181 | features/admin/data-transfer |
| `ekyc` | 261 | 261 | 261 | 261 | features/ekyc |
| `errors` | 144 | 144 | 144 | 144 | src/api, shared error surfaces |
| `finance` | 523 | 513 | 513 | 513 | features/admin (CustomerLedger), features/invoices |
| `guestPortal` | 978 | 969 | 978 | 966 | features/guestPortal, features/bookings, features/paymentRecovery |
| `guests` | 580 | 580 | 580 | 568 | features/guestRelations |
| `help` | 85 | 85 | 85 | 85 | features/help |
| `housekeeping` | 204 | 204 | 204 | 204 | features/housekeeping |
| `insights` | 209 | 209 | 209 | 209 | features/insights, report catalog |
| `legal` | 11 | 11 | 11 | 11 | features/legal (chrome only — corpus exempt) |
| `loyalty` | 236 | 236 | 236 | 236 | features/loyalty |
| `nav` | 139 | 139 | 139 | 139 | src/navigation, src/components/layout |
| `nightAudit` | 127 | 127 | 125 | 125 | features/admin (night audit) |
| `notifications` | 28 | 28 | 28 | 28 | src/components/layout, features/notifications |
| `onlineInventory` | 114 | 114 | 108 | 107 | features/onlineInventory |
| `promotions` | 271 | 271 | 271 | 263 | features/promotions |
| `rates` | 113 | 113 | 113 | 113 | features/rates |
| `revenue` | 58 | 57 | 57 | 57 | features/revenue |
| `rooms` | 670 | 668 | 655 | 655 | features/rooms (+ housekeeping consumers) |
| `segments` | 99 | 99 | 99 | 97 | features/segments |
| `status` | 259 | 259 | 259 | 259 | status chip/label helpers, enum coverage |
| `support` | 115 | 115 | 115 | 114 | features/support, features/guestRelations |
| `validation` | 30 | 28 | 28 | 28 | src/utils, form validation |

## Key → file usage map

The full map lives in
[i18n-key-usage-map.md](i18n-key-usage-map.md) — every en leaf key with the
source files that reference it, plus the table of dynamic key prefixes
(`t(\`nav.${section}\`)`-style lookups that static call-site scans cannot
expand). It is a point-in-time artifact produced for this audit, not the
output of a checked-in generator — it will drift as keys and call sites
change (a repeatable generator script is deferred follow-up work).

How it was produced: the flattened en leaf-key list (same method as the
namespace counts above) was cross-referenced against call-site searches over
`hotel-web-fe/src` — resolving each file's bound namespaces
(`useTranslation('<ns>')` destructures, trailing-namespace arguments of
`t`/`tOr`/`translate`/`translateFor`/`translateOr`, and `ns:`-prefixed
literals anywhere — including constants maps such as `TIER_TAB_KEYS`),
expanding plural bases to their `_one`/`_other` leaf variants, and recording
`statusLabel(t, 'domain', 'value')` calls as `status:domain.value`.

**~698 keys carry no literal call site.** Spot checks show these are
predominantly:

- enum-coverage keys — `status:*` (≈190 keys) exists for every known enum
  value even where a screen currently resolves it through a dynamic
  `statusLabel(t, domain, runtimeValue)` call;
- code-driven keys — `errors:api.*` resolves `errors:api.${code}` at
  `src/utils/apiNotifications.ts`;
- parameter- or alias-bound translators — `pt()`/`lt()` wrappers
  (guestPortal/legal), `t` passed as a function argument
  (`validateGuestBookingSearch(search, t)`), `tOr` passed to label helpers;
- the dynamic prefixes listed in the map header;
- a residue of genuinely unreferenced vocabulary keys (`common:actions.*`,
  `common:time.*` etc.) kept as shared stock for future screens.

## `tOr` retirement list

`tOr` survives at **24 sites, all dynamic-key lookups** marked
`// intentional:` — the key embeds a runtime DB/enum/registry value, so no
static key can retire it. (Per-site detail: git history of this file and the
i18n-coverage work it records.)

| File | Lookup |
|---|---|
| features/admin/components/CustomerLedger/components/RecordPaymentDialog.tsx | `ledger.paymentMethod.${payment_method}` |
| features/admin/components/NightAuditReportViews.tsx (×3) | `bookings:channels.${category/source}` |
| features/admin/components/data-transfer/TransferHistoryList.tsx | `history.modes.${mode}` |
| features/admin/components/data-transfer/utils.ts + ExportPanel.tsx | `export.exclusions.${reason}` (via `resolve()`) |
| features/support/components/SupportStatusChip.tsx + SupportConversationDetail.tsx + SupportConversationList.tsx | `categories.${category}` (via `supportCategoryLabel`) |
| features/guestRelations/components/tabs/OverviewTab.tsx (×3) | `tourismType.${}` / `preferenceCategories.${}` / `idTypes.${}` |
| features/guestRelations/components/tabs/CommunicationTab.tsx (×2) | `consent.topics.${}` / `communication.channels.${}` |
| features/guestRelations/components/tabs/SupportFeedbackTab.tsx | `support:categories.${}` |
| features/guestRelations/components/InteractionForm.tsx | `interactions.types.${type}` |
| features/guestRelations/components/GuestConsentDialog.tsx | `consent.topics.${topic}` |
| features/guestRelations/components/OpenSupportDialog.tsx | `categories.${value}` |
| features/guestRelations/pages/GuestRelationsFollowUpsPage.tsx | `interactions.types.${}` |
| src/navigation/routeLabels.ts (×3) | `routes.${id}.label` / `.breadcrumb` / `groups.${group}` |
| components/layout/CommandPalette.tsx | `palette.scopes.${g.type}` |
| components/layout/UserMenu.tsx | `roles.${roles[0]}` |

## Duplicates consolidated

Removed this task (verified zero references — no literal, no dynamic prefix,
no bound-namespace resolution anywhere in `src/`):

| Bundle group | Leaves removed | Superseded by |
|---|---|---|
| `guestPortal:checkin.*` flat set + `checkin.wizard.*` + `checkin.claim.*` | 112 (en/zh; 111 ms — `adults_one` legitimately absent) | `checkin.{landing,verify,form,account,details.fields,confirmation}.*` |
| `guestPortal:{tabs,shell.title,signOut,support,dashboard.sections.* (−offers),booking.{nights,room,roomType},offers.{pageEyebrow,guestPortalButton,currentDeals},dashboard.bookings.{viewReceipt,cancellationUnavailable},checkin.{form.submitFailed,continueUpdate}}` | 27 | `nav.*`, `dashboard.bookings.*`, `book.*`, `offers.*` live sets |
| `housekeeping:{statusDialog.*,statusTargetHint.*,drawer.noOpenTasks,errors.updateRoomStatus}` | 14 | `rooms:statusDialog.*` (RoomStatusUpdateDialog binds `rooms`), `housekeeping:roomStatusHint.*` |
| `ekyc:admin.table.view` | 1 | none needed — never read (flagged in task-14 ledger) |

**Total: 154 en leaves removed** (ms/zh pruned in parallel; parity suite
green after each batch).

Near-duplicates reviewed and **kept deliberately**: `bookings:quickEdit.*`
vs `bookings:edit.*` carry different labels per surface ("Remarks" vs
"Notes / Remarks") — contextual, not duplicated. Identical-value pairs noted
in review (`communications:campaigns.new/newTitle`, ms
`testSend/sendTest`) are harmless and retained.

## Documented exceptions

| Exception | Detail |
|---|---|
| Legal corpus | `features/legal/content/*` stays **en/ms only** (PDPA s.7(2)); zh/zh-TW chrome keys exist for parity but are runtime-unreachable — corpus locale set is en/ms via `LegalLocaleContext` (zh and zh-TW both resolve to en). |
| Help corpus | `features/help/content/*` authored en/ms/zh; zh-TW reads the zh article set (`READS_FROM` in `features/help/content/index.ts`); `help` ns chrome is fully translated. |
| PDF bodies | Night-audit and audit-log jsPDF export documents stay **English** — jsPDF's built-in `helvetica` covers Latin-1 only, so zh/ms copy would render as mojibake until a CJK-capable font is embedded via `addFont`. Translated lookups and dates in those paths are pinned to en (`translateFor('en', …)`, `formatHotelDateTime(…, 'en')`); CSV exports are translated. |
| DB/server content | Guest names, room names, rate descriptions, remarks, email bodies — backend email copy is covered by `hotel-app-be/src/core/locales/{en,ms,zh,zh-TW}.json`. |
| `paymentRecovery` in `guestPortal` ns | Public guest-facing route `/booking/recover-payment/$token` shares the portal chrome; documented deviation from the domain→namespace map. |
| zh guestPortal residual English | **699 prose values** remain byte-identical to en (dashboard 376, checkin 112, support 53, offers 27, vouchers 25, payment 24, notifications 23, book 21, preferences 18, smaller groups 20). zh-TW is fully translated (2 residuals). Parity-legal and load-bearing — zh users currently see English on those surfaces; needs a dedicated translation-quality pass. |
| `tOr` survivors | 24 dynamic-key sites, all `// intentional:` — see retirement list above. |
| Scanner blind spots | `i18n-scan.mjs` misses assignment-RHS literals, template-literal values, and call-arg strings beyond `hardcoded.test.ts`'s attribute set; `hardcoded.test.ts` is the durable gate. Its embedded ALLOWLIST is a superset of the scanner's FILE_ALLOWLIST (wider `>` lookbehind catches `⌘K`); both headers carry keep-in-sync notes. |

## Known issues / deferred minors

- `segments:page.activeGuestsMatch` has no plural forms — `count=1` renders
  "1 tetamu aktif sepadan"-style grammar quirk (pre-existing).
- `housekeeping:page.refreshTooltip` is reused as an overflow-menu label —
  key name slightly misleading, kept.
- Nested-fragment interpolation at the edge of the no-concatenation rule:
  `finance:deposit.line.via/ref`, `admin:rbac.summary`,
  `conflictLine`-style composed sub-keys; `'·'`-joined metadata fragments
  (suppression subtitles, MiniList subs, `history.jobRef` trailing `…`).
- `audit.service.ts` PDF export still uses the English `formatStatusLabel`
  humanizer rather than `status:audit.*` keys (PDF English exception
  overlaps).
- `charts/format.ts` `fmtShortDate` and `reportsModel.ts` use day-first
  ordering that reads unnaturally in zh — `Intl.DateTimeFormat` would be
  the correct fix.
- `PortalSupportTab` uses `toLocaleString(undefined)` — ignores the app
  locale (pre-existing).
- `segments`/`import.rowsInEntities`/`export.previewStats` interpolate
  counts without plural forms.
- `admin:table.view` dead key removed; `promotions/constants.ts` dead
  exports (`PROMOTION_STATUS_KEYS`, `VOUCHER_*_KEYS`) remain — nothing
  imports them.
- Bare-`t` labels in `audit.types`/`useApi` do not live-update on locale
  switch unless the caller subscribes via `useTranslation` (acceptable for
  one-shot calls).
- Emphasis regressions where translated strings dropped `<strong>`/`<b>`
  (no `Trans` equivalent in the stack): `revenueStatesNote`,
  `dashboard.ekycStatus`, `createDialog.subtitle`, communications audience
  alerts.

## UX expansion audit (ms ≈ +20–30% vs en; zh denser)

Code-level audit — `bun run start` smoke-checked on :3000 (200 OK); a human
visual pass may follow. Longest-ms-key grep ran per surface group; the
consuming component's wrap/`minWidth`/ellipsis+`Tooltip` tolerance was then
read directly.

| Surface | Longest ms label | Verdict |
|---|---|---|
| Sidebar nav items (`SidebarNavItem`) | `Inventori Dalam Talian` (22) | OK — `noWrap` ellipsis; collapsed rail carries a `Tooltip`. Group captions may wrap, acceptable. |
| Breadcrumbs (`Breadcrumbs`) | `Kawalan Inventori Dalam Talian` (30) | **Fixed** — crumbs were wrappable inside a fixed 56px header; added `noWrap` + `min-width:0` on `li`s so they ellipsize. |
| Mobile bottom nav (`MobileNavBar`) | fallback slots can show `Kelulusan Pembayaran` (20) | **Fixed** — label was `nowrap` with no overflow handling; now ellipsizes within its slot. |
| Guest portal bottom nav (`GuestPortalShell`) | `Malam Percuma` (13) | OK — `overflow:hidden` on the bar, tiny labels. |
| Topbar search field (`AppTopbar`) | `Cari halaman dan tindakan` (25) | OK — `whiteSpace:nowrap` + `textOverflow:ellipsis` already. |
| UserMenu | `Sokongan (Baca Sahaja)` (22) | OK — `noWrap` on name/role; menu items wrap. |
| Dialog action rows | longest button ≈ 30 chars | **Fixed** where ≥3 buttons share a row: `CheckoutInvoiceModal`, `CompanyInvoiceDialog`, `DuplicateLedgerDialog`, `DesktopServiceGate` now `flexWrap:'wrap'`. 2-button rows fine. |
| Tab strips | `Balas kepada tetamu` (19) | OK — `ResponsiveTabs` + all multi-tab strips are `scrollable`/`fullWidth`. |
| Status chips | `Maklumat tambahan diperlukan` (28) | OK — MUI `Chip` labels ellipsize when constrained; tables are auto-layout so columns widen. |
| StickyActionBar / PageHeader | — | OK — truncating summary slot + overflow `ActionsMenu`; headers wrap. |
| Table headers | — | OK — `TableCell` text wraps by default; `nowrap` only on dates/IDs. |

**Surfaces for a human visual pass** (highest residual risk, in order):
guest-portal dashboard (`dashboard.*` zh strings are English — see
exceptions), CheckoutInvoiceModal payment step on ≤360px, housekeeping task
cards with long ms task-type chips, night-audit report views on tablet,
eKYC registration review card.

## Terminology choices (canonical per locale)

| Concept | en | ms | zh | zh-TW |
|---|---|---|---|---|
| Night audit | Night Audit | Audit Malam | 夜审 | 夜間稽核 |
| Housekeeping | Housekeeping | Pengemasan | 客房服务 | 房務 |
| Rate plan | Rate plan | Pelan kadar | 房价计划 | 房價方案 |
| Walk-in | Walk-in | Walk-in | 上门客 | 散客 / 現場散客 |
| No-show | No-show | Tidak hadir | 预订未到 | 未入住 |
| Deposit | Deposit | Deposit | 押金 | 押金 |
| (Company) ledger | Company Ledger | Lejar Syarikat | 公司账本 | 公司帳冊 |
| Folio | Folio | Folio | 账单 | 帳單 |
| eKYC | eKYC | eKYC | eKYC | eKYC / 身分驗證 |
| OTA channel | OTA / channel names | kept in `bookings:channels.*` | 直接预订 / 上门客 etc. | kept in `bookings:channels.*` |
