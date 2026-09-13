import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { CircularProgress } from '@mui/material';
import { createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router';
import { StatusPage } from '../components';
import { UnauthOnlyRoute } from '../router/RouteGuards';
import { GuestRootLayout } from './GuestRootLayout';

const rootRoute = createRootRoute({
  component: GuestRootLayout,
});

function lazyDefault(
  loader: () => Promise<{ default: ComponentType<any> }>,
) {
  return lazy(loader);
}

function page(
  path: string,
  loader: () => Promise<{ default: ComponentType<any> }>,
  unauth = false,
) {
  const Page = lazyDefault(loader);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: function GuestPage() {
      const inner = (
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      );
      return unauth ? <UnauthOnlyRoute>{inner}</UnauthOnlyRoute> : inner;
    },
  });
}

const UnsubscribePage = lazy(
  () => import('../features/communications/pages/UnsubscribePage'),
);

const unsubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'unsubscribe/$token',
  component: function UnsubscribeRoute() {
    const { token } = unsubscribeRoute.useParams();
    return (
      <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
        <UnsubscribePage token={token} />
      </Suspense>
    );
  },
});

const PortalDashboardPage = lazy(
  () => import('../features/guestPortal/components/PortalDashboardPage'),
);
const PortalBookingPage = lazy(
  () => import('../features/guestPortal/booking/PortalBookingPage'),
);

const guestPortalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'guest-portal',
  component: function GuestPortalRoute() {
    const view = new URLSearchParams(window.location.search).get('view');
    const Page = view === 'booking' ? PortalBookingPage : PortalDashboardPage;
    return (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    );
  },
});

const routeTree = rootRoute.addChildren([
  page('login', () => import('../features/auth/components/LoginPage'), true),
  page('register', () => import('../features/auth/components/RegisterPage'), true),
  page('verify-email', () => import('../features/auth/components/EmailVerificationPage'), true),
  page('complete-profile', () => import('../features/auth/components/CompleteProfilePage')),
  page('guest-checkin', () => import('../features/bookings/components/GuestCheckInLanding'), true),
  page('guest-checkin/verify', () => import('../features/bookings/components/GuestCheckInVerify'), true),
  page('guest-checkin/form', () => import('../features/bookings/components/GuestCheckInForm'), true),
  page('guest-checkin/confirm', () => import('../features/bookings/components/GuestCheckInConfirmation'), true),
  guestPortalRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: 'portal/',
    component: function RedirectPortal() {
      const navigate = useNavigate();
      useEffect(() => {
        void navigate({ to: '/guest-portal', replace: true });
      }, [navigate]);
      return null;
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: 'portal/book',
    component: function RedirectBook() {
      const navigate = useNavigate();
      useEffect(() => {
        void navigate({ to: '/guest-portal', search: { view: 'booking' } as never, replace: true });
      }, [navigate]);
      return null;
    },
  }),
  page('offers', () => import('../features/promotions/pages/OffersPage')),
  page('legal/terms', () => import('../features/legal/pages/TermsPage')),
  page('legal/privacy', () => import('../features/legal/pages/PrivacyPage')),
  page('legal/payment-terms', () => import('../features/legal/pages/PaymentTermsPage')),
  page('legal/identity-verification', () => import('../features/legal/pages/IdentityVerificationPage')),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '403',
    component: () => <StatusPage statusCode={403} />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '423',
    component: () => <StatusPage statusCode={423} />,
  }),
  unsubscribeRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <StatusPage statusCode={404} />,
  }),
]);

export const guestRouter = createRouter({
  routeTree,
  defaultPreload: 'intent',
});
