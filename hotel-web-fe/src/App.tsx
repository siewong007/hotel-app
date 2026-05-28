import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from './auth/AuthContext';
import { queryClient } from './api/queryClient';
import { createAppTheme, ThemeMode } from './theme';
import { DesktopServiceGate } from './desktop/DesktopServiceGate';
import { storage } from './utils/storage';
import { ApiNotificationHost } from './components/common/ApiNotificationHost';
import { router } from './router/router';
import { ThemeModeContext } from './router/ThemeModeContext';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'night';
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = storage.getItem<ThemeMode>('themeMode');
    return isThemeMode(stored) ? stored : 'light';
  });
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
      <ThemeProvider theme={activeTheme}>
        <CssBaseline />
        <ApiNotificationHost />
        <DesktopServiceGate>
          <AuthProvider>
            <ThemeModeContext.Provider value={themeModeContextValue}>
              <RouterProvider router={router} />
            </ThemeModeContext.Provider>
          </AuthProvider>
        </DesktopServiceGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
