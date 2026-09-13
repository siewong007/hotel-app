import { createFileRoute } from '@tanstack/react-router';
import { Navigate } from '../../router';

// `/guest-relations` on its own has no page — the workspace lives one level
// down at /guest-relations/guests (same redirect shape as routes/portal/).
export const Route = createFileRoute('/guest-relations/')({
  component: () => <Navigate to="/guest-relations/guests" replace />,
});
