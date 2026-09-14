import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { RouteById } from '../router/renderRouteFromRegistry';

// /help/$slug nests under this route (flat-file convention). The registry
// list page renders only when /help itself is the leaf match; a matched
// child takes over the surface through the Outlet.
function HelpRouteComponent() {
  const hasChild = useChildMatches().length > 0;
  return hasChild ? <Outlet /> : <RouteById id="help" />;
}

export const Route = createFileRoute('/help')({
  component: HelpRouteComponent,
});
