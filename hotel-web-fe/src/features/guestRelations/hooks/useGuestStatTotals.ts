import React from 'react';
import { useGuestsPage } from '../../guests/hooks/useGuestQueries';
import { toPaginationSearchParams } from '../../../utils/pagination';
import type { GuestRelationsSegmentCounts } from '../segments';
import { getGuestRelationsSegmentCounts } from '../segments';

const totalOnly = toPaginationSearchParams({ page: 1, pageSize: 1 });

/**
 * Stat-tile + chip counts. The API applies each segment filter to the
 * paginated list, so a `page_size=1` query per segment returns the exact
 * totals without pulling rows — the same trick GuestConfigurationPage used.
 */
export function useGuestStatTotals(enabled = true) {
  const totalQuery = useGuestsPage(totalOnly, enabled);
  const membersQuery = useGuestsPage({ ...totalOnly, guest_type: 'member' }, enabled);
  const missingInfoQuery = useGuestsPage({ ...totalOnly, missing_info: true }, enabled);
  const missingTourismQuery = useGuestsPage({ ...totalOnly, missing_tourism: true }, enabled);
  const touristsQuery = useGuestsPage({ ...totalOnly, tourism_type: 'foreign' }, enabled);
  const vipQuery = useGuestsPage({ ...totalOnly, vip: true }, enabled);
  const blacklistedQuery = useGuestsPage({ ...totalOnly, blacklisted: true }, enabled);
  const openRequestsQuery = useGuestsPage({ ...totalOnly, has_open_support: true }, enabled);

  const queries = React.useMemo(
    () => [
      totalQuery,
      membersQuery,
      missingInfoQuery,
      missingTourismQuery,
      touristsQuery,
      vipQuery,
      blacklistedQuery,
      openRequestsQuery,
    ],
    [
      totalQuery,
      membersQuery,
      missingInfoQuery,
      missingTourismQuery,
      touristsQuery,
      vipQuery,
      blacklistedQuery,
      openRequestsQuery,
    ],
  );

  const counts: GuestRelationsSegmentCounts = getGuestRelationsSegmentCounts({
    total: totalQuery.data?.total ?? 0,
    members: membersQuery.data?.total ?? 0,
    missingInfo: missingInfoQuery.data?.total ?? 0,
    missingTourism: missingTourismQuery.data?.total ?? 0,
    tourists: touristsQuery.data?.total ?? 0,
    vip: vipQuery.data?.total ?? 0,
    blacklisted: blacklistedQuery.data?.total ?? 0,
    openRequests: openRequestsQuery.data?.total ?? 0,
  });

  const error = queries.find((q) => q.error)?.error ?? null;
  const isPending = queries.some((q) => q.isPending);
  const refetchAll = React.useCallback(
    () => Promise.all(queries.map((q) => q.refetch())),
    [queries],
  );

  return { counts, error, isPending, refetchAll };
}
