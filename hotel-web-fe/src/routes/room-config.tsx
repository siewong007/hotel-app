import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/room-config')({
  component: () => <RouteById id="room-config" />,
});
