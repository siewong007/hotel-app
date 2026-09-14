import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './auth/AuthContext';
import { queryClient } from './api/queryClient';
import { createAppTheme, normalizeThemeMode, ThemeMode } from './theme';
import { DesktopServiceGate } from './desktop/DesktopServiceGate';
import { storage } from './utils/storage';
import { ApiNotificationHost } from './components/common/ApiNotificationHost';
import { RealtimeInvalidator } from './components/common/RealtimeInvalidator';
import { ConfirmProvider } from './components/common/ConfirmProvider';
import { I18nProvider } from './i18n';
import { router } from './router/router';
import { ThemeModeContext } from './router/ThemeModeContext';

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    normalizeThemeMode(storage.getItem<string>('themeMode'))
  );
  const activeTheme = useMemo(() => createAppTheme(themeMode), [themeMode]);
  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    storage.setItem('themeMode', mode);
  };
  const themeModeContextValue = useMemo(
    () => ({ themeMode, onThemeModeChange: handleThemeModeChange }),
    [themeMode]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider theme={activeTheme}>
          <CssBaseline />
          <DesktopServiceGate>
            <AuthProvider>
              <RealtimeInvalidator />
              <ApiNotificationHost />
              <ThemeModeContext.Provider value={themeModeContextValue}>
                <ConfirmProvider>
                  <RouterProvider router={router} />
                </ConfirmProvider>
              </ThemeModeContext.Provider>
            </AuthProvider>
          </DesktopServiceGate>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
