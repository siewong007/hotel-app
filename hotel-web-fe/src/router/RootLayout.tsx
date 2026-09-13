import React, { Suspense, useEffect, useState } from 'react';
import { Box, Container, useMediaQuery, useTheme } from '@mui/material';
import { Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { isPublicGuestPath } from '../guest/guestDocumentPaths';
import { CrossAppRedirect } from '../guest/CrossAppRedirect';
import { AppSidebar } from '../components/layout/sidebar/AppSidebar';
import { AppTopbar } from '../components/layout/AppTopbar';
import { CommandPaletteProvider } from '../components/layout/CommandPalette';
import { LoadingFallback, MinimalLoadingFallback } from './RouteFallbacks';
import { FirstLoginPasskeyPrompt } from '../navigation/routeRegistry';
import { ErrorBoundary, PageErrorBoundary } from '../components';
import { GuestPortalShell } from '../features/guestPortal/components/GuestPortalShell';
import { getHotelSettings } from '../utils/hotelSettings';

// Used only if `hotel_name` is configured empty; the settings themselves carry
// a default, so this is a last resort rather than the normal title.
const FALLBACK_APP_TITLE = 'Hotel ERP System';
const ADMIN_FAVICON = '/favicon.ico';
const GUEST_FAVICON = '/salim-inn/salim-inn-icon.svg';

export const RootLayout: React.FC = () => {
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const searchStr = location.searchStr ? `?${location.searchStr.replace(/^\?+/, '')}` : '';
  const publicGuestPath = isPublicGuestPath(pathname, searchStr);
  const isGuestPortal = pathname === '/guest-portal';
  // Booking is the one portal view open to visitors with no account: they book
  // anonymously and pay through a booking-scoped link. Every other section
  // reads account-owned data and stays gated below.
  const isPublicBooking =
    isGuestPortal && (location.search as { view?: string }).view === 'booking';
  const isAdminPortal = pathname === '/admin-portal';
  const isOffersPage = pathname === '/offers' || pathname.startsWith('/offers/');
  const isGuestExperience = isGuestPortal || isOffersPage || pathname === '/register' || pathname === '/login' || pathname === '/complete-profile';
  const isGuestModelHome = isGuestPortal;
  const isTimelinePage = pathname.startsWith('/timeline');
  const boardSkinActive =
    isAuthenticated && !isTimelinePage && !isGuestPortal && !isOffersPage && !isGuestModelHome;
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });

  useEffect(() => {
    document.body.classList.toggle('hotel-board-skin-active', boardSkinActive);
    return () => {
      document.body.classList.remove('hotel-board-skin-active');
    };
  }, [boardSkinActive]);

  // The tab title is the configured hotel name for both the guest and staff
  // experiences; only the favicon distinguishes them. `hotelSettingsChange`
  // fires on the boot refresh and whenever Settings is saved.
  const [hotelName, setHotelName] = useState(() => getHotelSettings().hotel_name);

  useEffect(() => {
    const syncHotelName = () => setHotelName(getHotelSettings().hotel_name);
    window.addEventListener('hotelSettingsChange', syncHotelName);
    return () => window.removeEventListener('hotelSettingsChange', syncHotelName);
  }, []);

  useEffect(() => {
    const displayName = hotelName.trim() || FALLBACK_APP_TITLE;
    document.title = displayName;
    // The sign-in/register card's eyebrow is a CSS ::before, so its text has to
    // reach the stylesheet as a quoted custom property (see .auth-card in index.css).
    document.documentElement.style.setProperty(
      '--auth-brand-eyebrow',
      JSON.stringify(displayName)
    );

    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
    if (favicon) favicon.href = isGuestExperience ? GUEST_FAVICON : ADMIN_FAVICON;
  }, [isGuestExperience, hotelName]);

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
    if (isLoading && !isPublicBooking) return <LoadingFallback />;

    // A portal bearer token is only a short-lived companion to a signed-in
    // guest account. Do not render portal routes while the account state is
    // unknown, signed out, or belongs to an operational user — except the
    // booking view, which is reachable with no account at all.
    if (!isAuthenticated && !isPublicBooking && !isLoading) {
      // Typed-route shim contract — see router/compat.tsx.
      return <CrossAppRedirect to="/login" />;
    }

    // Only meaningful once signed in; an anonymous booker has no `user`.
    if (isAuthenticated && user?.user_type !== 'guest') {
      return <Navigate to="/" replace />;
    }

    return (
      <GuestPortalShell showAccountNav={isAuthenticated}>
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
    // Typed-route shim contract — see router/compat.tsx.
    if (!isAuthenticated) return <CrossAppRedirect to="/login" />;
    if (user?.user_type === 'guest') return <CrossAppRedirect to="/guest-portal" />;
  }

  // Public consumer pages and the signed-in guest's model home remain outside
  // the operational staff shell.
  if (publicGuestPath) {
    return (
      <ErrorBoundary title="Guest Experience Error">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

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
      sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}
    >
      <CommandPaletteProvider>
        <AppSidebar
          mobileOpen={navDrawerOpen}
          onMobileClose={() => setNavDrawerOpen(false)}
        />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <AppTopbar
            onMenuClick={() => setNavDrawerOpen(true)}
            isNarrow={isNarrow}
          />
          <Container
            component="main"
            maxWidth="xl"
            className={boardSkinActive ? 'hotel-board-skin' : undefined}
            sx={{ mt: boardSkinActive ? 3 : 4, mb: 4, px: { xs: 2, sm: 3 }, flex: 1, contain: 'layout style', isolation: 'isolate' }}
          >
            <PageErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
          </Container>
        </Box>

        <Suspense fallback={<MinimalLoadingFallback />}>
          <FirstLoginPasskeyPrompt
            open={shouldPromptPasskey}
            username={user?.username || ''}
            onClose={dismissPasskeyPrompt}
          />
        </Suspense>
      </CommandPaletteProvider>
    </Box>
  );
};
