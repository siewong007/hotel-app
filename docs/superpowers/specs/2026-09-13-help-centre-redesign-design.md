# Help Centre Redesign — Design Spec

Status: approved by product owner 2026-09-13 (direction + scoping Q&A).
Scope: admin-portal Help Centre only (`/help`). No backend API, schema, or
seed changes. Guest-facing support inbox (`/support`) is untouched.

## Approved decisions

- **Content storage:** static typed data inside `src/features/help/` — versioned
  in git, ships with the app (incl. Tauri desktop), no CMS.
- **Escalation:** process guidance only (contact manager/admin; guest-support
  inbox framed honestly as the staff-facing tool for guest issues). No
  staff→vendor ticket channel in this phase.
- **Phase 1 scope:** feature scaffold, hub redesign, article pages, client-side
  search, `help` i18n namespace, ~18–24 verified articles, Help group in the ⌘K
  command palette.
- **Article i18n:** full English + Malay article bodies, not just UI chrome.
  Article bodies live in per-locale structured data files
  (`content/articles.en.ts`, `content/articles.ms.ts`) sharing one `HelpArticle`
  type and one slug set; a test enforces slug parity. Chrome strings
  (buttons, headings, category names, feedback) live in
  `i18n/resources/{en,ms}/help.json` like every other namespace.

## Why not the alternatives

- DB-backed articles: requires new tables, endpoints, admin editor, and a
  patch-catalog entry — rejected for Phase 1. The `HelpArticle` model is
  portable to a CMS later if volume justifies it.
- New registry route ids (`help-article`, `help-category`): each new id needs a
  `route_access_policies` row + `expected_route_access_policies` entry +
  patch-catalog registration in four places. Rejected. Article pages live at
  `/help/$slug` rendered directly under `ProtectedRoute routeId="help"`
  (precedent: `routes/unsubscribe.$token.tsx` renders param routes directly).
  Category browse is a `/help?category=` search param — zero new route ids.

## Architecture

```
src/features/help/
  index.ts            barrel
  types.ts            HelpBlock union, HelpArticle, HelpCategory, CategoryId
  constants.ts        category registry (id → icon, routePath, i18n key)
  content/
    articles.en.ts    English articles
    articles.ms.ts    Malay articles (same slugs)
    index.ts          locale-aware accessor (useArticles / getArticle)
  utils.ts            searchArticles(index, query) — weighted pure function;
                      synonym map for hotel terms; related/category helpers
  hooks/
    useHelpSearch.ts  debounced query (useDebouncedValue) + keyboard-nav state
  components/         HelpSearchBar, CategoryCard, ArticleCard, HelpBreadcrumbs,
                      ArticleToc, HelpCallout, StepsList, FaqAccordion,
                      ArticleBlocks (block renderer), RelatedArticles,
                      ArticleFeedback, QuickTaskGrid, TroubleshootingStrip,
                      EscalationCard
  pages/
    HelpCenterPage.tsx   hub (replaces HelpSupportPage contents)
    HelpArticlePage.tsx  article detail
```

Wiring:

- `routeRegistry.tsx`: `help` id's lazy component now points at
  `features/help/pages/HelpCenterPage`. Registry id, path, icon, policy row
  unchanged.
- `routes/help.tsx`: unchanged (`RouteById id="help"`), gains
  `validateSearchParams` for `?category=`.
- `routes/help.$slug.tsx`: new param file route →
  `ProtectedRoute routeId="help"` + `AnimatedRoute` + `ComponentErrorBoundary` +
  lazy `HelpArticlePage`. Same guard semantics as every auth page.
- `NavigationTabs.tsx`: ⌘K palette gains a client-side "Help" group fed by
  `searchArticles` over the same index (no backend change).
- `i18n/resources/{en,ms}/help.json` + registration in `resources/index.ts`
  (enforced by `resources.test.ts`).

## Article model

```ts
type HelpBlock =
  | { type: 'heading'; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'steps'; steps: { title: string; body: string }[] }
  | { type: 'callout'; tone: 'tip'|'info'|'warning'|'important'; title?: string; body: string }
  | { type: 'checklist'; items: string[] }
  | { type: 'faq'; items: { q: string; a: string }[] };

interface HelpArticle {
  slug: string; title: string; summary: string;
  category: CategoryId; keywords: string[];   // search synonyms
  blocks: HelpBlock[]; relatedSlugs: string[];
  routePath?: string;                          // "Open the page" CTA
  requiredPermissions?: string[];              // shown as chips
  lastReviewed: string;                        // ISO date
}
```

No markdown renderer — typed blocks render through MUI components. Search is a
pure weighted function (title > keywords > summary > body) tested with vitest.

## Categories (all mapped to verified modules)

getting-started · bookings · guests · rooms-inventory · payments-ledgers ·
rates-promotions · reports-night-audit · communications · staff-access ·
settings-data · troubleshooting

## Categories NOT included (verified absent, do not document)

- teams (backend module exists; no UI)
- system status page, vendor ticket channel, article analytics (no infra)

## Design language

Conform to the staff "board skin" (2px borders, radius 8, weight-900 headings) —
theme-derived tokens only (`bookingTokens.ts` pattern), never the hard-coded
Salim Inn `T` palette and never hard-coded rgba gradients. Dark + night modes
must work. Global `:focus-visible` ring and reduced-motion reset already apply.

## Accessibility commitments (AA baseline, AAA where cheap)

h1 per page + ordered heading tree; first real `Breadcrumbs` usage in the app;
keyboard-operable search (↑↓ Enter Esc) mirroring the palette; aria-labels on
icon-only controls; non-color callout labels (icon + tone word); ≥44px touch
targets on interactive rows; articles visible to all staff — `requiredPermissions`
rendered as informational chips, not content gates.

## Verified-behaviour sources for content

Route registry + seed policies; `payments.rs` refund/revert endpoints;
`users.service.ts` staff CRUD; RBAC tabs (Users/Roles/Permissions);
communications campaigns/templates; support inbox; `unpaid_hold_release_hours`
setting; guest pre-check-in flow; data transfer; online inventory; night audit;
housekeeping; reports; ⌘K palette; passkeys/2FA; language + theme settings.
Any click-path not confirmed in code is written at the verified level only.

## Testing

- `utils.test.ts`: search weighting, synonyms, empty query, category filters.
- `content parity test`: identical slug sets + block-type parity across en/ms.
- Page smoke tests (Style-A mocking): hub renders categories + search; article
  page renders blocks + related + feedback.
- Gates: `bun run typecheck`, `bun run lint`, `bun run test`.

## Risks

- `routeTree.gen.ts` is dirty from another session — regeneration is
  deterministic from route files on disk; diff after regen and report.
- Article translation volume is the largest cost; ~20 articles × 2 locales.
- `ms` quality: Malay strings written by agent — flag for native review.
