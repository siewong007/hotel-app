import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/portal/')({
  component: () => <RouteById id="portal-dashboard" />,
});
