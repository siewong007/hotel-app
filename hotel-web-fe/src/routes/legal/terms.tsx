import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/legal/terms')({
  component: () => <RouteById id="legal-terms" />,
});
