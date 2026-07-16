import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/communications')({
  component: () => <RouteById id="communications" />,
});
