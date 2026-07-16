import { createFileRoute } from '@tanstack/react-router';
import { publicRouteDefinitions } from '../navigation/routeRegistry';
import { renderRouteContent } from '../router/renderRouteFromRegistry';

const indexLanding = publicRouteDefinitions.find((r) => r.id === 'landing');

function IndexComponent() {
  if (indexLanding) {
    return renderRouteContent(indexLanding);
  }
  return null;
}

export const Route = createFileRoute('/')({
  component: IndexComponent,
});
