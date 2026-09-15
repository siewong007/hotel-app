import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from '@tanstack/react-router';
import { ErrorBoundary } from '../components';
import { useAuth } from '../auth/AuthContext';
import { getHotelSettings } from '../utils/hotelSettings';
import { BootSplash, LoadingFallback } from '../router/RouteFallbacks';
import { isPublicGuestPath } from './guestDocumentPaths';
import { GuestOneTap } from '../features/auth/google/GuestOneTap';
import { GuestPortalThemeProvider } from '../features/guestPortal/theme/GuestPortalThemeProvider';
import { CrossAppRedirect } from './CrossAppRedirect';
import { lazyRoute } from '../navigation/lazyRoute';
import { useTranslation } from '../i18n';

const GuestPortalShell = lazyRoute(
  () => import('../features/guestPortal/components/GuestPortalShell').then(module => ({
    default: module.GuestPortalShell,
  })),
);

const FALLBACK_APP_TITLE = 'Hotel ERP System';
const GUEST_FAVICON = '/salim-inn/salim-inn-icon.svg';

export function GuestRootLayout() {
  const { t } = useTranslation('guestPortal');
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.searchStr ? `?${location.searchStr.replace(/^\?+/, '')}` : '';
  const publicPath = isPublicGuestPath(pathname, search);
  const isPortal = pathname === '/guest-portal' || pathname === '/portal';
  // Legal documents and the public offers catalog are part of the guest
  // experience — they should carry the same shell and theme as the booking
  // funnel that links to them, not fall back to the bare document chrome.
  const isLegal = pathname.startsWith('/legal/');
  const isOffers = pathname === '/offers';

  const [hotelName, setHotelName] = useState(() => getHotelSettings().hotel_name);

  useEffect(() => {
    const syncHotelName = () => setHotelName(getHotelSettings().hotel_name);
    window.addEventListener('hotelSettingsChange', syncHotelName);
    return () => window.removeEventListener('hotelSettingsChange', syncHotelName);
  }, []);

  useEffect(() => {
    const displayName = hotelName.trim() || FALLBACK_APP_TITLE;
    document.title = displayName;
    document.documentElement.style.setProperty(
      '--auth-brand-eyebrow',
      JSON.stringify(displayName),
    );
    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon');
    if (favicon) favicon.href = GUEST_FAVICON;
  }, [hotelName]);

  const page = (
    <ErrorBoundary
      title={t('errorBoundary.title')}
      detailMessage={t('errorBoundary.detail')}
    >
      <Suspense fallback={publicPath ? null : <LoadingFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );

  // Rendered above every branch below, and rendering nothing itself: One Tap
  // decides for itself which guest pages it may appear on, and mounting it once
  // here keeps an open prompt alive across in-app navigation.
  const oneTap = <GuestOneTap pathname={pathname} search={search} />;

  if (isPortal && !publicPath) {
    if (isLoading) return <BootSplash />;
    if (!isAuthenticated) return <CrossAppRedirect to="/login" />;
    if (user?.user_type !== 'guest') return <CrossAppRedirect to="/" />;
    return (
      <>
        {oneTap}
        <Suspense fallback={<LoadingFallback />}>
          <GuestPortalShell showAccountNav>{page}</GuestPortalShell>
        </Suspense>
      </>
    );
  }

  if (isPortal || isLegal || isOffers) {
    return (
      <>
        {oneTap}
        <Suspense fallback={null}>
          <GuestPortalShell showAccountNav={Boolean(isAuthenticated && user?.user_type === 'guest')}>
            {page}
          </GuestPortalShell>
        </Suspense>
      </>
    );
  }

  // Every remaining guest page — auth, check-in wizard, unsubscribe — renders
  // bare (no chrome) but still inside the guest theme so the palette is the
  // same product the portal shows.
  return (
    <>
      {oneTap}
      <GuestPortalThemeProvider>{page}</GuestPortalThemeProvider>
    </>
  );
}
