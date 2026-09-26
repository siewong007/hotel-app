import React, { Suspense, useEffect, useState } from 'react';
import { Box, Container } from '@mui/material';
import { Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { isPublicGuestPath } from '../guest/guestDocumentPaths';
import { CrossAppRedirect } from '../guest/CrossAppRedirect';
import { AppSidebar } from '../components/layout/sidebar/AppSidebar';
import { AppTopbar } from '../components/layout/AppTopbar';
import { MobileNavBar } from '../components/layout/MobileNavBar';
import { MobileQuickActions } from '../components/layout/MobileQuickActions';
import { CommandPaletteProvider } from '../components/layout/CommandPalette';
import { BootSplash, LoadingFallback, MinimalLoadingFallback } from './RouteFallbacks';
import { FirstLoginPasskeyPrompt } from '../navigation/routeRegistry';
import { ErrorBoundary, PageErrorBoundary } from '../components';
import { GuestPortalShell } from '../features/guestPortal/components/GuestPortalShell';
import { useTranslation } from '../i18n';
import { getHotelSettings } from '../utils/hotelSettings';
import { MAIN_CONTAINMENT } from './mainContainment';

const ADMIN_FAVICON = '/favicon.ico';
const GUEST_FAVICON = '/salim-inn/salim-inn-icon.svg';

export const RootLayout: React.FC = () => {
  const { t } = useTranslation('guestPortal');
  const { isAuthenticated, isLoading, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();
  const { t: tErr } = useTranslation('errors');
  const { t: tCommon } = useTranslation('common');
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
    // `app.title` is the last-resort tab title — the settings themselves carry
    // a default, so an empty `hotel_name` reaching here is already abnormal.
    const displayName = hotelName.trim() || tCommon('app.title');
    document.title = displayName;
    // The sign-in/register card's eyebrow is a CSS ::before, so its text has to
    // reach the stylesheet as a quoted custom property (see .auth-card in index.css).
    document.documentElement.style.setProperty(
      '--auth-brand-eyebrow',
      JSON.stringify(displayName)
    );

    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
    if (favicon) favicon.href = isGuestExperience ? GUEST_FAVICON : ADMIN_FAVICON;
  }, [isGuestExperience, hotelName, tCommon]);

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
    if (isLoading && !isPublicBooking) return <BootSplash />;

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
        <ErrorBoundary title={tErr('boundary.guest')} detailMessage={t('errorBoundary.detail')}>
          <Suspense fallback={<LoadingFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </GuestPortalShell>
    );
  }

  if (isAdminPortal) {
    if (isLoading) return <BootSplash />;
    // Typed-route shim contract — see router/compat.tsx.
    if (!isAuthenticated) return <CrossAppRedirect to="/login" />;
    if (user?.user_type === 'guest') return <CrossAppRedirect to="/guest-portal" />;
  }

  // Public consumer pages and the signed-in guest's model home remain outside
  // the operational staff shell.
  if (publicGuestPath) {
    return (
      <ErrorBoundary title={tErr('boundary.guest')} detailMessage={t('errorBoundary.detail')}>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (isOffersPage || isGuestModelHome) {
    return (
      <ErrorBoundary title={tErr('boundary.guest')} detailMessage={t('errorBoundary.detail')}>
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (isLoading) return <BootSplash />;

  if (!isAuthenticated) {
    return (
      <ErrorBoundary title={tErr('boundary.auth')}>
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <Box
      sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}
    >
      <CommandPaletteProvider>
        <AppSidebar />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <AppTopbar />
          <Container
            component="main"
            maxWidth="xl"
            sx={{
              mt: boardSkinActive ? 3 : 4,
              mb: 4,
              px: { xs: 2, sm: 3 },
              // Keep the page end clear of the fixed bottom nav, which only
              // exists below `sm`; from `sm` up the sidebar rail takes over.
              pb: { xs: 'calc(84px + var(--sab))', sm: 0 },
              flex: 1,
              // Must not trap `position: fixed` descendants — see mainContainment.
              ...MAIN_CONTAINMENT,
            }}
          >
            <PageErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
          </Container>
        </Box>

        <MobileNavBar />
        <MobileQuickActions />

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
