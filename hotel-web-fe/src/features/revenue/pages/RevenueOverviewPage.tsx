import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Skeleton, Typography } from '@mui/material';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import ChannelMixTable from '../components/ChannelMixTable';
import RevenueFilters from '../components/RevenueFilters';
import RevenueKpiGrid from '../components/RevenueKpiGrid';
import RevenueTrendChart from '../components/RevenueTrendChart';
import { useRevenueOverview } from '../hooks/useRevenueOverview';
import type { RevenueOverviewParams } from '../types';

const defaultRange = () => ({
  from: formatLocalDate(addLocalDays(new Date(), -29)),
  to: formatLocalDate(new Date()),
});

const RevenueOverviewPage: React.FC = () => {
  const [filters, setFilters] = useState<RevenueOverviewParams>(defaultRange);
  const overview = useRevenueOverview(filters);
  const data = overview.data;
  const isEmpty = useMemo(
    () => data !== undefined && data.daily.length === 0 && data.channels.length === 0,
    [data],
  );

  return (
    <Box>
      <PageHeader
        title="Revenue Overview"
        subtitle={
          data
            ? `Stay dates ${data.range.from} – ${data.range.to} · compared with ${data.previous_period.from} – ${data.previous_period.to}`
            : 'Stay-date performance with previous-period comparison'
        }
      />
      <RevenueFilters value={filters} onChange={setFilters} />

      {overview.isLoading && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={300} />
        </Box>
      )}

      {overview.isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => overview.refetch()}>
              Retry
            </Button>
          }
        >
          Revenue metrics could not be loaded. Check your connection and try again.
        </Alert>
      )}

      {data && isEmpty && (
        <EmptyState
          title="No stays in this range"
          description="No bookings occupy these stay dates. Widen the range or clear the filters."
        />
      )}

      {data && !isEmpty && (
        <>
          <RevenueKpiGrid
            kpis={data.kpis}
            deltas={data.deltas_pct}
            currency={data.currency}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' },
              gap: 2,
            }}
          >
            <RevenueTrendChart daily={data.daily} />
            <ChannelMixTable channels={data.channels} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            KPIs count stay dates; channel contribution counts booking creation dates. Voided and
            no-show stays are excluded from sold metrics.
          </Typography>
        </>
      )}
    </Box>
  );
};

export default RevenueOverviewPage;
