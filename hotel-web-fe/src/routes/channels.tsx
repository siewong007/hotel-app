import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

// /channels/$channelId nests under this route (flat-file convention), like
// /bookings/$bookingId. The registry list page renders only when /channels
// itself is the leaf match; a matched child takes over through the Outlet —
// without it, "Open channel" changed the URL but kept showing the list.
export function ChannelsRouteComponent() {
  const hasChild = useChildMatches().length > 0;
  return hasChild ? <Outlet /> : <RouteById id="channels" />;
}

export const Route = createFileRoute('/channels')({
  component: ChannelsRouteComponent,
});
