import React, { Suspense } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import { BrowserRouter as Router, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { theme } from './theme';
import { NavigationTabs } from './components/layout/NavigationTabs';
import { BreadcrumbNav } from './components/layout/BreadcrumbNav';
import { UnauthRoutes, AuthRoutes, FirstLoginPasskeyPrompt, LoadingFallback, MinimalLoadingFallback } from './routes';

function AppContent() {
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!isAuthenticated) {
    return <UnauthRoutes />;
  }

  return (
    <Box sx={{ flexGrow: 1, minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ minHeight: 64, px: { xs: 2, sm: 3 } }}>
          <Box
            component={Link}
            to="/"
            sx={{ display: 'flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer', mr: 3, flexShrink: 0, '&:hover': { opacity: 0.9 } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.15)', mr: 1.5 }}>
              <HotelIcon sx={{ fontSize: 22, color: 'white' }} />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body1" sx={{ fontWeight: 700, color: 'white', lineHeight: 1.2 }}>Hotel Manager</Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem' }}>Management System</Typography>
            </Box>
          </Box>
          <NavigationTabs />
        </Toolbar>
      </AppBar>

      <BreadcrumbNav />

      <Suspense fallback={<MinimalLoadingFallback />}>
        <FirstLoginPasskeyPrompt
          open={shouldPromptPasskey}
          username={user?.username || ''}
          onClose={dismissPasskeyPrompt}
        />
      </Suspense>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 }, minHeight: 'calc(100vh - 200px)', contain: 'layout style', isolation: 'isolate' }}>
        <AuthRoutes />
      </Container>
    </Box>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <Suspense fallback={<LoadingFallback />}>
            <AppContent />
          </Suspense>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
