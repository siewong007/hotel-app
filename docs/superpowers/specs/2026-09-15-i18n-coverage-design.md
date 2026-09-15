# Full UI i18n Coverage — Design Spec (hotel-app)

Date: 2026-09-15
Status: Draft — pending approval

## Goal

Every user-visible label, message, and informational string in
`hotel-web-fe/src` renders through the existing hand-rolled `Intl` i18n system
(ADR 012 in `docs/architecture/ADRS.md` — **no i18next**), with complete
`en` + `ms` + `zh` translations. The
migration vehicle `tOr(key, fallback)` is retired: every `tOr` call site is
replaced by keyed `t` once its key exists in all three locales.

## Current state (verified 2026-09-15)

- Engine, locale registry, store, formatters, switcher all exist and are
  tested (`src/i18n/`, `docs/guides/internationalization.md`).
- 23 namespaces × 3 locales registered; ~4,900 keys per locale; parity,
  plural-category, placeholder-agreement, bundle-registration and key-existence
  tests all green (`resources.test.ts`, `keyUsage.test.ts`).
- `zh` is already a first-class locale end-to-end: `LOCALES`, resource bundles,
  backend `SUPPORTED_LOCALES`, `core/locales/zh.json`, and the
  `consent_records_locale_check` constraint all include it.
