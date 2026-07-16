import { createFileRoute } from '@tanstack/react-router';
import { useLocation } from '../router';
import { RouteById } from '../router/renderRouteFromRegistry';

function GuestPortalRoute() {
  const { search } = useLocation();
  const isBooking = new URLSearchParams(search).get('view') === 'booking';

  return <RouteById id={isBooking ? 'portal-book' : 'portal-dashboard'} />;
}

export const Route = createFileRoute('/guest-portal')({
  component: GuestPortalRoute,
});
