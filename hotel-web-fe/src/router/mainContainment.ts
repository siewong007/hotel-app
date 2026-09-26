import type { CSSProperties } from 'react';

/**
 * Containment for the app shell's `<main>`.
 *
 * Never add `contain: layout|paint|strict|content`, a `transform`, `filter`,
 * `perspective` or `will-change: transform` here (or on the route wrapper in
 * AnimatedRoute): each makes `<main>` the containing block for every
 * `position: fixed` descendant, so page-level bottom bars (save bars, the
 * Online Inventory pending-changes bar, StickyActionBar) end up pinned to the
 * bottom of the scrolling content instead of the viewport. `contain: style`
 * and `isolation` are safe — neither affects fixed positioning.
 */
export const MAIN_CONTAINMENT: Pick<CSSProperties, 'contain' | 'isolation'> = {
  contain: 'style',
  isolation: 'isolate',
};

/** Style props that would trap `position: fixed` descendants. */
export function trapsFixedDescendants(style: CSSProperties): boolean {
  const contain = String(style.contain ?? '');
  if (/\b(layout|paint|strict|content)\b/.test(contain)) return true;
  if (style.transform && style.transform !== 'none') return true;
  if (style.filter && style.filter !== 'none') return true;
  if (style.perspective && style.perspective !== 'none') return true;
  if (/\b(transform|filter|perspective)\b/.test(String(style.willChange ?? ''))) return true;
  return false;
}
