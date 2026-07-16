import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/admin-portal')({
  component: () => <RouteById id="dashboard" />,
});
