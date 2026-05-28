import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/audit-log')({
  component: () => <RouteById id="audit-log" />,
});
