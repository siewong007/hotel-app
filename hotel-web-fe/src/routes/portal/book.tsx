import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/portal/book')({
  component: () => <RouteById id="portal-book" />,
});
