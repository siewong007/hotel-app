import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/my-bookings')({
  component: () => <RouteById id="my-bookings" />,
});
