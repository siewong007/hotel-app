import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/jobs')({
  component: () => <RouteById id="jobs" />,
});
