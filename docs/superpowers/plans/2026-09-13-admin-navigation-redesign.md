# Admin Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-row top bar with a collapsible left sidebar + slim topbar (breadcrumbs, search, bell, user menu), regroup navigation around hotel workflows, fix active-state/a11y gaps, and soften the neobrutalist "board skin" into a calmer premium surface — all in one change.

**Architecture:** One new `components/layout/sidebar/` + `components/layout/` shell layer driven entirely by the existing `routeRegistry.tsx` + `route_access_policies` system. The command palette, user menu, and notification center are extracted from `NavigationTabs.tsx` into standalone components; `NavigationTabs.tsx` is deleted. Visual reskin is token-level inside `theme.ts` (borders 2px→1px, hard shadows→soft, weight 900→700, dashed→solid) — no per-page edits.

**Tech Stack:** React 19, MUI v9, TanStack Router (file routes + registry), TanStack Query, vitest + Testing Library (jsdom), i18n via `src/i18n/resources/{en,ms}/nav.json`.

## Global Constraints

- Do NOT touch files that are already dirty in the worktree unless the task says so — another session's work is in flight (28 files, incl. `SettingsPage.tsx`, `routeTree.gen.ts`). `git status --short` before every commit; stage only files this plan touched.
- No new dependencies. No route path/permission-name/storage-key changes (adding a new storage key `'navCollapsed'` is allowed — same pattern as `themeMode`).
- All HTTP stays on `src/api/client.ts`; labels go through `useRouteLabels`/`useTranslation` — never hardcode user-facing strings without an i18n key or a deliberate English fallback consistent with existing code.
- MUI breakpoints only: `theme.breakpoints.down('md')` (<900px = mobile drawer), `up('md')` = persistent sidebar.
- `lib: ES2020` — no `.at()`, `Object.groupBy`, `findLast`.
- Gates before done: `bun run typecheck && bun run lint && bun run test` in `hotel-web-fe/`, plus `bun run build`.
- en/ms `nav.json` key parity is enforced — add keys to BOTH files.
- i18n: nav group + route labels must be added to `en/nav.json` AND `ms/nav.json`.
- `route_access_policies` DB is NOT touched: regrouping is frontend-only; the RBAC editor is switched to read grouping from the registry (DB `nav_group` becomes vestigial display data).
- Reduced-motion and the global `:focus-visible` ring already exist — do not regress them.

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/navigation/isNavItemActive.ts` | pathname → nav-item active matcher (incl. `/admin-portal` alias) |
| `src/navigation/isNavItemActive.test.ts` | matcher unit tests |
| `src/navigation/navGroups.ts` | `NavGroup` metadata: order, label keys, label-less groups |
| `src/navigation/navStructure.test.ts` | registry integrity: every nav item has icon+label+valid group |
| `src/components/layout/CommandPalette.tsx` | ⌘K palette extracted from NavigationTabs (+ provider/`useCommandPalette`) |
| `src/components/layout/UserMenu.tsx` | focusable user trigger + menu (shared topbar/sidebar) |
| `src/components/layout/Breadcrumbs.tsx` | `Group › Page` trail from registry + `useRouteLabels` |
| `src/components/layout/AppTopbar.tsx` | 56px bar: hamburger(xs), breadcrumbs, search trigger, bell, language, avatar |
| `src/components/layout/sidebar/SidebarNavItem.tsx` | one nav row (icon+label+active+tooltip) |
| `src/components/layout/sidebar/SidebarSection.tsx` | group label + collapsible item list |
| `src/components/layout/sidebar/SidebarContent.tsx` | full sidebar body: brand, search, sections, utility, user card, collapse |
| `src/components/layout/sidebar/AppSidebar.tsx` | persistent `≥md` drawer hosting `SidebarContent`; mobile `Drawer` host |

**Modified files:**

| File | Change |
|---|---|
| `src/navigation/routeRegistry.tsx` | new `NavGroup` union; regroup items; add missing/dedupe icons; reorder array by group; dashboard gets `icon`+`navLabel`+`navGroup` |
| `src/navigation/routeLabels.ts` | none needed (group labels already keyed by group id) |
| `src/i18n/resources/en/nav.json` + `ms/nav.json` | new `groups` keys, `routes.dashboard`, `aria.*` additions |
| `src/utils/storage.ts` | `'navCollapsed'` added to `StorageKey` |
| `src/router/RootLayout.tsx` | flex shell: `AppSidebar` + `AppTopbar` + content column; remove two-row AppBar |
| `src/components/layout/NavigationTabs.tsx` | DELETED after extraction (only `RootLayout` imports it) |
| `src/components/layout/NotificationCenter.tsx` | remove `display: none` on xs |
| `src/features/bookings/components/Bookings/BookingsPage.tsx` | `?create=1` opens `UnifiedBookingModal`; cleared on close |
| `src/features/admin/components/rbac/RolesTab/NavigationAccessSection.tsx` | groups/icons/labels read from registry + `useRouteLabels` |
| `src/theme.ts` | premium reskin tokens (see Task 11) |
| `src/index.css` | drop grid-paper `.hotel-board-shell` background |

**Reference (do not modify):** `ProtectedRoute`, `canAccessNavigationRoute`, `useAuth`, `guestDocumentPaths` — unchanged; the redesign consumes them.

## Interface Contracts

```ts
// src/navigation/routeRegistry.tsx
export type NavGroup =
  | 'overview' | 'operations' | 'finance' | 'engagement'
  | 'property' | 'insights' | 'administration' | 'utility';

