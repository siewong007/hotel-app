import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary } from '../components';

// Booking detail lives under the existing 'bookings' route id — no new
// route_access_policies rows or registry entry needed. Same precedent as
// guest-relations/guests/$guestId.tsx: a parameterised file route rendered
// directly. The parent /bookings route component yields to this child via a
// conditional Outlet (see bookings.tsx).
const BookingDetailPage = lazy(
  () => import('../features/bookings/pages/BookingDetailPage')
);

function BookingDetailRoute() {
  const { bookingId } = Route.useParams();
  return (
    <ProtectedRoute routeId="bookings">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
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
