import { useMediaQuery, useTheme } from '@mui/material';

/**
 * How many category ticks a chart's bottom axis can show at the current
 * viewport, for use as `thinTicks(values, budget)`.
 *
 * `thinTicks` defaults to 8, which is tuned for a desktop card. A phone plot
 * area is roughly 230px wide once the y-axis margin is taken off, and a
 * `fmtShortDate` label ("12 Sep") needs ~40px, so eight of them overlap into
 * an unreadable smear. These budgets keep roughly 55px per label at every
 * size instead:
 *
 *   phone   (<sm)      4
 *   tablet  (sm-lg)    6
 *   desktop (>=lg)     8
 *
 * Viewport rather than container width: every chart using this sits in a card
 * that tracks the page width, so the two move together, and this avoids a
 * ResizeObserver per chart. A chart in a narrow fixed column should pass its
 * own budget instead.
 */
export function useTickBudget(): number {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isBelowDesktop = useMediaQuery(theme.breakpoints.down('lg'), { noSsr: true });
  if (isPhone) return 4;
  return isBelowDesktop ? 6 : 8;
}
