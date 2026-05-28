import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/verify-email')({
  component: () => <RouteById id="verify-email" />,
});
