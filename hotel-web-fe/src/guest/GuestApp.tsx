import { useEffect, useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from '../auth/AuthContext';
import { queryClient } from '../api/queryClient';
import { type ThemeMode } from '../theme';
import { storage } from '../utils/storage';
import { ApiNotificationHost } from '../components/common/ApiNotificationHost';
import { ConfirmProvider } from '../components/common/ConfirmProvider';
import { I18nProvider } from '../i18n';
import { ThemeModeContext } from '../router/ThemeModeContext';
import { createGuestPortalTheme } from '../features/guestPortal/theme/guestPortalTheme';
import {
  GUEST_THEME_STORAGE_KEY,
  normalizeGuestThemePreference,
  type GuestThemePreference,
} from '../features/guestPortal/theme/guestTokens';
import {
  GuestThemePreferenceContext,
  systemPrefersDark,
} from '../features/guestPortal/theme/guestThemePreference';
import { guestRouter } from './guestRouter';

export default function GuestApp() {
  // Guest-facing theming lives on its own storage key: 'system' is a valid
  // guest preference that the staff app's normalizeThemeMode must never see
  // (it would fold to dark). The legacy shared `themeMode` key seeds the
  // preference once for existing guests, then is left alone.
  const [preference, setPreference] = useState<GuestThemePreference>(() =>
    normalizeGuestThemePreference(
      storage.getItem<string>(GUEST_THEME_STORAGE_KEY) ??
        storage.getItem<string>('themeMode'),
    ),
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const themeMode: ThemeMode =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  const activeTheme = useMemo(() => createGuestPortalTheme(themeMode), [themeMode]);
  const handlePreferenceChange = (next: GuestThemePreference) => {
    setPreference(next);
    storage.setItem(GUEST_THEME_STORAGE_KEY, next);
  };
  const themeModeContextValue = useMemo(
    () => ({ themeMode, onThemeModeChange: handlePreferenceChange }),
    [themeMode],
  );
  const guestThemeContextValue = useMemo(
    () => ({ preference, onPreferenceChange: handlePreferenceChange }),
    [preference],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider theme={activeTheme}>
          <CssBaseline />
          <AuthProvider>
            <ApiNotificationHost />
            <ThemeModeContext.Provider value={themeModeContextValue}>
              <GuestThemePreferenceContext.Provider value={guestThemeContextValue}>
                <ConfirmProvider>
                  <RouterProvider router={guestRouter} />
                </ConfirmProvider>
              </GuestThemePreferenceContext.Provider>
            </ThemeModeContext.Provider>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
