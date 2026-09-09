import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/legal/identity-verification')({
  component: () => <RouteById id="legal-identity-verification" />,
});
