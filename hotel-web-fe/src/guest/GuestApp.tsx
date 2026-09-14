import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from '../auth/AuthContext';
import { queryClient } from '../api/queryClient';
import { createAppTheme, normalizeThemeMode, type ThemeMode } from '../theme';
import { storage } from '../utils/storage';
import { ApiNotificationHost } from '../components/common/ApiNotificationHost';
import { ConfirmProvider } from '../components/common/ConfirmProvider';
import { I18nProvider } from '../i18n';
import { ThemeModeContext } from '../router/ThemeModeContext';
import { guestRouter } from './guestRouter';

export default function GuestApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    normalizeThemeMode(storage.getItem<string>('themeMode')),
  );
  const activeTheme = useMemo(() => createAppTheme(themeMode), [themeMode]);
  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    storage.setItem('themeMode', mode);
  };
  const themeModeContextValue = useMemo(
    () => ({ themeMode, onThemeModeChange: handleThemeModeChange }),
    [themeMode],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider theme={activeTheme}>
          <CssBaseline />
          <AuthProvider>
            <ApiNotificationHost />
            <ThemeModeContext.Provider value={themeModeContextValue}>
              <ConfirmProvider>
                <RouterProvider router={guestRouter} />
              </ConfirmProvider>
            </ThemeModeContext.Provider>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
