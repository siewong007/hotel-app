import React, { Suspense, useEffect } from 'react';
import { AppBar, Box, Container } from '@mui/material';
import { Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { NavigationTabs } from '../components/layout/NavigationTabs';
import { LoadingFallback, MinimalLoadingFallback } from './RouteFallbacks';
import { FirstLoginPasskeyPrompt } from '../navigation/routeRegistry';
import { ErrorBoundary, PageErrorBoundary } from '../components';
import { GuestPortalShell } from '../features/guestPortal/components/GuestPortalShell';

const ADMIN_APP_TITLE = 'Hotel ERP System';
const GUEST_APP_TITLE = 'Salim Inn Sibu - Cozy stays at Farley';
const ADMIN_FAVICON = '/favicon.ico';
const GUEST_FAVICON = '/salim-inn/salim-inn-icon.svg';

export const RootLayout: React.FC = () => {
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const isGuestPortal = pathname === '/guest-portal';
  const isAdminPortal = pathname === '/admin-portal';
  const isOffersPage = pathname === '/offers' || pathname.startsWith('/offers/');
  const account = (location.search as { account?: string }).account;
  const isGuestLogin = pathname === '/login' && account === 'guest';
  const isGuestExperience = isGuestPortal || isOffersPage || pathname === '/register' || isGuestLogin;
  const isGuestModelHome = isGuestPortal;
  const isTimelinePage = pathname.startsWith('/timeline');
  const boardSkinActive =
    isAuthenticated && !isTimelinePage && !isGuestPortal && !isOffersPage && !isGuestModelHome;
  const appBarSkinActive = isAuthenticated;

  useEffect(() => {
    document.body.classList.toggle('hotel-board-skin-active', boardSkinActive);
    return () => {
      document.body.classList.remove('hotel-board-skin-active');
    };
  }, [boardSkinActive]);

  useEffect(() => {
    document.title = isGuestExperience ? GUEST_APP_TITLE : ADMIN_APP_TITLE;

    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
    if (favicon) favicon.href = isGuestExperience ? GUEST_FAVICON : ADMIN_FAVICON;
  }, [isGuestExperience]);

  useEffect(() => {
    const showResourceLocked = () => {
      void navigate({ to: '/423' });
    };

    window.addEventListener('api:resource-locked', showResourceLocked);
    return () => window.removeEventListener('api:resource-locked', showResourceLocked);
  }, [navigate]);

  // Portal pages share the Salim Inn guest experience instead of inheriting
  // the operational staff navigation.
  if (isGuestPortal) {
    if (isLoading) return <LoadingFallback />;

    // A portal bearer token is only a short-lived companion to a signed-in
    // guest account. Do not render portal routes while the account state is
    // unknown, signed out, or belongs to an operational user.
    if (!isAuthenticated) {
      return <Navigate to="/login" search={{ account: 'guest' } as any} replace />;
    }

    if (user?.user_type !== 'guest') {
      return <Navigate to="/" replace />;
    }

    return (
      <GuestPortalShell>
        <ErrorBoundary title="Guest Experience Error">
          <Suspense fallback={<LoadingFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </GuestPortalShell>
    );
  }

  if (isAdminPortal) {
    if (isLoading) return <LoadingFallback />;
    if (!isAuthenticated) return <Navigate to="/login" search={{ account: 'admin' } as any} replace />;
    if (user?.user_type === 'guest') return <Navigate to={'/guest-portal' as any} replace />;
  }

  // Public consumer pages and the signed-in guest's model home remain outside
  // the operational staff shell.
  if (isOffersPage || isGuestModelHome) {
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
