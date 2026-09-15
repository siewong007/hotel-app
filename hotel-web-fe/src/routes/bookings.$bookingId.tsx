import { Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary, LogoLoader } from '../components';
import { lazyRoute } from '../navigation/lazyRoute';

// Booking detail lives under the existing 'bookings' route id — no new
// route_access_policies rows or registry entry needed. Same precedent as
// guest-relations/guests/$guestId.tsx: a parameterised file route rendered
// directly. The parent /bookings route component yields to this child via a
// conditional Outlet (see bookings.tsx).
const BookingDetailPage = lazyRoute(
  () => import('../features/bookings/pages/BookingDetailPage')
);

function BookingDetailRoute() {
  const { bookingId } = Route.useParams();
  return (
    <ProtectedRoute routeId="bookings">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<LogoLoader variant="page" />}>
            <BookingDetailPage bookingId={bookingId} />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/bookings/$bookingId')({
  component: BookingDetailRoute,
});
