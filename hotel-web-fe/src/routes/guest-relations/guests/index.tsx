import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../../../router/renderRouteFromRegistry';

// The guest list is the registry's `guest-directory` nav entry. Page access is
// gated by the shared `guest-relations` route-access policy via the entry's
// `policyId` — the same policy this route used when it mounted directly.
export const Route = createFileRoute('/guest-relations/guests/')({
  component: () => <RouteById id="guest-directory" />,
});
