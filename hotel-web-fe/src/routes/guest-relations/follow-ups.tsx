import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary } from '../../components';

// The follow-up queue is a non-nav file route rendered directly — same
// precedent as guests/$guestId.tsx — bound to its own seeded
// `guest-relations-follow-ups` route-access policy rather than the landing
// page's `guest-relations` id. Like the detail route it omits
// `requiresPolicy`: the policy row only exists on databases that ran patch
// 0003, and the page's own `guests:read` guard covers access when the row is
// absent.
const GuestRelationsFollowUpsPage = lazy(
  () => import('../../features/guestRelations/pages/GuestRelationsFollowUpsPage')
);

function FollowUpsRoute() {
  return (
    <ProtectedRoute routeId="guest-relations-follow-ups">
      <AnimatedRoute animationType="slide">
        <ComponentErrorBoundary>
          <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
            <GuestRelationsFollowUpsPage />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/guest-relations/follow-ups')({
  component: FollowUpsRoute,
});
