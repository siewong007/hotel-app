import { createFileRoute } from '@tanstack/react-router';
import { publicRouteDefinitions } from '../navigation/routeRegistry';
import { RouteById, renderRouteContent } from '../router/renderRouteFromRegistry';
import { MinimalLoadingFallback } from '../router/RouteFallbacks';
import { useAuth } from '../auth/AuthContext';

const indexLanding = publicRouteDefinitions.find((r) => r.id === 'landing');

function IndexComponent() {
  const { isAuthenticated, isLoading } = useAuth();

  // Signed-in staff belong on their role dashboard, not the marketing page —
  // this is also what makes StatusPage's "Go home" land inside the app.
  if (isLoading) return <MinimalLoadingFallback />;
  if (isAuthenticated) return <RouteById id="dashboard" />;
  if (indexLanding) return renderRouteContent(indexLanding);
  return null;
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});
