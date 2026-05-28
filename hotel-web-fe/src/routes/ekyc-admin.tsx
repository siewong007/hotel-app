import { createFileRoute } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

export const Route = createFileRoute('/ekyc-admin')({
  component: () => <RouteById id="ekyc-admin" />,
});
