import { Suspense, lazy, useEffect, useState } from 'react';
import { Outlet, useLocation } from '@tanstack/react-router';
import { ErrorBoundary } from '../components';
import { useAuth } from '../auth/AuthContext';
import { getHotelSettings } from '../utils/hotelSettings';
import { LoadingFallback } from '../router/RouteFallbacks';
import { isPublicGuestPath } from './guestDocumentPaths';
import { CrossAppRedirect } from './CrossAppRedirect';

const GuestPortalShell = lazy(
  () => import('../features/guestPortal/components/GuestPortalShell').then(module => ({
    default: module.GuestPortalShell,
  })),
);

const FALLBACK_APP_TITLE = 'Hotel ERP System';
const GUEST_FAVICON = '/salim-inn/salim-inn-icon.svg';

export function GuestRootLayout() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.searchStr ? `?${location.searchStr.replace(/^\?+/, '')}` : '';
  const publicPath = isPublicGuestPath(pathname, search);
  const isPortal = pathname === '/guest-portal' || pathname === '/portal';

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
    <ErrorBoundary title="Guest Experience Error">
      <Suspense fallback={publicPath ? null : <LoadingFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );

  if (isPortal && !publicPath) {
    if (isLoading) return <LoadingFallback />;
    if (!isAuthenticated) return <CrossAppRedirect to="/login" />;
    if (user?.user_type !== 'guest') return <CrossAppRedirect to="/" />;
    return (
      <Suspense fallback={<LoadingFallback />}>
        <GuestPortalShell showAccountNav>{page}</GuestPortalShell>
      </Suspense>
    );
  }

  if (isPortal) {
    return (
      <Suspense fallback={null}>
        <GuestPortalShell showAccountNav={Boolean(isAuthenticated && user?.user_type === 'guest')}>
          {page}
        </GuestPortalShell>
      </Suspense>
    );
  }

  return page;
}
