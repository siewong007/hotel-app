# Internationalisation

How to add a translated string, translate an existing screen, and add a
language. The design rationale is [ADR 012](../architecture/ADRS.md); this file
is the working guide.

Supported today: **English (`en`)** and **Bahasa Melayu (`ms`)**.

## Where things live

| Concern | Location |
|---|---|
| Locale registry (codes, `Intl` tags, native names, direction) | `hotel-web-fe/src/i18n/locales.ts` |
| Translation engine (lookup, plurals, interpolation) | `hotel-web-fe/src/i18n/translator.ts` |
| Active locale, persistence, precedence | `hotel-web-fe/src/i18n/localeStore.ts` |
| Web bundles | `hotel-web-fe/src/i18n/resources/<locale>/<namespace>.json` |
| `Intl` formatters (number, percent, relative time) | `hotel-web-fe/src/i18n/format.ts` |
| Language switcher | `hotel-web-fe/src/components/common/LanguageSwitcher.tsx` |
| Server locale type + negotiation | `hotel-app-be/src/core/i18n.rs` |
| Server catalogs (email copy) | `hotel-app-be/src/core/locales/<locale>.json` |

## Using a translation in a component

```tsx
import { useTranslation } from '../../i18n';

const { t, locale, setLocale } = useTranslation('nav');

t('routes.bookings.label');            // from the bound namespace
t('common:actions.save');              // ns:key crosses namespaces
t('common:count.nights', { count: 3 }); // plural + interpolation
```

Outside React — utils, interceptors, anything without hooks — import the bare
`t` from `src/i18n`. It reads the locale at call time and will not re-render on
its own, which is fine for one-shot calls and wrong for rendered text.

### Migrating a screen that already has hardcoded English

Use `tOr`, which renders the fallback when no bundle defines the key:

```tsx
const { tOr } = useTranslation('guestPortal');
tOr('actions.book', 'Book');
```

The screen keeps reading correctly today, starts speaking Bahasa Melayu the
moment someone adds `actions.book` to the bundles, and never shows a raw key to
a user in between. This is the intended path for rolling i18n through the
remaining feature screens: convert call sites first, add keys as translations
arrive.

## Adding a string

1. Add the key to `resources/en/<namespace>.json`, nested however reads best.
2. Add the same key to **every** other locale. `resources.test.ts` fails if you
   do not, so a half-translated locale cannot ship quietly.
3. Use `{{name}}` for variables. Numbers passed as variables are formatted for
   the locale automatically.

### Plurals

Suffix the key by plural category and pass `count`:

```json
"nights_zero": "No nights",
"nights_one": "{{count}} night",
"nights_other": "{{count}} nights"
```

`_other` is required as the catch-all; `_zero` is optional and wins on exactly
zero. Categories come from `Intl.PluralRules`, so Malay — which has no singular
category — legitimately omits `_one`, and the parity test knows that.

## Adding a language

1. Add an entry to `LOCALES` in `src/i18n/locales.ts` (code, `Intl` tag, native
   name, English name, direction).
2. Create `src/i18n/resources/<code>/` with every namespace, and register the
   imports in `src/i18n/resources/index.ts`.
3. Add `hotel-app-be/src/core/locales/<code>.json` and extend
   `SUPPORTED_LOCALES` and `source_for` in `hotel-app-be/src/core/i18n.rs`.
4. Check the consent locale constraint (`consent_records.locale`) accepts the
   new code — a language offered in the switcher but rejected on write would
   fail a guest's consent submission.

Run `bun run test src/i18n` and `cargo test --lib core::i18n`; both parity
suites will name anything you missed.

An RTL language additionally needs `dir: 'rtl'` in the registry — the provider
already mirrors it onto `<html dir>` — plus a pass over any layout using
directional margins rather than logical properties.

## How the language is chosen

**Web**, highest priority first:

1. an explicit choice in the switcher (persisted to `localStorage`)
2. a default applied via `applyDefaultLocale` (e.g. a guest profile preference)
3. `navigator.languages`
4. `en`

An explicit choice always outranks an inferred one: a guest who picked Bahasa
Melayu is not flipped back to English by a later profile sync.

**Server**, for guest email:

1. `guests.language_preference`
2. the `default_locale` system setting (absent by default; reads fall back to
   `en`, so a database without the row behaves exactly as one set to `en`)
3. `en`

The web client sends `Accept-Language` on every API call
(`src/api/client.ts`). `Locale::from_accept_language` parses it, including
q-values, and is the entry point for the handler that will record a first-time
guest's language — no handler reads it yet.

## Formatting

- **Dates** — `utils/date.ts` (`formatHotelDate`, `formatHotelDateTime`) renders
  in the active interface language, in the hotel's timezone. Do not reach for
  `toLocaleDateString` directly; the hotel-timezone rules in that module are
  the reason it exists.
- **Numbers** — `formatNumber` / `formatPercent` from `src/i18n`.
- **Money** — `utils/currency.ts`, and it is deliberately **not** locale-aware.
  Currency formatting follows the booking's currency code from hotel settings,
  not the reader's interface language; the two must not fight.
- **Server dates in email** — `Locale::format_date`, which reads month
  abbreviations from the catalog. chrono's `%b` is English-only, and four of the
  twelve Malay abbreviations differ (Mac, Mei, Ogo, Okt, Dis).

## What the tests enforce

`src/i18n/resources.test.ts` and the `core::i18n` unit tests both assert that:

- every locale defines every key the default locale does, and no extras
- every plural key can render every count its language can produce
- a translation never interpolates a variable English does not provide (this is
  what catches a `{{nama}}` typo before a guest sees literal braces)
- no entry is blank
- every bundle on disk is registered — an unimported bundle would silently
  serve English

Both suites have been mutation-checked: dropping a key or introducing a
placeholder typo fails them at the intended assertion.
