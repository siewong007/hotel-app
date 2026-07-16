import { createFileRoute } from '@tanstack/react-router';

import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/online-inventory')({
  component: () => <RouteById id="online-inventory" />,
});
