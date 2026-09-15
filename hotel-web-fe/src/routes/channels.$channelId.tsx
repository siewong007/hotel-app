import { Suspense } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute';
import { AnimatedRoute, ComponentErrorBoundary } from '../components';
import { lazyRoute } from '../navigation/lazyRoute';

// Channel detail lives under the 'channels' route id — same precedent as
// bookings/$bookingId.tsx: a parameterised file route protected by the
// parent policy rather than its own registry entry.
const ChannelDetailPage = lazyRoute(
  () => import('../features/channels/pages/ChannelDetailPage')
);

function ChannelDetailRoute() {
  const { channelId } = Route.useParams();
  return (
    <ProtectedRoute routeId="channels">
      <AnimatedRoute animationType="fade">
        <ComponentErrorBoundary>
          <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
            <ChannelDetailPage channelId={channelId} />
          </Suspense>
        </ComponentErrorBoundary>
      </AnimatedRoute>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute('/channels/$channelId')({
  component: ChannelDetailRoute,
});