// src/navigation/isNavItemActive.ts
export function isNavItemActive(pathname: string, route: AppRouteDefinition): boolean;

// src/navigation/navGroups.ts
export const NAV_GROUP_ORDER: readonly NavGroup[];
export const LABEL_LESS_GROUPS: ReadonlySet<NavGroup>; // overview, insights, utility
export function navSections(items: AppRouteDefinition[]):
  { group: NavGroup; items: AppRouteDefinition[]; labeled: boolean }[];

// src/components/layout/CommandPalette.tsx
export function CommandPaletteProvider(props: { children: ReactNode }): JSX.Element;
export function useCommandPalette(): { open: () => void };

// src/components/layout/UserMenu.tsx
export function UserMenu(props: { variant?: 'avatar' | 'card'; darkBg?: boolean }): JSX.Element;

// src/components/layout/Breadcrumbs.tsx — no props; reads location + registry
```

Group assignments (registry `navGroup` values):

| Group | Items (in display order) | Labeled? |
|---|---|---|
| `overview` | dashboard | no (single item) |
| `operations` | bookings, timeline, guest-config, room-management, housekeeping, support | yes |
| `finance` | company-ledger, payment-approvals, night-audit, complimentary | yes |
| `engagement` | loyalty, promotions, communications | yes |
| `property` | online-inventory, room-config | yes |
| `insights` | reports | no (single item) |
| `administration` | rbac, ekyc-admin, audit-log, data-transfer | yes |
| `utility` | settings, notifications, help | no (bottom strip) |

Icon changes: `notifications` → `NotificationsIcon` (was missing); `communications` → `CampaignIcon` (was duplicate EventNote); `loyalty` → `LoyaltyIcon`; `online-inventory` → `Inventory2Icon`; `room-config` → `KingBedIcon`; `dashboard` → `DashboardIcon`. All other icons unchanged.

---

### Task 1: Active-route matcher

**Files:**
- Create: `hotel-web-fe/src/navigation/isNavItemActive.ts`
- Test: `hotel-web-fe/src/navigation/isNavItemActive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/navigation/isNavItemActive.test.ts
import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './isNavItemActive';
import type { AppRouteDefinition } from './routeRegistry';

const route = (over: Partial<AppRouteDefinition>): AppRouteDefinition => ({
  id: 'x', path: '/x', component: {} as never, animationType: 'fade',
  visibility: 'auth', ...over,
});

