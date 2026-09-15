import { useMediaQuery, useTheme } from '@mui/material';

/**
 * The canonical "phone-sized viewport" predicate: below the `sm` breakpoint.
 * `noSsr` resolves client-side on first render so the mobile paint never
 * flashes desktop layout.
 *
 * `sm` is the shell's phone/tablet boundary too: below it the bottom bar is
 * the navigation, at and above it the sidebar rail takes over (`AppSidebar`).
 * So a surface that swaps to a phone layout on `useIsPhone()` is swapping at
 * the same width the chrome does. Remember that the branch NOT taken then
 * covers tablets as well as desktops — a wide table on the false branch still
 * needs `TableScroll` or a `TableContainer` to survive a 768px viewport.
 */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
}
