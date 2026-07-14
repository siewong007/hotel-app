import React, { Suspense, useEffect } from 'react';
import { AppBar, Box, Container } from '@mui/material';
import { Outlet, useLocation } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { NavigationTabs } from '../components/layout/NavigationTabs';
import { LoadingFallback, MinimalLoadingFallback } from './RouteFallbacks';
import { FirstLoginPasskeyPrompt } from '../navigation/routeRegistry';
import { ErrorBoundary, PageErrorBoundary } from '../components';

export const RootLayout: React.FC = () => {
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;
  const isGuestPortal = pathname === '/portal' || pathname.startsWith('/portal/');
  const isOffersPage = pathname === '/offers' || pathname.startsWith('/offers/');
  const isConsumerRoute = isGuestPortal || isOffersPage;
  const isTimelinePage = pathname.startsWith('/timeline');
  const boardSkinActive = isAuthenticated && !isTimelinePage && !isConsumerRoute;
  const appBarSkinActive = isAuthenticated;

  useEffect(() => {
    document.body.classList.toggle('hotel-board-skin-active', boardSkinActive);
    return () => {
      document.body.classList.remove('hotel-board-skin-active');
    };
  }, [boardSkinActive]);

  // Consumer routes must neither wait for nor inherit the staff account shell
  // when a staff session also exists in the same browser.
  if (isConsumerRoute) {
    return (
      <ErrorBoundary title="Guest Experience Error">
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (isLoading) return <LoadingFallback />;

  if (!isAuthenticated) {
    return (
      <ErrorBoundary title="Authentication Error">
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
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
        <NavigationTabs darkBg={appBarSkinActive} />
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
        <PageErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <Outlet />
          </Suspense>
        </PageErrorBoundary>
      </Container>
    </Box>
  );
};