- **Gap:** ~1,100 hardcoded string candidates + 50 `tOr` fallbacks across 30
  feature domains and shared chrome. Coverage is concentrated in: `admin`
  (~364 strings), `ekyc` (~180), `loyalty` (~116), `promotions` (~105),
  `dashboard` (~100), `invoices` (~78), `communications` (~44),
  `guestRelations` (~40 + 8 tOr), `components/` (~37), `segments` (~29),
  `guestPortal` (~27 + 27 tOr), `bookings` (~21), `revenue` (~18), `support`
  (~11 + 1 tOr), `onlineInventory` (~9), `user` (~8), `housekeeping` (~5),
  `paymentRecovery` (~4), plus small stragglers elsewhere. Several domains
  (rooms, rates, auth, help, legal pages' chrome, bookings mostly) are already
  migrated — verify-only. Five feature dirs have no `.tsx` (rbac, night-audit,
  data-transfer, customer-ledger, audit-log) — likely `*.ts`-only; checked for
  user-facing literals but expected empty.

## Locked decisions

| Decision | Choice |
|---|---|
| i18n system | Existing hand-rolled `Intl` engine (ADR 012). No new dependency. |
| Locales | `en` (source of truth), `ms`, `zh` (`intlTag: zh-CN`). All already registered; this work *completes* their coverage. |
| `tOr` | Migration vehicle, not end state: convert call sites to `t` as keys land; any `tOr` left at the end is an audited intentional exception. |
| Backend errors | Existing `errors:api.<code>` convention — extend the map for codes seen in the wild; unmapped codes fall back to `errors:api.server_error` + the raw message in dev console. |
| Legal corpus | `features/legal/content/*` stays **en/ms only** — PDPA s.7(2) requires the notice in BM + English; zh interfaces read and record the English notice (existing `LegalLocaleContext` behavior). Only the pages' UI chrome translates. |

## Conventions (binding; details in `docs/guides/internationalization.md`)

- `useTranslation('<ns>')` in components; bare `t`/`tOr` import from
  `src/i18n` only in non-render code.
- `t('ns:key')` crosses namespaces; `{{var}}` interpolation; plurals via
  `_zero`/`_one`/`_other` (`ms` legitimately omits `_one`).
- Reuse `common:*` / `status:*` / `validation:*` for identical concepts;
  feature terms in their own namespace. Never concatenate translated
  fragments.
- Enum/status values: `formatStatusLabel` (statusLabel.ts) or
  `status:*`-style maps — never `replace(/_/g,' ')` (banned by lint:strict).
- Dates via `utils/date.ts`; numbers via `src/i18n` formatters; money via
  `utils/currency.ts` (deliberately not locale-aware).

## Namespace assignment

Existing 23 namespaces stay. New namespaces created only where a domain has
real volume and no fit — each is 3 JSON files + registration in
`resources/index.ts`:

| Domain dir(s) | Namespace |
|---|---|
| components/, navigation/, routes/, guest/, auth/, desktop/, api/, utils/, hooks/, constants/, App.tsx | `common`, `nav`, `errors`, `validation` (existing) |
| admin | `admin` (existing) |
| bookings | `bookings` (existing) |
| guestPortal | `guestPortal` (existing) |
| guests, guestRelations, segments | `guests`, `segments` (existing) |
| rooms, housekeeping | `rooms`, `housekeeping` (existing) |
| rates | `rates` (existing) |
| dashboard, insights | `dashboard` (existing) |
| revenue | `revenue` (existing) |
| invoices, customer-ledger, paymentRecovery | `finance` (existing) |
| night-audit | `nightAudit` (existing) |
| communications | `communications` (NEW) |
| notifications | `notifications` (existing) |
| promotions | `promotions` (NEW) |
| loyalty | `loyalty` (existing) |
| ekyc | `ekyc` (NEW) |
| legal | `legal` (NEW — chrome only; corpus exempt) |
| support, help | `support`, `help` (existing) |
| user | `admin` or `auth` (existing — pick per file) |
| onlineInventory | `onlineInventory` (existing) |
| data-transfer | `dataTransfer` (existing) |
| rbac, audit-log, guest/ misc | `admin` (existing) |

## Enforcement

1. Existing suites keep guarding: `resources.test.ts` (parity/plurals/
   placeholders/registration/no-blank), `keyUsage.test.ts` (every literal
   `t('…')` key exists in en).
2. **New `src/i18n/hardcoded.test.ts`**: walks every `*.tsx` under `src/`
   (excluding `*.test.*`, `i18n/`, generated `routeTree.gen.ts`, `test/`) and
   fails on literal JSX text nodes and literal `placeholder`/`title`/
   `aria-label`/`alt`/`label` attributes not routed through `t`/`tOr`.
   Findings must be empty or listed in an embedded `ALLOWLIST` (brand names,
   currency codes, `N/A`, single glyphs, legal-corpus identifiers, numeric
   formats). This is the durable "no hardcoded strings" gate.
3. `bun run typecheck && bun run lint:strict && bun run test` per task; full
   `bun run build` at the end.

## UX requirements

- Consistent hotel-domain terminology across files: folio, night audit,
  housekeeping status, rate plan, OTA, walk-in, no-show, deposit, ledger,
  eKYC — pick one term per concept per locale and reuse it (record choices in
  the inventory doc).
- `ms` strings run ~20–30% longer than `en`; `zh` is denser (usually fine).
  Audit sidebar, MUI `DataGrid`/`Table` headers, dialog actions, chips, and
  mobile breakpoints after migration; fix layout (wrap/`minWidth`/ellipsis +
  `Tooltip`), never shorten translations unnaturally.
- Language switch updates the whole tree without reload (existing provider
  already does this).

## Intentional exceptions (allowlisted in the audit test)

- Legal corpus content (`features/legal/content/*`) — PDPA en/ms decision.
- DB/server content: guest names, room names, rate descriptions, remarks,
  email subjects/bodies (backend `core/locales` already covers email).
- Brand "the hotel name", currency codes (`MYR`, `RM`), `N/A`, `…`, `×`,
  keyboard glyphs, `routeTree.gen.ts` (generated), `ds-bundle/` (design
  preview package, not shipped app UI).
- Third-party internals: MUI default locale text is imported from MUI locale
  packs where needed; eKYC vendor iframes; browser-native dialogs.
- `console.*`, developer errors (`useAuth must be used within…`), test files.

## Deliverables (final audit)

`docs/i18n-coverage-inventory.md`: full key inventory per namespace, key→file
usage map (grep-generated), locale coverage matrix (parity test output), `tOr`
retirement list, consolidated duplicates, exceptions, UI issues found/fixed.
Plus a one-line update to `docs/guides/internationalization.md` ("Supported
today" → en/ms/zh) and `docs/FEATURES.md` if it lists i18n status.

## Out of scope

- Backend `core/locales/*.json` email copy (zh already present and
  parity-tested — verify only).
- `hotel-desktop` (0 TSX files; Tauri shell reuses the web UI).
- `ds-bundle` design preview package.
- RTL (no RTL locale requested; the provider already supports `dir`).
