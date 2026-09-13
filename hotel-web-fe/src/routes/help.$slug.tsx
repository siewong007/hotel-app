import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary } from '../components';

// Article detail lives under the existing 'help' route id — no new
// route_access_policies rows or registry entry needed. Same precedent as
// unsubscribe.$token.tsx: a parameterised file route rendered directly.
const HelpArticlePage = lazy(
  () => import('../features/help/pages/HelpArticlePage')
);

function HelpArticleRoute() {
  const { slug } = Route.useParams();
  return (
    <ProtectedRoute routeId="help">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
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