describe('isNavItemActive', () => {
  it('matches exact paths', () => {
    expect(isNavItemActive('/bookings', route({ path: '/bookings' }))).toBe(true);
    expect(isNavItemActive('/bookings/', route({ path: '/bookings' }))).toBe(false);
    expect(isNavItemActive('/book', route({ path: '/bookings' }))).toBe(false);
  });

  it('treats /admin-portal and / as the dashboard', () => {
    const dash = route({ id: 'dashboard', path: '/' });
    expect(isNavItemActive('/', dash)).toBe(true);
    expect(isNavItemActive('/admin-portal', dash)).toBe(true);
    expect(isNavItemActive('/bookings', dash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `cd hotel-web-fe && bun run test -- isNavItemActive` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// src/navigation/isNavItemActive.ts
import type { AppRouteDefinition } from './routeRegistry';

/**
 * Active-nav matcher. Dashboard is the only aliased destination: `/admin-portal`
 * renders the same page as `/`, so both highlight the Overview item. Everything
 * else is exact pathname equality — nav routes are flat and query strings never
 * participate (location.pathname excludes them already).
 */
export function isNavItemActive(pathname: string, route: AppRouteDefinition): boolean {
  if (route.id === 'dashboard') {
    return pathname === '/' || pathname === '/admin-portal';
  }
  return pathname === route.path;
}
```

- [ ] **Step 4: Run it** — same command → PASS.
- [ ] **Step 5: Commit** — `git add` the two files; `git commit -m "feat(nav): add active-route matcher with dashboard alias"`.

### Task 2: NavGroup model + group metadata

**Files:**
- Modify: `src/navigation/routeRegistry.tsx` (the `NavGroup` type only)
- Create: `src/navigation/navGroups.ts`
- Test: `src/navigation/navGroups.test.ts`

- [ ] **Step 1: Failing test** for `navSections` ordering + label-less groups:

```ts
import { describe, expect, it } from 'vitest';
import { LABEL_LESS_GROUPS, NAV_GROUP_ORDER, navSections } from './navGroups';
import type { AppRouteDefinition } from './routeRegistry';

const item = (id: string, navGroup: AppRouteDefinition['navGroup']) =>
  ({ id, path: `/${id}`, navGroup }) as AppRouteDefinition;

describe('navSections', () => {
  it('orders groups by NAV_GROUP_ORDER and preserves registry order inside', () => {
    const sections = navSections([
      item('b', 'operations'), item('a', 'finance'), item('c', 'operations'),
    ]);
    expect(sections.map((s) => s.group)).toEqual(['operations', 'finance']);
    expect(sections[0].items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('marks single-item and utility groups as label-less', () => {
    const sections = navSections([item('dash', 'overview'), item('r', 'insights'), item('s', 'utility')]);
    expect(sections.every((s) => !s.labeled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/navigation/navGroups.ts
import type { AppRouteDefinition, NavGroup } from './routeRegistry';

/** Sidebar section order. Single-item groups render without a heading. */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  'overview', 'operations', 'finance', 'engagement',
  'property', 'insights', 'administration', 'utility',
];

/** Groups rendered as bare items (no uppercase heading). */
export const LABEL_LESS_GROUPS: ReadonlySet<NavGroup> = new Set([
  'overview', 'insights', 'utility',
]);

export interface NavSection {
  group: NavGroup;
  items: AppRouteDefinition[];
  labeled: boolean;
}

export function navSections(items: AppRouteDefinition[]): NavSection[] {
  return NAV_GROUP_ORDER
    .map((group) => ({
      group,
      items: items.filter((i) => i.navGroup === group),
      labeled: !LABEL_LESS_GROUPS.has(group),
    }))
    .filter((s) => s.items.length > 0);
}
```

In `routeRegistry.tsx` change the union:

```ts
export type NavGroup =
  | 'overview' | 'operations' | 'finance' | 'engagement'
  | 'property' | 'insights' | 'administration' | 'utility';
```

- [ ] **Step 4: Run test** → PASS (typecheck will fail until Task 3 assigns valid groups — that's expected; run `bun run test -- navGroups` only).
- [ ] **Step 5: Commit.**

### Task 3: Registry regroup + icons + Overview item

**Files:**
- Modify: `src/navigation/routeRegistry.tsx`
- Test: `src/navigation/navStructure.test.ts` (new)

- [ ] **Step 1: Failing integrity test**

```ts
import { describe, expect, it } from 'vitest';
import { navigationRouteDefinitions } from './routeRegistry';
import { NAV_GROUP_ORDER } from './navGroups';

describe('navigation registry integrity', () => {
  it('every nav item has an icon, a label source, and a known group', () => {
    for (const r of navigationRouteDefinitions) {
      expect(r.icon, `${r.id} icon`).toBeTruthy();
      expect(r.navLabel || r.breadcrumbLabel, `${r.id} label`).toBeTruthy();
      expect(NAV_GROUP_ORDER).toContain(r.navGroup);
    }
  });

  it('dashboard is the overview item and is visible to all staff', () => {
    const dash = navigationRouteDefinitions.find((r) => r.id === 'dashboard');
    expect(dash).toBeTruthy();
    expect(dash?.navGroup).toBe('overview');
    expect(dash?.accessControlled).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (dashboard has no navGroup today).
- [ ] **Step 3: Apply the registry edits**

  a. Imports: add `DashboardIcon`, `NotificationsIcon`, `CampaignIcon`, `LoyaltyIcon`, `Inventory2Icon`, `KingBedIcon`; remove unused ones that get replaced (`StarIcon` if loyalty swaps, `MeetingRoomIcon` if unused, `EventNoteIcon` stays for bookings).

  b. Reorder `routeDefinitions` so nav items are grouped per the table above, and apply these per-item changes:

```ts
// dashboard — was: no icon/navLabel/navGroup
{ id: 'dashboard', path: '/', component: DashboardRouter, animationType: 'fade',
  visibility: 'auth', icon: DashboardIcon, navLabel: 'Overview',
  breadcrumbLabel: 'Overview', navGroup: 'overview', accessControlled: false },
// bookings/timeline/guest-config/room-management/housekeeping/support → navGroup: 'operations'
// company-ledger/payment-approvals/night-audit/complimentary → navGroup: 'finance'
// loyalty (icon: LoyaltyIcon), promotions, communications (icon: CampaignIcon) → 'engagement'
// online-inventory (icon: Inventory2Icon), room-config (icon: KingBedIcon) → 'property'
// reports → 'insights'
// rbac/ekyc-admin/audit-log/data-transfer → 'administration'
// settings → 'utility'
// notifications — add icon: NotificationsIcon, navGroup: 'utility' (keep accessControlled: false)
// help — add navGroup: 'utility', navLabel: 'Help' (icon + breadcrumbLabel already exist)
```

  c. Leave non-nav routes (`my-rewards`, `profile`, `ekyc`, public/unauth) untouched.

- [ ] **Step 4: Run** `bun run test -- navStructure` → PASS; `bun run typecheck` → PASS.
- [ ] **Step 5: Commit.**

### Task 4: i18n keys (en + ms)

**Files:** `src/i18n/resources/en/nav.json`, `src/i18n/resources/ms/nav.json`

- [ ] **Step 1:** Replace `groups` block and add route/aria keys.

```json
// en
"groups": {
  "overview": "Overview",
  "operations": "Operations",
  "finance": "Finance",
  "engagement": "Engagement",
  "property": "Property",
  "insights": "Insights",
  "administration": "Administration",
  "utility": "Utilities"
},
"routes": { ...existing..., "dashboard": { "label": "Overview", "breadcrumb": "Overview" } },
"aria": { ...existing..., "collapseSidebar": "Collapse sidebar", "expandSidebar": "Expand sidebar", "breadcrumbs": "Breadcrumbs", "userMenu": "Account menu" }
```

```json
// ms
"groups": { "overview": "Utama", "operations": "Operasi", "finance": "Kewangan",
  "engagement": "Penglibatan", "property": "Hartanah", "insights": "Wawasan",
  "administration": "Pentadbiran", "utility": "Utiliti" },
"routes.dashboard": { "label": "Papan Pemuka", "breadcrumb": "Papan Pemuka" }
```

- [ ] **Step 2:** `bun run test -- resources` (i18n parity test) → PASS.
- [ ] **Step 3: Commit.**

### Task 5: Extract CommandPalette

**Files:**
- Create: `src/components/layout/CommandPalette.tsx`
- Modify: `src/components/layout/NavigationTabs.tsx` (strip palette code — file dies in Task 8; extraction now keeps the diff reviewable)

- [ ] **Step 1:** Move the palette implementation (state, recents, `useGlobalSearch`, scope chips, `routeForSelection`, keyboard nav, Popover) verbatim into `CommandPalette.tsx`. New API:

```tsx
const PaletteContext = createContext<{ open: () => void } | null>(null);
export const useCommandPalette = () => {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette outside provider');
  return ctx;
};

export const CommandPaletteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const isGuest = hasRole('guest') || /* user_type check as today */;
  const visibleItems = useMemo(
    () => navigationRouteDefinitions.filter((i) => canAccessNavigationRoute(i, { hasPermission, hasRole, getRoutePolicy })),
    [hasPermission, hasRole, getRoutePolicy]);
  const [open, setOpen] = useState(false);
  // ⌘K / Ctrl+K listener registered here (window keydown, as today)
  ...
  return <PaletteContext.Provider value={{ open: () => setOpen(true) }}>
    {children}
    {/* existing Popover markup, anchored to viewport center: use anchorPosition
        instead of anchorEl so any trigger can open it */}
  </PaletteContext.Provider>;
};
```

  Two deliberate changes while moving (document in commit):
  - Anchor: `anchorEl` → `anchorPosition={{ top: 72, left: '50%' }}` with `marginThreshold` + `sx` transform, since the trigger now lives in sidebar/topbar.
  - "New booking" action route: `'/bookings'` → `'/bookings?create=1'` (Task 10 consumes the param).
  - `bookingsRoute` CTA inside palette results unchanged.

- [ ] **Step 2:** Add `role="listbox"` to the results container and `role="option"` + `aria-selected={active}` to each item row (a11y gap found in audit).
- [ ] **Step 3:** `bun run typecheck` → PASS (NavigationTabs still compiles until Task 8 — keep its palette code deleted and have it render nothing for the palette yet; simplest: finish extraction + RootLayout mount in the same commit, then delete the file in Task 8).
- [ ] **Step 4: Commit.**

### Task 6: UserMenu + Breadcrumbs + AppTopbar

**Files:**
- Create: `src/components/layout/UserMenu.tsx`, `src/components/layout/Breadcrumbs.tsx`, `src/components/layout/AppTopbar.tsx`
- Test: `src/components/layout/Breadcrumbs.test.tsx`

- [ ] **Step 1: Breadcrumbs test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../router', () => ({
  useLocation: () => ({ pathname: '/night-audit', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('../../i18n', () => ({
  useTranslation: () => ({ tOr: (_k: string, fb: string) => fb }),
}));
import { Breadcrumbs } from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders group › page', () => {
    render(<Breadcrumbs />);
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.getByText('Night Audit')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `Breadcrumbs.tsx`** — pathname → `findRouteDefinition`; if route has `navGroup` and the group is labeled → `groupLabel(group)` as text + `breadcrumbLabel(route)` as `aria-current="page"`. Dashboard → single "Overview". Unknown/auth pages w/o group (profile, help): `Overview › {label}` where Overview links to `/`. Use `Link` for parent crumb; `<nav aria-label={tNav('aria.breadcrumbs')}>` wrapper; `Typography` crumbs, `›` separator via MUI `Breadcrumbs` component (import `Breadcrumbs as MuiBreadcrumbs`).

- [ ] **Step 3: Implement `UserMenu.tsx`** — extract the avatar pill + `Menu` (Profile → `/profile?edit=true`, Hotel Settings → `/settings` when `!isGuest`, Help → `/help`, Sign out → `logout()` + `/login`) from NavigationTabs. Trigger must be a focusable element:

```tsx
<Box component="button" type="button" aria-haspopup="menu"
  aria-expanded={userMenuOpen}
  aria-label={tNav('aria.userMenu')}
  onClick={(e) => setUserMenuAnchor(e.currentTarget)} ...>
```

  `variant="card"` renders the expanded sidebar bottom card (avatar + name + role, same menu).

- [ ] **Step 4: Implement `AppTopbar.tsx`**

```tsx
<Box component="header" sx={{
  height: 56, px: { xs: 1.5, sm: 2.5 }, display: 'flex', alignItems: 'center',
  gap: 1.5, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
  position: 'sticky', top: 0, zIndex: theme.zIndex.appBar,
}}>
  {isNarrow && <IconButton aria-label={tNav('aria.openMenu')} onClick={onMenuClick}><MenuIcon /></IconButton>}
  <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}><Breadcrumbs /></Box>
  <Box sx={{ flex: 1 }} />
  {/* compact search trigger → useCommandPalette().open() (40px icon on xs, field ≥sm) */}
  <NotificationCenter />  {/* darkBg prop removed — see task edit */}
  <LanguageSwitcher color="inherit" size="small" />
  <UserMenu variant="avatar" />
</Box>
```

- [ ] **Step 5: NotificationCenter edit** — remove `display: { xs: 'none', sm: 'inline-flex' }` so the bell exists on phones; remove now-unused `darkBg` prop branch (`iconColor` → `'inherit'`; keep prop optional-deprecated or drop and fix the single call site).
- [ ] **Step 6: Run** `bun run test -- Breadcrumbs` → PASS; typecheck → PASS.
- [ ] **Step 7: Commit.**

### Task 7: Sidebar components

**Files:**
- Create: `src/components/layout/sidebar/{SidebarNavItem,SidebarSection,SidebarContent,AppSidebar}.tsx`
- Modify: `src/utils/storage.ts` (add `'navCollapsed'` to `StorageKey`)
- Test: `src/components/layout/sidebar/SidebarContent.test.tsx`

- [ ] **Step 1: Test** — render `SidebarContent` with mocked auth (mirror `NotificationCenter.test.tsx` hoisted-mock pattern): admin sees all group labels; a policy-less user sees only non-`accessControlled` items; active item carries `aria-current="page"`.

```tsx
const mocks = vi.hoisted(() => ({ policies: {} as Record<string, RouteAccessPolicy>, perms: new Set<string>() }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => mocks.perms.has(p),
    hasRole: () => false,
    getRoutePolicy: (id: string) => mocks.policies[id],
    user: { full_name: 'Test User', username: 't' },
    logout: vi.fn(),
  }),
}));
// mock ../../router Link/useLocation/useNavigate, ../../i18n useTranslation (tOr: fallback)
// assert: with empty policies, 'Night Audit' absent, 'Overview' present.
```

- [ ] **Step 2: `SidebarNavItem.tsx`**

```tsx
<ListItemButton
  component={Link} to={item.path}
  selected={active}
  aria-current={active ? 'page' : undefined}
  onMouseEnter={() => preloadRoute(item.path)} onFocus={() => preloadRoute(item.path)}
  sx={{
    mx: 1, borderRadius: 1.5, minHeight: 40, px: 1.25, gap: 0,
    color: active ? 'text.primary' : 'text.secondary',
    '&.Mui-selected': { bgcolor: 'action.selected' },
    '&.Mui-selected::before': {            // non-color active indicator
      content: '""', position: 'absolute', left: -8, top: 8, bottom: 8,
      width: 3, borderRadius: 2, bgcolor: 'primary.main',
    },
    position: 'relative',
  }}
>
  <ListItemIcon sx={{ minWidth: 36, color: active ? 'primary.main' : 'text.secondary' }}>
    {Icon && <Icon sx={{ fontSize: 20 }} />}
  </ListItemIcon>
  {!collapsed && <ListItemText primary={navLabelFor(item)} slotProps={{ primary: { sx: { fontSize: '0.85rem', fontWeight: active ? 700 : 500, noWrap: true } } }} />}
</ListItemButton>
// collapsed → wrap in <Tooltip title={navLabelFor(item)} placement="right">; keep aria-label on the button
```

- [ ] **Step 3: `SidebarSection.tsx`** — labeled groups render an 11px uppercase caption (`groupLabel`) + items; single-item/utility groups render items only. Collapsible via local `Collapse` on the label click with `aria-expanded` (default expanded; utility has no collapse).

- [ ] **Step 4: `SidebarContent.tsx`** — vertical layout:

```
[brand: HotelIcon tile + hotelName → Link "/" ]
[search field: Box role="button" → useCommandPalette().open(), ⌘K hint ≥lg]
[New booking button → Link "/bookings?create=1" (if bookings item visible)]
<List component="nav" aria-label={tNav('aria.mainNavigation')} sx={{ flex: 1, overflowY: 'auto' }}>
  {navSections(visibleItems).map(s => <SidebarSection .../>)}
</List>
<Divider />  [utility items render inside navSections already — utility group]
<UserMenu variant="card" />
[collapse toggle: IconButton aria-label={collapse ? 'aria.expandSidebar' : 'aria.collapseSidebar'}]
```

  `visibleItems` = `navigationRouteDefinitions.filter(canAccessNavigationRoute)` — same memo as today. `collapsed` prop from `AppSidebar`. Each item's `active` flag is computed with `isNavItemActive(location.pathname, item)` (Task 1) inside `SidebarSection`/`SidebarNavItem`.

- [ ] **Step 5: `AppSidebar.tsx`**

```tsx
const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
const [collapsed, setCollapsed] = useState(() => storage.getItem<boolean>('navCollapsed') ?? false);
const toggle = () => { const next = !collapsed; setCollapsed(next); storage.setItem('navCollapsed', next); };
// Props: { mobileOpen: boolean; onMobileClose: () => void }
// ≥md: <Drawer variant="permanent"> paper width collapsed?72:264, borderRight 1px divider, bgcolor paper
// <md: <Drawer variant="temporary" open={mobileOpen} onClose={onMobileClose} ModalProps={{ keepMounted: true }}>
// both host <SidebarContent collapsed={!isNarrow && collapsed} onToggleCollapse={toggle} onNavigate={onMobileClose} />
```

  Transition: `width 0.2s` on the paper; mobile drawer keeps `ModalProps keepMounted` for perf.

- [ ] **Step 6: Run** component test → PASS; typecheck → PASS.
- [ ] **Step 7: Commit.**

### Task 8: RootLayout rewire + delete NavigationTabs

**Files:**
- Modify: `src/router/RootLayout.tsx`
- Delete: `src/components/layout/NavigationTabs.tsx`

- [ ] **Step 1:** Add `const [navDrawerOpen, setNavDrawerOpen] = useState(false);` inside `RootLayout`, then replace the AppBar block with the flex shell:

```tsx
return (
  <Box className={boardSkinActive ? 'hotel-board-shell' : undefined}
    sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
    <CommandPaletteProvider>
      <AppSidebar mobileOpen={navDrawerOpen} onMobileClose={() => setNavDrawerOpen(false)} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppTopbar onMenuClick={() => setNavDrawerOpen(true)} />
        <Container component="main" maxWidth="xl"
          className={boardSkinActive ? 'hotel-board-skin' : undefined}
          sx={{ mt: boardSkinActive ? 3 : 4, mb: 4, px: { xs: 2, sm: 3 }, flex: 1, contain: 'layout style', isolation: 'isolate' }}>
          <PageErrorBoundary><Suspense fallback={<LoadingFallback />}><Outlet /></Suspense></PageErrorBoundary>
        </Container>
      </Box>
      <Suspense fallback={<MinimalLoadingFallback />}>
        <FirstLoginPasskeyPrompt ... />
      </Suspense>
    </CommandPaletteProvider>
  </Box>
);
```

  Remove: `AppBar` import/element, `NavigationTabs` import, `appBarSkinActive`/`hotel-board-appbar` logic (sidebar/topbar are paper surfaces — the `--hotel-appbar-bg` gradient is retired by the reskin anyway). Keep `boardSkinActive` gates exactly as-is.

- [ ] **Step 2:** `grep -rn "NavigationTabs" src` → zero results; delete the file. All palette/user-menu/drawer code must already live in the new components — verify no orphaned imports (`useGlobalSearch` still used by palette only).
- [ ] **Step 3:** `bun run typecheck && bun run lint` → PASS.
- [ ] **Step 4: Commit.**

### Task 9: Bookings `?create=1` deep link

**Files:**
- Modify: `src/features/bookings/components/Bookings/BookingsPage.tsx`
- Test: extend `src/features/bookings/components/Bookings/BookingsPage.test.tsx`

- [ ] **Step 1: Test** — render page with `useSearchParams` returning `create=1`; assert `setCreateDialogOpen` path taken (assert modal title or mocked `UnifiedBookingModal` rendered).

- [ ] **Step 2: Implement** — BookingsPage already reads `pageSearchParams` (line ~126). Add:

```tsx
const createRequested = pageSearchParams.get('create') === '1';
useEffect(() => {
  if (createRequested) setCreateDialogOpen(true);
}, [createRequested]);

// where the dialog closes (existing onClose for createDialogOpen):
const closeCreateDialog = () => {
  setCreateDialogOpen(false);
  if (createRequested) {
    const next = new URLSearchParams(pageSearchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }
};
```

  (`setSearchParams` from the existing `useSearchParams` call — destructure the setter.)

- [ ] **Step 3: Run** targeted test → PASS; full `bun run test -- Bookings` → PASS.
- [ ] **Step 4: Commit.**

### Task 10: RBAC editor consumes the registry

**Files:** `src/features/admin/components/rbac/RolesTab/NavigationAccessSection.tsx`

- [ ] **Step 1:** Delete `NAV_ICON_MAP` + `NAVIGATION_CATEGORY_LABELS`. Group policies by the registry:

```tsx
const { groupLabel } = useRouteLabels();
const navByCategory = useMemo(() => {
  const byId = new Map(navigationRouteDefinitions.map((r) => [r.id, r]));
  return NAV_GROUP_ORDER
    .map((group) => ({
      group,
      labeled: !LABEL_LESS_GROUPS.has(group),
      items: routePolicies.filter((p) => p.is_navigation && byId.get(p.route_id)?.navGroup === group),
    }))
    .filter((s) => s.items.length > 0);
}, [routePolicies, groupLabel]);
```

  Icon per row: `byId.get(item.route_id)?.icon` rendered like the sidebar (`<Icon sx={{ fontSize: 18 }} />`, fallback `SettingsIcon`). Category header: `groupLabel(group)` when `labeled`, else `'General'`/`'Other'` fallback for label-less groups (admin context wants a caption — use `groupLabel` anyway; labels exist for all groups in nav.json).
  Keep the existing Switch/tooltip/`onToggleNavItem` wiring untouched.
- [ ] **Step 2:** `bun run typecheck` → PASS.
- [ ] **Step 3: Commit.**

### Task 11: Premium reskin (theme.ts + index.css)

**Files:** `src/theme.ts`, `src/index.css`

All changes are value substitutions inside `createAppTheme` — no structural changes. Apply per mode variable:

- [ ] **Step 1: Tokens**

```ts
const boardBorder = isLight ? '#d9ded9' : selected.divider;          // was '#202124' / '#dbe7e1'
const boardShadow = '0 1px 2px rgba(16,24,40,0.06)';                 // was '4px 4px 0 rgba(...)'
const boardLargeShadow = '0 4px 14px rgba(16,24,40,0.10)';           // was '8px 8px 0 rgba(...)'
const boardDash = selected.divider;                                  // keep for non-dashed use
const appBarBackground = selected.background.paper;                  // retire gradient
```

- [ ] **Step 2: Board-skin overrides** — in the `MuiCssBaseline.styleOverrides` board-skin block, replace throughout: `2px solid` → `1px solid` (cards, tables, alerts, accordions, dialogs/popovers via `.hotel-board-skin`/body rules), `dashed ${boardDash}` → `1px solid ${selected.divider}`, `fontWeight: 900` → `700` (headings, buttons, chips, table head, tabs → 600), `translate(-1px,-1px)` card hover → keep soft shadow only. Buttons `borderWidth: 2` → `1`. `MuiTab`/`MuiTabs` `2px` → `1px`, weight 800 → 600.
- [ ] **Step 3: `index.css`** — remove the `backgroundImage` grid lines from `.hotel-board-shell` (keep `backgroundColor`).
- [ ] **Step 4:** `AppBar`/`--hotel-appbar-bg` — sidebar/topbar use `background.paper`; leave the CSS var defined (harmless) but unused; delete `hotel-board-appbar` references (RootLayout already dropped them in Task 8).
- [ ] **Step 5: Dead-code cleanup** — in `SidebarContent`/palette code: no `darkBg ? '#fff' : '#fff'` (don't port it). `hotelName` in `SidebarContent`: subscribe to `hotelSettingsChange` like RootLayout does (fix the stale-name bug while the code is new).
- [ ] **Step 6: Verify** — `bun run typecheck && bun run lint && bun run test` → PASS; `bun run build` → PASS. Manual: spot-check dashboard, bookings, settings in all 3 theme modes for reskin regressions.
- [ ] **Step 7: Commit.**

### Task 12: Final verification + housekeeping

- [ ] **Step 1:** `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test` — all three gates PASS.
- [ ] **Step 2:** `bun run build` — PASS.
- [ ] **Step 3:** `git status --short` — confirm only this plan's files are staged/committed; concurrent session's files untouched.
- [ ] **Step 4:** Manual matrix (report results): 375/768/1024/1440 widths × light/night × admin vs receptionist nav sets; keyboard-only: tab → sidebar → ⌘K → user menu → drawer Escape.
- [ ] **Step 5:** Write the before/after summary: files changed, IA mapping, a11y deltas, known limitations (palette is Popover not dialog; in-page tabs still `useState` — listed as follow-up).

## Deferred (explicitly out of scope — tell the user)

- In-page tab → `?tab=` URL state (9 pages) — follow-up phase.
- `online-inventory` hardcoded policy fallback in `canAccessNavigationRoute`/`ProtectedRoute` — backend seed already ships the policy; removal is a separate cleanup.
- Full keyboard shortcut map beyond ⌘K; pinned/favorite pages.
- DB `nav_group`/`nav_label` strings now diverge from the registry — cosmetic only; a catalog patch would be required to sync them (not recommended; registry is now source of truth for grouping).
