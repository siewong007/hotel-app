import { createFileRoute } from '@tanstack/react-router';
import { Navigate } from '../../router';

export const Route = createFileRoute('/portal/')({
  component: () => <Navigate to="/guest-portal" replace />,
});
