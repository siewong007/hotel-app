/**
 * Marks a page-level bar pinned above the phone bottom nav (a save bar, the
 * Online Inventory pending-changes bar, StickyActionBar). While one is on the
 * page the Quick actions FAB steps aside: it sits in the same bottom-right
 * corner, and because the app shell's <main> is its own stacking context the
 * FAB would otherwise always paint over the bar's primary button.
 *
 * Spread onto the bar: `<Paper {...mobileActionBarProps} …>`.
 */
export const MOBILE_ACTION_BAR_ATTR = 'data-mobile-action-bar';

export const mobileActionBarProps = { [MOBILE_ACTION_BAR_ATTR]: '' } as const;

/** Selector prefix for elements that must yield to a mobile action bar. */
export const WHILE_MOBILE_ACTION_BAR = `body:has([${MOBILE_ACTION_BAR_ATTR}]) &`;
