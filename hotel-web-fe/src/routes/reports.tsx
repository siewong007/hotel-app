import { createFileRoute, redirect } from '@tanstack/react-router';

// Reporting converged on the /insights catalog — the server-side report
// registry covers every report this page rendered. Keep the old path as a
// permanent redirect so bookmarks and deep links keep working.
export const Route = createFileRoute('/reports')({
  beforeLoad: () => {
    throw redirect({ to: '/insights', replace: true });
  },
});
