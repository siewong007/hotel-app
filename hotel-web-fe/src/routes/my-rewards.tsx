import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/my-rewards')({
  component: () => <RouteById id="my-rewards" />,
});
