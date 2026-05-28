import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/guest-config')({
  component: () => <RouteById id="guest-config" />,
});
