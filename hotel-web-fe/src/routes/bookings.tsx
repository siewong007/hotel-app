import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

// /bookings/$bookingId nests under this route (flat-file convention). The
// registry list page renders only when /bookings itself is the leaf match;
// a matched child takes over the surface through the Outlet.
function BookingsRouteComponent() {
  const hasChild = useChildMatches().length > 0;
  return hasChild ? <Outlet /> : <RouteById id="bookings" />;
}

export const Route = createFileRoute('/bookings')({
  component: BookingsRouteComponent,
});
