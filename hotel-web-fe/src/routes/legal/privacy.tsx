import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/legal/privacy')({
  component: () => <RouteById id="legal-privacy" />,
});
