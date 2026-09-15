import { Suspense } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { lazyRoute } from '../navigation/lazyRoute';

// Public, token-authenticated page; rendered directly (not via the registry)
// because it is the only parameterised public route.
const UnsubscribePage = lazyRoute(
  () => import('../features/communications/pages/UnsubscribePage')
);

function UnsubscribeRoute() {
  const { token } = Route.useParams();
  return (
    <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
      <UnsubscribePage token={token} />
    </Suspense>
  );
}

export const Route = createFileRoute('/unsubscribe/$token')({
  component: UnsubscribeRoute,
});
