import { createFileRoute } from '@tanstack/react-router';
import { Navigate } from '../../router';

export const Route = createFileRoute('/portal/book')({
  component: () => <Navigate to="/guest-portal?view=booking" replace />,
});
