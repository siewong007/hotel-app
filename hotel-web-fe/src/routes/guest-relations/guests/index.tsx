import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../../../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary } from '../../../components';

// The registry's `guest-relations` entry now renders the overview dashboard
// at /guest-relations, so the guest list mounts directly here — under the
// same `guest-relations` route-access policy and slide animation RouteById
// applied before, and the same direct-mount precedent as $guestId.tsx.
const GuestRelationsPage = lazy(
  () => import('../../../features/guestRelations/pages/GuestRelationsPage')
);

function GuestListRoute() {
  return (
    <ProtectedRoute routeId="guest-relations" requiresPolicy>
      <AnimatedRoute animationType="slide">
        <ComponentErrorBoundary>
          <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
            <GuestRelationsPage />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/guest-relations/guests/')({
  component: GuestListRoute,
});
