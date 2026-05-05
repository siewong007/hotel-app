import { Suspense, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppBar, Box, Container, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography } from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import HotelIcon from '@mui/icons-material/Hotel';
import LightModeIcon from '@mui/icons-material/LightMode';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import { BrowserRouter as Router, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { createAppTheme, ThemeMode } from './theme';
import { NavigationTabs } from './components/layout/NavigationTabs';
import { UnauthRoutes, AuthRoutes, FirstLoginPasskeyPrompt, LoadingFallback, MinimalLoadingFallback } from './routes';
import { DesktopServiceGate } from './desktop/DesktopServiceGate';
import { storage } from './utils/storage';

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
          background: '#3f8f5b',
          color: '#ffffff',
          borderBottom: '1px solid rgba(0,0,0,0.12)',
          boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
        } : undefined}
      >
        <Toolbar sx={{ minHeight: 64, px: { xs: 2, sm: 3 } }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              cursor: 'pointer',
              mr: 3,
              flexShrink: 0,
              '&:hover': { opacity: 0.92 },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                borderRadius: 1.5,
                bgcolor: appBarSkinActive ? 'rgba(255,247,225,0.96)' : 'rgba(255,255,255,0.15)',
                color: appBarSkinActive ? '#a06a2c' : 'white',
                mr: 1.5,
                boxShadow: appBarSkinActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <HotelIcon sx={{ fontSize: 22, color: 'inherit' }} />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography
                variant="body1"
                sx={{ fontWeight: 800, color: appBarSkinActive ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.7)', lineHeight: 1.15, letterSpacing: '-0.01em' }}
              >
                Hotel Manager
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: appBarSkinActive ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.7)',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  letterSpacing: 0.3,
                }}
              >
                Management System
              </Typography>
            </Box>
          </Box>
          <NavigationTabs darkBg={appBarSkinActive} />
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={themeMode}
            onChange={(_, value) => {
              if (isThemeMode(value)) onThemeModeChange(value);
            }}
            sx={{
              ml: 2,
              bgcolor: appBarSkinActive ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.12)',
              borderRadius: 999,
              p: 0.25,
              '& .MuiToggleButton-root': {
                color: appBarSkinActive ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.78)',
                border: 'none',
                borderRadius: '999px !important',
                px: 1,
                '&.Mui-selected': {
                  color: appBarSkinActive ? '#1f5a36' : '#111',
                  bgcolor: 'rgba(255,255,255,0.95)',
                },
                '&.Mui-selected:hover': {
                  bgcolor: 'rgba(255,255,255,0.85)',
                },
                '&:hover': {
                  bgcolor: 'rgba(255,255,255,0.18)',
                },
              },
            }}
          >
            <ToggleButton value="light" aria-label="Light mode">
              <Tooltip title="Light mode"><LightModeIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="dark" aria-label="Dark mode">
              <Tooltip title="Dark mode"><DarkModeIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="night" aria-label="Night mode">
              <Tooltip title="Night mode"><NightsStayIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Toolbar>
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
