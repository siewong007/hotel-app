# Four-Locale Legal Corpus + Salim Inn Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer all four platform locales (en, ms, zh, zh-TW) on the two surfaces that still offer fewer — the legal/consent corpus and the salim-inn landing page.

**Architecture:** Legal corpus: widen `LegalLocale` to `LocaleCode` and make `LocalizedText` require all four languages, then fill every literal (the compiler enumerates the sites). Consent versions unchanged — additive translations don't alter what en/ms signers saw, and the new text is fixed at ship time. Salim Inn: extend the `Copy` model to cover every visible string, add `ms`/`zh`/`zh-TW` bundles, resolve `?lang=` → `localStorage('locale')` → `navigator.languages` → `en`, apply via `data-i18n` attributes over the English `index.html` baseline, picker reloads with `?lang=`.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly` for salim-inn), React 19 + MUI (legal), vanilla TS + three.js (salim-inn), Vitest, `bun`.

**Spec:** `docs/superpowers/specs/2026-09-30-four-locale-legal-and-landing-design.md`

## Global Constraints

- `LocalizedText` keeps the no-optional-side rule: `en`, `ms`, `zh`, `'zh-TW'` all **required** — a missing translation is a type error. Never render English while recording a zh/zh-TW consent locale (false evidence).
- Every translated legal file gets a `DRAFT — pending native/legal review` header note (convention: `features/help/content/articles.ms.ts`).
- Consent document **versions unchanged** (`TERMS_OF_SERVICE_VERSION`, `PRIVACY_NOTICE_VERSION`, `PAYMENT_TERMS_VERSION`, `EKYC_CONSENT_VERSION`).
- No backend, DB, route, or wire-format changes — `consent_records.locale` already admits zh/zh-TW.
- zh register: 个人资料 (personal data), 敏感个人资料 (sensitive personal data), 《2010年个人资料保护法令》 (PDPA); zh-TW: 個人資料, 敏感個人資料, 《2010年個人資料保護法令》. Proper Traditional — not a zh share.
- salim-inn must not import from `hotel-web-fe/src/` (the Babel `include` confines the React-compiler pass there by design) — it gets a local `lang.ts`.
- Shared localStorage key is `locale` — the landing choice carries into the guest portal.
- Gates, run from `hotel-web-fe/`: `bun run typecheck`, `bun run lint:strict`, `bun run test` (vitest serially — concurrent runs starve timeouts). Commit per task.
- `features/legal/content/**` is already excluded from `hardcoded.test.ts` — translated literals there are safe.

---

### Task 1: Widen `LegalLocale`/`LocalizedText`; translate all short-form sites

**Files:**
- Modify: `src/features/legal/content/types.ts`
- Modify: `src/features/legal/LegalLocaleContext.tsx`
- Modify: `src/features/legal/content/consentPrompts.ts`
- Modify: `src/features/legal/content/consentNotice.ts`
- Modify: `src/features/legal/components/legalLinks.tsx`
- Modify: `src/features/legal/components/LegalDocumentPage.tsx` (`SIBLING_LINKS`)
- Modify: `src/features/guestPortal/components/GuestPaymentPanel.tsx` (the `{en, ms}` title)

**Interfaces:**
- Produces: `LegalLocale = LocaleCode`; `LocalizedText { en; ms; zh; 'zh-TW' }`; `LEGAL_LOCALES: readonly LocaleCode[]`; `LEGAL_LOCALE_LABELS: Record<LegalLocale, string>` — every later task relies on these.

- [ ] **Step 1: Update `types.ts`**

```ts
import type { LocaleCode } from '../../../i18n';

export type LegalLocale = LocaleCode;

export const LEGAL_LOCALES: readonly LegalLocale[] = ['en', 'ms', 'zh', 'zh-TW'] as const;

export const LEGAL_LOCALE_LABELS: Record<LegalLocale, string> = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: '简体中文',
  'zh-TW': '繁體中文',
};

export interface LocalizedText {
  en: string;
  ms: string;
  zh: string;
  'zh-TW': string;
}
```

Update the file-header comment: the corpus now carries all four interface
languages; en + ms remain the PDPA s.7(2) pair.

- [ ] **Step 2: Update `LegalLocaleContext.tsx`**

