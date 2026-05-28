import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { authRouteDefinitions, unauthRouteDefinitions } from '../navigation/routeRegistry';
import { renderRouteContent } from '../router/renderRouteFromRegistry';

const indexAuth = authRouteDefinitions.find((r) => r.path === '/');
const indexUnauth = unauthRouteDefinitions.find((r) => r.path === '/');

function IndexComponent() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated && indexAuth) return renderRouteContent(indexAuth);
  if (!isAuthenticated && indexUnauth) return renderRouteContent(indexUnauth);
  return null;
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});
