# Policy Pages Reading Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the four public legal/policy pages (`/legal/terms`, `/legal/privacy`, `/legal/payment-terms`, `/legal/identity-verification`) into a calm, boutique-hotel reading experience — "everything is clearly explained, thoughtfully organized, and trustworthy."

**Architecture:** Pure-presentation redesign of the single shared renderer `LegalDocumentPage.tsx` plus one optional metadata field on `LegalSection`. Content files (bilingual consent wording) are touched only to add `emphasis` flags — **no wording changes, so no `version` bumps and no consent regeneration** (the version pin covers text generation, not presentation metadata).

**Tech Stack:** React 19, MUI v9, guest bundle (`guest.html` → `GuestApp` → `GuestRootLayout` → `GuestPortalShell`), vitest + RTL.

## Global Constraints

- These pages are **public and unauthenticated** by design (PDPA informed-consent) — keep them reachable with no session, keep the `lang={locale}` attribute, keep en/ms parity (a missing translation is a type error by design).
- **Never edit published wording** in `content/*.ts` without bumping `version`. Adding `emphasis` metadata is allowed; rewriting sentences is not.
- Preserve: bilingual `ToggleButtonGroup`, `hotelSettingsChange` refresh, `scrollMarginTop` anchor links, sibling links, back navigation (`returnToPreviousPage`), `LegalDocumentId` wire contract.
- Works in all three theme modes; the warm boutique palette applies to `light` mode — dark/night keep their own tokens (callouts derive from `theme.palette`, not hardcoded warm hexes).
- Boutique tokens already exist in the guest experience — reuse them rather than inventing: warm paper `rgba(255,253,247)` / `#faf7f0`, deep green `#102a21`/`#315b4b`, gold `#d9b574` (auth page radial accent), Georgia serif (`.auth-heading` precedent).
- Gates: `bun run typecheck && bun run lint && bun run test` in `hotel-web-fe/`; existing `LegalDocumentPage.test.tsx` and `hotelIdentity.test.ts` must stay green.
- Other sessions are editing this worktree — `git status --short` before committing; stage only this plan's files.

## File Structure

| File | Change |
|---|---|
| `src/features/legal/content/types.ts` | Add optional `emphasis?: 'requirement' | 'info'` to `LegalSection` |
| `src/features/legal/content/termsOfService.ts` | `emphasis: 'requirement'` on cancellation/no-show and payment-obligation sections |
| `src/features/legal/content/paymentTerms.ts` | `emphasis: 'requirement'` on payment-obligation sections |
| `src/features/legal/content/privacyNotice.ts` | `emphasis: 'info'` on rights/contact sections |
| `src/features/legal/content/ekycConsent.ts` | `emphasis: 'requirement'` on biometric-consent section |
| `src/features/legal/components/LegalDocumentPage.tsx` | Boutique restyle (the main work) |
| `src/features/legal/components/LegalDocumentPage.test.tsx` | Update/extend assertions |

**Not touched:** `ConsentBlock`, `ConsentNotice`, `legalLinks`, `GuestPortalShell`, content wording, any route.

---

### Task 1: `emphasis` field on `LegalSection`

**Files:** `content/types.ts` + the four content builders.

- [ ] **Step 1:** Add to `LegalSection` in `types.ts`:

```ts
export interface LegalSection {
  id: string;
  heading: LocalizedText;
  body?: LocalizedText[];
  bullets?: LocalizedText[];
  /**
   * Presentation hint: 'requirement' renders the section as a callout for
   * obligations the guest must meet (payment, cancellation); 'info' marks
   * helpful context. Absent = plain section. Metadata only — never changes
   * wording, so it does not trigger a consent version bump.
   */
  emphasis?: 'requirement' | 'info';
}
```

- [ ] **Step 2:** In each builder, add `emphasis` to the sections carrying obligations or key context. Read each file's section list and flag only what qualifies (e.g. terms: cancellation/no-show + payment-confirmation sections → `'requirement'`; payment-terms: amounts/due-date sections → `'requirement'`; privacy: guest-rights + contact sections → `'info'`; ekyc: what-we-collect biometric section → `'requirement'`). Do NOT reword anything.
- [ ] **Step 3:** `bun run typecheck` → PASS.
- [ ] **Step 4: Commit.**

### Task 2: Boutique document frame

**File:** `src/features/legal/components/LegalDocumentPage.tsx`

Replace the flat `Paper` wrapper with a layered reading frame (light mode values; dark modes fall back to `background.paper`/`text.primary` via `(theme) => theme.palette.mode === 'light' ? … : …`):

- [ ] **Step 1: Page frame** — outer `Container maxWidth="md"` stays; the card becomes warm paper:

```tsx
<Paper elevation={0} sx={(theme) => ({
  p: { xs: 2.5, sm: 4, md: 6 },
  border: '1px solid',
  borderColor: theme.palette.mode === 'light' ? 'rgba(49,91,75,0.14)' : 'divider',
  borderRadius: 3,
  bgcolor: theme.palette.mode === 'light' ? '#fdfbf6' : 'background.paper',
})}>
```