`useSharedLegalLocale` becomes a pass-through — every supported locale now has
corpus text, and the consent record names the language actually read:

```ts
const locale: LegalLocale = interfaceLocale;
```

Update the doc comment accordingly (drop the "ships only the two PDPA
languages" paragraph; keep the single-source-of-truth rationale).

- [ ] **Step 3: Translate `consentPrompts.ts`**

Add `zh` + `'zh-TW'` to every `label`/`helper` and `CONSENT_RECORD_NOTE` —
`REGISTRATION_CONSENTS` (3 prompts), `BOOKING_CONSENTS` (3), `PAYMENT_CONSENTS`
(1), `EKYC_CONSENTS` (1). Keep `{terms}`/`{privacy}`/`{payment}`/`{ekyc}`
placeholders verbatim inside the Chinese strings. Reference translations:

```ts
// registration — terms
zh: '我已阅读并同意{terms}。',
'zh-TW': '我已閱讀並同意{terms}。',
// registration — privacy
zh: '我已阅读{privacy}，并同意按其中所述处理我的个人资料。',
'zh-TW': '我已閱讀{privacy}，並同意按其中所述處理我的個人資料。',
// privacy helper (PDPA s.7 attribution)
zh: '本通知依据《2010年个人资料保护法令》第7条向您发出。',
'zh-TW': '本通知依據《2010年個人資料保護法令》第7條向您發出。',
// marketing label
zh: '可选：通过电子邮件向我发送优惠与消息。',
'zh-TW': '可選：透過電子郵件向我發送優惠與消息。',
// payment consent
zh: '我已阅读并接受{payment}，并授权支付所示金额。',
'zh-TW': '我已閱讀並接受{payment}，並授權支付所示金額。',
// eKYC consent (explicit, s.40)
zh: '我明确同意{ekyc}：仅为核实我的身份而处理我的身份证件及面部影像（生物识别资料）。',
'zh-TW': '我明確同意{ekyc}：僅為核實我的身分而處理我的身分證件及面部影像（生物識別資料）。',
// CONSENT_RECORD_NOTE
zh: '我们会记录您同意内容的日期、时间与版本，以便双方保有可靠记录。',
'zh-TW': '我們會記錄您同意內容的日期、時間與版本，以便雙方保有可靠記錄。',
```

- [ ] **Step 4: Translate `consentNotice.ts`** — `REGISTRATION_NOTICE.text`:

```ts
zh: '创建账户并使用本服务，即表示您同意{terms}并知悉{privacy}，其中说明了您的个人资料将如何被处理。',
'zh-TW': '建立帳戶並使用本服務，即表示您同意{terms}並知悉{privacy}，其中說明了您的個人資料將如何被處理。',
```

- [ ] **Step 5: Translate `legalLinks.tsx` `PLACEHOLDER_LABELS` (4 entries)**

```ts
'{terms}':   zh '预订条款与条件'    'zh-TW' '預訂條款與條件'
'{privacy}': zh '隐私通知'          'zh-TW' '隱私通知'
'{payment}': zh '付款条款'          'zh-TW' '付款條款'
'{ekyc}':    zh '身份验证通知'      'zh-TW' '身分驗證通知'
```

- [ ] **Step 6: `LegalDocumentPage.tsx` `SIBLING_LINKS`** — add zh/zh-TW:

```ts
terms_of_service: zh '预订条款'   'zh-TW' '預訂條款'
privacy_notice:   zh '隐私通知'   'zh-TW' '隱私通知'
payment_terms:    zh '付款条款'   'zh-TW' '付款條款'
ekyc_biometric:   zh '身份验证'   'zh-TW' '身分驗證'
```

- [ ] **Step 7: `GuestPaymentPanel.tsx`** — the `title` literal gains
  `zh: '付款前须知'`, `'zh-TW': '付款前須知'`.

- [ ] **Step 8: Typecheck — collect the remaining-red inventory**

Run: `bun run typecheck` in `hotel-web-fe/`
Expected: FAIL listing the four big documents plus test stubs — anything else
in the list gets fixed here too.

- [ ] **Step 9: Commit** — `feat(legal): widen legal corpus to all four locales — short-form copy`

---

### Task 2: `termsOfService.ts` zh/zh-TW

**Files:** Modify `src/features/legal/content/termsOfService.ts`

**Interfaces:** Consumes the widened `LocalizedText`/`LegalLocale` from Task 1.

- [ ] **Step 1: `formatStayTime` gains zh/zh-TW** — signature widens to
  `locale: LegalLocale`; zh/zh-TW render `下午 3:00` / `上午 11:00`:

```ts
if (locale === 'zh' || locale === 'zh-TW') {
  return `${h < 12 ? '上午' : '下午'} ${h12}:${match[2]}`;
}
```

- [ ] **Step 2: Translate the document** — `title`, `summary`, all 8 sections
  (`parties`, `booking-confirmation`, `rates-and-taxes`, `cancellation`,
  `stay-rules`, `liability`, `personal-data`, `law`). Every heading/body/bullet
  gains `zh`/`'zh-TW'`. Interpolations (`${identity.*}`, `${checkIn('zh')}`) keep
  working. Legal register; keep the defined term 酒店 ("the Hotel") consistent.
  Numbered headings keep their `N.` prefix — `splitHeadingNumeral` depends on it.

- [ ] **Step 3: Commit** — `feat(legal): zh/zh-TW booking terms`

---

### Task 3: `privacyNotice.ts` zh/zh-TW

**Files:** Modify `src/features/legal/content/privacyNotice.ts`

- [ ] **Step 1: Translate** — `title`, `summary`, all 14 sections
  (`controller`, `data-processed`, `sensitive-data`, `sources`, `purposes`,
  `disclosures`, `transfers`, `obligatory`, `choices`, `rights`, `retention`,
  `security`, `cookies`, `changes`). Statutory terms: 数据主体/資料主體,
  个人资料处理者/個人資料處理者 (data controller). Keep defined terms identical
  across sections within each locale.

- [ ] **Step 2: Commit** — `feat(legal): zh/zh-TW privacy notice`

---

### Task 4: `paymentTerms.ts` + `ekycConsent.ts` zh/zh-TW

**Files:** Modify `src/features/legal/content/paymentTerms.ts`,
`src/features/legal/content/ekycConsent.ts`

- [ ] **Step 1: paymentTerms** — title, summary, 8 sections
  (`what-you-pay`, `currency`, `confirmation`, `card-paypal`, `bank-transfer`,
  `refunds`, `problems`, `security`) + `PAYMENT_KEY_POINTS`. Currency codes
  (RM/MYR) stay untranslated.
- [ ] **Step 2: ekycConsent** — title, summary, 5 sections
  (`what-we-ask`, `what-we-do`, `who-sees`, `retention`, `voluntary`) +
  `EKYC_KEY_POINTS`. Keep "eKYC" untranslated (canonical per inventory glossary).
- [ ] **Step 3: `bun run typecheck`** — all `src/` errors gone (test stubs may
  remain red until Task 5; a source-file error gets fixed here).
- [ ] **Step 4: Commit** — `feat(legal): zh/zh-TW payment terms + eKYC consent`

---

### Task 5: Test updates + typecheck green

**Files:**
- Modify: `src/features/legal/noticeConsent.test.ts` — iterate `LEGAL_LOCALES`
  instead of `['en', 'ms']`.
- Modify: `src/features/legal/components/LegalDocumentPage.test.tsx` — stub doc
  gains `zh`/`'zh-TW'`; assert the toggle group renders 4 buttons and switching
  to `简体中文` renders zh text.
- Modify: `src/features/legal/components/ConsentBlock.test.tsx` — add a
  `简体中文` click asserting `buildPayload` records `zh`.
- Modify: `src/features/legal/content/hotelIdentity.test.ts` — widen the
  `(locale: 'en' | 'ms')` helper to `LegalLocale`.

- [ ] **Step 1: Apply edits** (each test file's existing assertions stay —
  toggle labels grow from 2 to 4 options, which existing queries still match).
- [ ] **Step 2: `bun run test --run src/features/legal`** — all green.
- [ ] **Step 3: `bun run typecheck`** — clean end to end.
- [ ] **Step 4: Commit** — `test(legal): cover zh/zh-TW legal surfaces`

---

### Task 6: Docs

**Files:** Modify `docs/reference/i18n-coverage-inventory.md`;
check `docs/guides/internationalization.md`.

- [ ] **Step 1:** Rewrite the "Legal corpus" exception row — corpus is now
  4-locale; en/ms remain the PDPA s.7(2) pair, zh/zh-TW are DRAFT pending
  native/legal review. Fix the guide only if it still describes the corpus as
  en/ms.
- [ ] **Step 2: Commit** — `docs: legal corpus is four-locale`

---

### Task 7: salim-inn `lang.ts` + content index

**Files:**
- Create: `salim-inn/src/content/lang.ts`
- Create: `salim-inn/src/content/index.ts`
- Test: `salim-inn/src/content/lang.test.ts`

**Interfaces:**
- Produces (all later tasks consume):

```ts
export type Lang = 'en' | 'ms' | 'zh' | 'zh-TW';
export const LANGS: readonly { code: Lang; nativeName: string }[]; // 4 entries
export const matchLang = (tag: string | null | undefined): Lang | undefined;
export const resolveLang = (): Lang;          // ?lang= → localStorage('locale') → navigator.languages → 'en'
export const fmt = (template: string, vars: Record<string, string | number>): string; // {{name}} interpolation
export const formatTime = (iso: string, lang: Lang): string;   // '14:00' → '2:00 pm' / '2:00 petang' / '下午 2:00'
export const copy: Copy;                       // resolved at module load
export const lang: Lang;
```

`matchLang` mirrors the app rule: exact code → zh-Hant*/zh-TW/zh-HK/zh-MO→zh-TW
→ zh-Hans*/zh-CN/zh-SG/zh-MY/bare zh→zh → primary subtag.

- [ ] **Step 1: Write `lang.test.ts`** — matchLang: `'zh-Hant'`→zh-TW,
  `'zh-Hans-TW'`→zh, `'zh-HK'`→zh-TW, `'zh-MY'`→zh, `'EN'`→en, `'fr'`→undefined.
  formatTime: `'14:00'`→`'2:00 pm'`(en), `'2:00 petang'`(ms), `'下午 2:00'`(zh/zh-TW).
- [ ] **Step 2: Run, watch fail** — `bun run test --run salim-inn`
- [ ] **Step 3: Implement `lang.ts`** (+ `content/index.ts` with `COPY` — the
  ms/zh/zh-TW bundle imports land in Task 9, so index starts as
  `{ en }` and Task 9 extends it).
- [ ] **Step 4: Re-run green. Commit** — `feat(salim-inn): locale resolution`

---

### Task 8: Extend `en.ts` `Copy` to cover the whole page

**Files:** Modify `salim-inn/src/content/en.ts`; Modify `salim-inn/src/ui/Chapters.ts`
(constructor takes `Copy` + uses `copy.*`); Modify `salim-inn/src/main.ts`
(labels from `copy`).

**Interfaces:**
- Produces: `Copy` gains `page` subtree + `chapterDots`/`bookingCard`/
  `mobileCta`/`skipLink`/`aria` fields consumed by Tasks 10–12.
- Facts interpolate `{checkIn}`/`{checkOut}`/`{{rate}}` placeholders — filled by
  `formatTime`/`fmt` at apply time, never typed inline (existing en.ts rule).

Add to `en` (names are the `data-i18n` keys Task 10 tags in `index.html`):

- `skipLink`, `aria: { primaryNav, chaptersNav, highlights }`
- `nav`: + `signIn`, `myAccount`, `adminConsole`, `bookAnotherStay`
- `chapterDots`: 8 labels (Farley, Neighbourhood, Salim Inn, Arrival, Reception, Rooms, Footsteps, Book)
- `bookingCard`: `{ body, book, call }` (chapter 8's inner card — body keeps `{checkIn}`/`{checkOut}` placeholders)
- `mobileCta`: `{ rate: 'from <strong>RM{{rate}}</strong> / night', book }`
- `page.after`: `{ eyebrow, title, intro }` (title keeps the `<em>`)
- `page.trust`: 3 × `{ value, label }`
- `page.rooms`: `{ eyebrow, title, blurb, cards: 5 × { tag, name, night }, book, rateNote }`
- `page.gallery`: `{ eyebrow, title, blurb, figures: 10 × { strong, span, alt? } }`
- `page.amenities`: `{ eyebrow, title, blurb, items: 6 × { name, desc } }`
- `page.stay`: `{ eyebrow, title, body, cta, labels: { address, call, email } }`
- `page.faq`: `{ eyebrow, title, blurb, items: 6 × { q, a } }`
- `page.cta`: `{ title, book, call }`
- `footer`: + `rights` already there; `address` built from SITE stays (proper nouns)

Steps: [ ] extend `en` [ ] `Chapters` constructor signature `(copy: Copy)` using
`copy.chapters`, `copy.chapterDots`, `copy.bookingCard`, `copy.footer`
[ ] `main.ts` passes `copy` to `new Chapters(copy)` and reads
`copy.preloader`/`copy.nav` for the preloader/play labels
[ ] `bun run typecheck` [ ] commit `feat(salim-inn): full-page copy model`

---

### Task 9: `ms.ts`, `zh.ts`, `zh-TW.ts` bundles

**Files:** Create `salim-inn/src/content/{ms,zh,zh-TW}.ts` (each
`satisfies Copy` — parity is a compile error, no runtime parity test needed);
extend `content/index.ts` `COPY` to all four.

- [ ] Translate every leaf; DRAFT-review header note on each file.
- [ ] `bun run typecheck` — any missing key fails here.
- [ ] Commit — `feat(salim-inn): ms/zh/zh-TW copy`

---

### Task 10: `index.html` `data-i18n` + picker

**Files:** Modify `salim-inn/index.html`; Modify `salim-inn/src/styles/main.css`
(picker styling).

- [ ] Tag every translatable element: `data-i18n="<dot.path>"` for text,
  `data-i18n-html="<dot.path>"` where markup (`<em>`, `<br>`, `<a>`) lives,
  `data-i18n-alt`/`data-i18n-aria-label` for attributes. English markup stays —
  it's the no-JS/SEO baseline.
- [ ] Add `<select id="lang-picker" class="lang-pill" aria-label="Language">`
  in `.top-actions`; CSS to sit with the pills.
- [ ] Commit — `feat(salim-inn): data-i18n attributes + lang picker`

---

### Task 11: Apply pass + `accountActions.ts`

**Files:** Create `salim-inn/src/i18nApply.ts` (walks `[data-i18n]`/
`[data-i18n-html]`/`[data-i18n-alt]`/`[data-i18n-aria-label]`, fills
`{{var}}` via `fmt`, sets `<html lang>` + `meta[name=description]`);
Modify `salim-inn/src/main.ts` (call apply before `new Chapters(copy)`; wire
`#lang-picker` change → `localStorage.setItem('locale', code)` →
`location.search = 'lang=' + code`); Move `salim-inn/account-actions.js` →
`salim-inn/src/accountActions.ts` (same logic, labels from `copy.nav`);
Modify `salim-inn/index.html` script src → `./src/accountActions.ts`.

- [ ] Steps in file order above; `bun run typecheck` after each.
- [ ] Commit — `feat(salim-inn): runtime language apply`

---

### Task 12: `data-i18n` coverage test + gates

**Files:** Create `salim-inn/src/content/coverage.test.ts`

- [ ] Test: read `salim-inn/index.html`, collect every `data-i18n*` key,
  assert each resolves to a non-empty string in all four `COPY` entries.
- [ ] Gates: `bun run typecheck`, `bun run test --run salim-inn`,
  `bun run lint:strict`, `bun run build` (verify `salimInn` entry bundles).
- [ ] Manual smoke: `?lang=zh-TW` renders Traditional; picker persists.
- [ ] Commit — `test(salim-inn): data-i18n coverage`

---

### Task 13: Final verification + summary

- [ ] `bun run typecheck && bun run lint:strict && bun run test` (full FE suite,
  serial) — green.
- [ ] Diff `git diff master...HEAD` review pass; update the spec doc status to
  "implemented" if the repo convention marks it.
- [ ] Summary noting: consent versions unchanged by design; zh/zh-TW legal copy
  flagged DRAFT pending native/legal review; the ~699 zh guest-portal residual
  strings remain a separate pass.
