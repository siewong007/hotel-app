import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../../router/renderRouteFromRegistry';

export const Route = createFileRoute('/guest-relations/guests/')({
  component: () => <RouteById id="guest-relations" />,
});
