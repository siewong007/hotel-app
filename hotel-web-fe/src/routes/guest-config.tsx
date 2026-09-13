import { createFileRoute, redirect } from '@tanstack/react-router';

// Legacy path kept as a redirect. Global-search hits still arrive as
// `/guest-config?search=…&guest_id=…`, and the Guest Relations list honours
// that same query contract, so the parsed search is forwarded verbatim.
export const Route = createFileRoute('/guest-config')({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: '/guest-relations/guests',
      search: location.search,
      replace: true,
    });
  },
});
