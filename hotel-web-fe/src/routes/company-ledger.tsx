import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/company-ledger')({
  component: () => <RouteById id="company-ledger" />,
});
