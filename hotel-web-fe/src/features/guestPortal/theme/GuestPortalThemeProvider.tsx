import { useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { Box } from '@mui/material';
import { ThemeModeContext } from '../../../router/ThemeModeContext';
import { normalizeThemeMode, type ThemeMode } from '../../../theme';
import { storage } from '../../../utils/storage';
import { createGuestPortalTheme, guestPortalCssVars } from './guestPortalTheme';

interface GuestPortalThemeProviderProps {
  children: ReactNode;
  /** Explicit mode override; defaults to the app ThemeModeContext, then the
   *  stored mode — bare test renders have neither and fall back to dark. */
  mode?: ThemeMode;
}

/**
 * Guest theme island. Provides the guest MUI theme AND republishes the
 * `--hotel-*` custom properties on a wrapper element so token-driven CSS
 * resolves guest values even when the document :root carries another theme
 * (the staff-app compat render of /guest-portal). Inside guest.html the
 * values simply match what the guest CssBaseline already put on :root.
 * Portaled overlays (menus, dialogs) escape the wrapper; in guest.html they
 * still resolve guest vars from :root — the staff-doc fallback keeps inline
 * content correct and inherits staff vars only for overlays.
 */
export function GuestPortalThemeProvider({ children, mode }: GuestPortalThemeProviderProps) {
  const themeModeContext = useContext(ThemeModeContext);
  const resolved = mode
    ?? themeModeContext?.themeMode
    ?? normalizeThemeMode(storage.getItem<string>('themeMode'));
  const theme = useMemo(() => createGuestPortalTheme(resolved), [resolved]);
  const vars = useMemo(() => guestPortalCssVars(resolved), [resolved]);

  return (
    <ThemeProvider theme={theme}>
      <Box style={vars as CSSProperties}>{children}</Box>
    </ThemeProvider>
  );
}
