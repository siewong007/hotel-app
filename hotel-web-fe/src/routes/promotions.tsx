import { createFileRoute, redirect } from '@tanstack/react-router';

// The promotions workspace moved to /campaigns (revenue group). Keep the old
// path as a permanent redirect so bookmarks and deep links keep working.
export const Route = createFileRoute('/promotions')({
  beforeLoad: () => {
    throw redirect({ to: '/campaigns', replace: true });
  },
});
