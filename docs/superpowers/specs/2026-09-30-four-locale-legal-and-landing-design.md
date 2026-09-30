# Four-Locale Legal Corpus + Salim Inn Landing — Design

> Status: pending user review · Date: 2026-09-30

## Goal

The platform speaks four languages — `en`, `ms`, `zh`, `zh-TW` (`LOCALES` in
`src/i18n/locales.ts`, backend `SUPPORTED_LOCALES`, all resource bundles, email
catalogs, `consent_records.locale` CHECK). Two surfaces still offer fewer:

1. **The legal/consent corpus** (`hotel-web-fe/src/features/legal/`) — the only
   place a language toggle shows exactly two options (English / Bahasa Malaysia).
   `LegalLocale = 'en' | 'ms'` is a deliberate PDPA s.7(2) floor (notices must
   exist in Bahasa Malaysia and English); adding zh/zh-TW is additive and keeps
   that guarantee intact.
2. **The salim-inn landing page** (`hotel-web-fe/salim-inn/`) — English-only.
   `content/en.ts` was structured for this phase ("Bahasa Malaysia and Chinese
   versions can be added later (phase 2)").

User decisions: scope = both surfaces; zh-TW gets proper Traditional text (not a
zh fallback); zh/zh-TW translations are drafted here and flagged for
native/legal review, matching the `articles.ms.ts` convention.

## Part 1 — Legal corpus

### Types (`features/legal/content/types.ts`)

- `LegalLocale` becomes `LocaleCode` (all four).
- `LocalizedText` gains **required** `zh` and `'zh-TW'` — a missing translation
  stays a type error, the same guarantee `en`/`ms` have today. Rejected
  alternative: optional zh/zh-TW with English fallback — a consent record would
  claim `zh` while the guest read English, which is false evidence.
- `LEGAL_LOCALES` = all four codes; `LEGAL_LOCALE_LABELS` gains `简体中文` and
  `繁體中文` (en/ms labels unchanged — "Bahasa Malaysia" is the statutory name).
- `localize()` unchanged (`text[locale]`).

### Locale context (`LegalLocaleContext.tsx`)

`useSharedLegalLocale` passes the interface locale straight through — every
supported locale now has corpus text, so a zh/zh-TW reader sees Chinese and the
consent record names it truthfully. No separate legal-locale store (that was
the historical divergence bug the comment warns about).

### Content translation

Add `zh` + `'zh-TW'` to every `LocalizedText`. Files:

- `termsOfService.ts` — 8 sections; `formatStayTime` gains zh/zh-TW branches
  (`下午 3:00` / `上午 11:00` style); its `'en' | 'ms'` annotations widen to
  `LegalLocale`.
- `privacyNotice.ts` — 14 sections.
- `paymentTerms.ts` — 8 sections + `PAYMENT_KEY_POINTS`.
- `ekycConsent.ts` — 5 sections + `EKYC_KEY_POINTS`.
- `consentPrompts.ts` — REGISTRATION/BOOKING/PAYMENT/EKYC prompt labels +
  helpers + `CONSENT_RECORD_NOTE`.
- `consentNotice.ts` — `REGISTRATION_NOTICE` (and any sibling notices).
- `legalLinks.tsx` — `PLACEHOLDER_LABELS` (4 entries).
- `LegalDocumentPage.tsx` — `SIBLING_LINKS` (4 labels).
- `GuestPaymentPanel.tsx` — `{en, ms}` title.
- Any other `{en, ms}` literal the compiler enumerates once the type widens.

Each translated file gets a `DRAFT — pending native/legal review` header note.

### Consent versions — unchanged

Adding zh/zh-TW does not alter the en/ms wording existing consent records pin,
and the new text is fixed at ship time under the same version. No bump, no
re-consent. (Recorded in the summary so the decision is explicit.)

### Backend — no change

`consent_records.locale` CHECK already admits zh/zh-TW (patches 0004, 0007);
`validate_locales`/`preferred_locale` accept and prefer them. Widening
`ConsentAcceptance.locale` (typed `LegalLocale`) widens the wire type, which
the API already accepts.

### Tests

- `noticeConsent.test.ts` — the `['en','ms']` loop iterates `LEGAL_LOCALES`.
- `LegalDocumentPage.test.tsx` — stub documents get zh/zh-TW; assert the toggle
  renders four options and a `简体中文` switch renders Chinese text.
- `ConsentBlock.test.tsx`, `hotelIdentity.test.ts` — `'en' | 'ms'` helpers widen.
- A smoke assertion that every prompt/notice string is non-empty in all four
  locales (the type makes it structural; the test guards blank strings).

### Docs

`docs/reference/i18n-coverage-inventory.md` "Legal corpus" exception row is
rewritten — corpus is now 4-locale. `docs/guides/internationalization.md`
touched only if it still describes the corpus as en/ms.

## Part 2 — salim-inn landing page

### Content model

`src/content/` gains `ms.ts`, `zh.ts`, `zh-TW.ts` (all `Copy`-typed —
`type Copy = typeof en` makes parity a compile error) plus `index.ts`:

- `COPY: Record<Lang, Copy>` with `Lang = 'en' | 'ms' | 'zh' | 'zh-TW'` declared
  in a small local `content/lang.ts` (codes + native names + a `matchLang`
  mirroring the app's zh-Hant→zh-TW / zh-Hans→zh rule). Kept local rather than
  importing `src/i18n/locales.ts`: the Babel `include` in `vite.config.ts`
  deliberately confines the React-compiler pass to `hotel-web-fe/src/`, and the
  landing film is documented as a standalone experience — crossing the boundary
  for a 4-entry constant isn't worth it.
- `resolveLang()`: `?lang=` param → `localStorage.getItem('locale')` (the app's
  own key, so the choice carries into the guest portal) → `navigator.languages`
  via `matchLang` → `'en'`.

### Coverage

`Copy` extends beyond the film chapters to every visible string: nav pills
(sign in / my account / admin console / book direct / play / pause / replay),
preloader, chapters, booking card, mobile CTA, welcome block, trust row, room
cards, gallery captions, amenities, stay panel, FAQ, closing CTA, footer,
noscript-adjacent facts. `index.html` keeps its English markup as the
no-JS/SEO baseline; translatable elements get `data-i18n="<key>"` (and
`data-i18n-html` where the string legitimately contains markup — copy is
authored static data, so innerHTML is safe). Boot applies the resolved copy and
sets `<html lang>`.

### Wiring

- `Chapters.ts` takes the resolved `Copy` (and localized `LABELS`) instead of
  importing `en` directly.
- `main.ts` reads preloader/play/pause/replay labels from the copy.
- `account-actions.js` hardcodes its labels and sits outside the tsconfig —
  it moves to `src/accountActions.ts`, imports the resolved copy, keeps the
  same external-module CSP property (`<script type="module" src="./src/…">`).
- `room-photos.js` is checked for user-visible strings; if it only swaps `src`,
  it stays untouched.

### Language picker

A compact pill `<select>` in `.top-actions` listing the four native names.
Changing it writes `localStorage.locale` and navigates to `?lang=<code>` — a
reload is standard on a marketing page, keeps the choice deterministic and
link-shareable, and rebuilds the film DOM cleanly.

## Out of scope

- The ~699 zh guest-portal residual English strings (documented separate
  translation-quality pass).
- Backend code, DB schema, consent record format, consent versions.
- `room-photos.js` (unless it proves to hold copy) and 3D-scene internals.

## Testing / verification

- `bun run typecheck` — the widened `LocalizedText` must compile with zero
  `{en, ms}`-only literals left.
- `bun run test` — updated legal tests plus the salim-inn `landing.test.ts`
  still green; add a copy-parity assertion if `Copy` typing alone leaves a gap.
- `bun run lint:strict` — `no-restricted-syntax` etc. pass.
- `cargo test --lib` — nothing backend-side changes, but consent validation
  tests confirm zh/zh-TW acceptance (already covered).
- Manual smoke: `/legal/terms` toggle shows 4 options; consent blocks on
  register/booking/eKYC show 4; salim-inn `?lang=zh-TW` renders Traditional.

## Risks

- **Translation quality**: drafted zh/zh-TW legal text is flagged for review;
  consent law wording should get a human pass before relying on it in a
  dispute. Structure and versioning mean swapping wording later is a content
  edit, not a code change (with a version bump at that point).
- **`data-i18n` drift**: a new English string added to `index.html` without a
  key silently stays English in all locales — mitigated by keeping the HTML
  baseline English (never broken, just untranslated).
