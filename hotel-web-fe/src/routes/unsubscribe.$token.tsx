import { Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { LogoLoader } from '../components';
import { lazyRoute } from '../navigation/lazyRoute';

// Public, token-authenticated page; rendered directly (not via the registry)
// because it is the only parameterised public route.
const UnsubscribePage = lazyRoute(
  () => import('../features/communications/pages/UnsubscribePage')
);

function UnsubscribeRoute() {
  const { token } = Route.useParams();
  return (
    <Suspense fallback={<LogoLoader variant="page" />}>
      <UnsubscribePage token={token} />
    </Suspense>
  );
}

export const Route = createFileRoute('/unsubscribe/$token')({
  component: UnsubscribeRoute,
});
