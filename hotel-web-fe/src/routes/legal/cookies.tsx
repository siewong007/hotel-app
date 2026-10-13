import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/legal/cookies')({
  component: () => <RouteById id="legal-cookies" />,
});
