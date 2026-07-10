import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/housekeeping')({
  component: () => <RouteById id="housekeeping" />,
});
