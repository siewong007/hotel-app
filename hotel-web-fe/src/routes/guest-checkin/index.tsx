import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/guest-checkin/')({
  component: () => <RouteById id="guest-checkin" />,
});
