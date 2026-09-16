import { Suspense } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { LogoLoader } from '../components';
import { lazyRoute } from '../navigation/lazyRoute';

// Public, capability-authenticated page reached from a payment-rejected email.
// Rendered directly rather than through the lazy registry: the registry drives
// the authenticated sidebar, and this page must never imply a session.
const PaymentRecoveryPage = lazyRoute(
  () => import('../features/paymentRecovery/PaymentRecoveryPage')
);

function PaymentRecoveryRoute() {
  const { token } = Route.useParams();
  return (
    <Suspense fallback={<LogoLoader variant="page" />}>
      <PaymentRecoveryPage token={token} />
    </Suspense>
  );
}

export const Route = createFileRoute('/booking/recover-payment/$token')({
  component: PaymentRecoveryRoute,
});