- [ ] **Step 2: Masthead** — eyebrow (trading name) in letter-spaced small caps `#315b4b`-on-light; document title in Georgia serif, `fontWeight: 400`, `letterSpacing: '-0.02em'`, ink `#102a21` (mirrors `.auth-heading`); version/effective line as a quiet meta row (`body2`, `text.secondary`, `·` separators). Language toggle moves to its own row on xs (keep component, `size="small"`).
- [ ] **Step 3: Summary** — render `document.summary` as a lede: `fontSize: '1.05rem'`, `lineHeight: 1.8`, `color: 'text.primary'`, `maxWidth: '68ch'`, separated below by a 40px-tall hairline block: `<Divider sx={{ my: 4, borderColor: 'rgba(49,91,75,0.16)' }} />` with a centered 24px gold rule above it (`<Box sx={{ width: 48, height: 2, bgcolor: '#d9b574' }} />` light-mode only — or a small `Divider` with centered label; keep it restrained).
- [ ] **Step 4: Reading column** — wrap sections in `<Box sx={{ maxWidth: '68ch' }}>`; body `lineHeight: 1.85`, paragraph gap 1.5, section gap 5; bullets get refined markers (`'& li::marker': { color: '#315b4b' }`).
- [ ] **Step 5: Typecheck + commit.**

### Task 3: Numbered sections, contents, and callouts

**File:** same component.

- [ ] **Step 1: Section numerals** — headings already carry `"N. "` in the localized string. Split for display only:

```tsx
const headingText = section.heading[locale];
const match = /^(\d+)\.\s*(.*)$/.exec(headingText);
// match ? render <Box component="span" sx={{ color: gold, fontFamily: 'Georgia, serif', mr: 0.75 }}>{match[1]}.</Box> + match[2]
//       : render headingText
```

- [ ] **Step 2: Section headings** — `component="h2"`, Georgia serif, `fontSize: '1.35rem'`, `fontWeight: 400`, `mt: 0`, `mb: 2`; each section separated by a hairline `Divider` *above* (not the heavy `my:4` between blocks — move to a per-section top rule `sx={{ pt: 4, borderTop: '1px solid', borderColor: 'divider' }}` except the first).
- [ ] **Step 3: "In this document" contents** — restyle the existing nav box: no filled background; a quiet bordered block with the same hairline treatment; entries as an ordered list using the section numerals, `Link underline="hover"`, `py: 0.5` rows with `borderBottom: '1px solid'` on all but last (reading-room style).
- [ ] **Step 4: Emphasis callouts** — when `section.emphasis` is set, wrap that section's body/bullets in:

```tsx
<Box sx={(theme) => ({
  mt: 1.5, p: 2.5, borderRadius: 2,
  border: '1px solid',
  borderLeft: `3px solid ${section.emphasis === 'requirement' ? '#a4732e' : '#315b4b'}`,  // light-mode; dark → warning.main / info.main
  borderColor: 'divider',
  borderLeftColor: section.emphasis === 'requirement'
    ? (theme.palette.mode === 'light' ? '#a4732e' : 'warning.main')
    : (theme.palette.mode === 'light' ? '#315b4b' : 'info.main'),
  bgcolor: theme.palette.mode === 'light' ? 'rgba(217,181,116,0.07)' : 'action.hover',
})}>
```

  with a small icon + caption line above the body (`GavelOutlined` for requirement, `InfoOutlined` for info, fontSize 16) — caption text localized inline like the rest of this file (`locale === 'ms' ? 'Perkara penting' : 'Important'` / `'Good to know'`).
- [ ] **Step 5: Footer** — contact block becomes a "Questions about this document?" callout (same frame as contents); sibling links stay a quiet row; the second Divider/back-button stays.
- [ ] **Step 6: Typecheck + commit.**

### Task 4: Tests + verification

- [ ] **Step 1:** Update `LegalDocumentPage.test.tsx`: assert section numeral splits correctly, `emphasis` callout renders for flagged sections (build a tiny fixture document via `buildTermsOfService` or a stub `LegalDocument`), contents nav still links `#id`, `lang` attr and toggle unchanged.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun run test` → PASS.
- [ ] **Step 3:** Manual matrix: all four docs × en/ms × light/dark/night × 375/768/1280 — check anchor scroll, callout contrast (AA), Georgia fallback, no overflow.
- [ ] **Step 4: Commit.**

## Deferred / notes

- `ConsentBlock`/`ConsentNotice` keep their own styling — sharing the accent color (`#315b4b` links) is a possible micro-follow-up, not required.
- If the team later wants callouts defined renderer-side (zero content-file touches), swap `emphasis` for a `Record<LegalDocumentId, Record<sectionId, 'requirement'|'info'>>` map in the component — spec'd as `emphasis` because self-documenting in content is clearer.
- No admin-portal dependency: this plan is independent of `2026-09-13-admin-navigation-redesign.md`; either can ship first.
