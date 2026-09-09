import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';

// Public, capability-authenticated page reached from a payment-rejected email.
// Rendered directly rather than through the lazy registry: the registry drives
// the authenticated sidebar, and this page must never imply a session.
const PaymentRecoveryPage = lazy(
  () => import('../features/paymentRecovery/PaymentRecoveryPage')
);

function PaymentRecoveryRoute() {
  const { token } = Route.useParams();
  return (
    <Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
      <PaymentRecoveryPage token={token} />
    </Suspense>
  );
}

export const Route = createFileRoute('/booking/recover-payment/$token')({
  component: PaymentRecoveryRoute,
});
