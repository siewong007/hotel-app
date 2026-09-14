import { useMediaQuery, useTheme } from '@mui/material';

/**
 * The canonical "phone-sized viewport" predicate: below the `sm` breakpoint.
 * `noSsr` resolves client-side on first render so the mobile paint never
 * flashes desktop layout. Wider shell-level changes (sidebar→drawer) live at
 * `md` — keep using `theme.breakpoints.down('md')` for those.
 */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
}
