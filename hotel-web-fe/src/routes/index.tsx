import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { authRouteDefinitions, publicRouteDefinitions } from '../navigation/routeRegistry';
import { resolveIndexExperience } from '../router/indexExperience';
import { renderRouteContent } from '../router/renderRouteFromRegistry';

const indexAuth = authRouteDefinitions.find((r) => r.path === '/');
const indexLanding = publicRouteDefinitions.find((r) => r.id === 'landing');

function IndexComponent() {
  const { isAuthenticated, user } = useAuth();
  const experience = resolveIndexExperience(isAuthenticated, user?.user_type);

  if (experience === 'staff-dashboard' && indexAuth) {
    return renderRouteContent(indexAuth);
  }
  if (indexLanding) {
    return renderRouteContent(indexLanding);
  }
  return null;
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});
