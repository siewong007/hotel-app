import { Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../../../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary, LogoLoader } from '../../../components';
import { lazyRoute } from '../../../navigation/lazyRoute';

// Guest 360 is a parameterised file route rendered directly — same precedent
// as help.$slug.tsx — but bound to its own seeded `guest-relations-detail`
// route-access policy rather than the list's `guest-relations` id.
const GuestProfilePage = lazyRoute(
  () => import('../../../features/guestRelations/pages/GuestProfilePage')
);

function GuestProfileRoute() {
  const { guestId } = Route.useParams();
  return (
    <ProtectedRoute routeId="guest-relations-detail">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<LogoLoader variant="page" />}>
            <GuestProfilePage guestId={guestId} />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/guest-relations/guests/$guestId')({
  component: GuestProfileRoute,
});
