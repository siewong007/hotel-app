import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/enroll-two-factor')({
  component: () => <RouteById id="enroll-two-factor" />,
});
