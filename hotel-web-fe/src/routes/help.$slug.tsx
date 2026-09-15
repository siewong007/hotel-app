import { Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary, LogoLoader } from '../components';
import { lazyRoute } from '../navigation/lazyRoute';

// Article detail lives under the existing 'help' route id — no new
// route_access_policies rows or registry entry needed. Same precedent as
// unsubscribe.$token.tsx: a parameterised file route rendered directly.
const HelpArticlePage = lazyRoute(
  () => import('../features/help/pages/HelpArticlePage')
);

function HelpArticleRoute() {
  const { slug } = Route.useParams();
  return (
    <ProtectedRoute routeId="help">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<LogoLoader variant="page" />}>
            <HelpArticlePage slug={slug} />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/help/$slug')({
  component: HelpArticleRoute,
});
