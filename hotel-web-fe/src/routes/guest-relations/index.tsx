import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../router/renderRouteFromRegistry';

// `/guest-relations` is the workspace landing — the overview dashboard that
// replaced the old redirect to /guest-relations/guests.
export const Route = createFileRoute('/guest-relations/')({
  component: () => <RouteById id="guest-relations" />,
});
