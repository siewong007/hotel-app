import { Suspense, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppBar, Box, Container } from '@mui/material';
import { BrowserRouter as Router, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { createAppTheme, ThemeMode } from './theme';
import { NavigationTabs } from './components/layout/NavigationTabs';
import { UnauthRoutes, AuthRoutes, FirstLoginPasskeyPrompt, LoadingFallback, MinimalLoadingFallback } from './routes';
import { DesktopServiceGate } from './desktop/DesktopServiceGate';
import { storage } from './utils/storage';
import { ApiNotificationHost } from './components/common/ApiNotificationHost';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'night';
}

function AppContent({ themeMode, onThemeModeChange }: { themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();
  const location = useLocation();
  const isTimelinePage = location.pathname.startsWith('/timeline');
  // Body-level board skin (cards, dialogs, tables) keeps its legacy scope and skips the timeline page.
  const boardSkinActive = isAuthenticated && !isTimelinePage;
  // The AppBar uses the universal sage-green design on every authenticated page, including timeline.
  const appBarSkinActive = isAuthenticated;

  useEffect(() => {
    document.body.classList.toggle('hotel-board-skin-active', boardSkinActive);
    return () => {
      document.body.classList.remove('hotel-board-skin-active');
    };
  }, [boardSkinActive]);

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!isAuthenticated) {
    return <UnauthRoutes />;
  }

  return (
    <Box
      className={boardSkinActive ? 'hotel-board-shell' : undefined}
      sx={{ flexGrow: 1, minHeight: '100vh', backgroundColor: 'background.default' }}
    >
      <AppBar
        position="sticky"
        elevation={0}
        className={appBarSkinActive ? 'hotel-board-appbar' : undefined}
        sx={appBarSkinActive ? {
          background: 'var(--hotel-appbar-bg)',
          color: '#ffffff',
          borderBottom: '1px solid rgba(0,0,0,0.12)',
          boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
        } : undefined}
      >
        <NavigationTabs
          darkBg={appBarSkinActive}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
        />
      </AppBar>

      <Suspense fallback={<MinimalLoadingFallback />}>
        <FirstLoginPasskeyPrompt
          open={shouldPromptPasskey}
          username={user?.username || ''}
          onClose={dismissPasskeyPrompt}
        />
      </Suspense>

      <Container
        maxWidth="xl"
        className={boardSkinActive ? 'hotel-board-skin' : undefined}
        sx={{ mt: boardSkinActive ? 3 : 4, mb: 4, px: { xs: 2, sm: 3 }, minHeight: 'calc(100vh - 200px)', contain: 'layout style', isolation: 'isolate' }}
      >
        <AuthRoutes />
      </Container>
    </Box>
  );
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

  return (
    <ThemeProvider theme={activeTheme}>
      <CssBaseline />
      <ApiNotificationHost />
      <DesktopServiceGate>
        <AuthProvider>
          <Router>
            <Suspense fallback={<LoadingFallback />}>
              <AppContent themeMode={themeMode} onThemeModeChange={handleThemeModeChange} />
            </Suspense>
          </Router>
        </AuthProvider>
      </DesktopServiceGate>
    </ThemeProvider>
  );
}

export default App;
