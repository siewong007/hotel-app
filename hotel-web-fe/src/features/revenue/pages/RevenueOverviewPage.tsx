import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Skeleton, Typography } from '@mui/material';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { useTranslation } from '../../../i18n';
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
  const { t } = useTranslation('revenue');
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
        title={t('overview.pageTitle')}
        subtitle={
          data
            ? t('overview.subtitle', {
                from: data.range.from,
                to: data.range.to,
                prevFrom: data.previous_period.from,
                prevTo: data.previous_period.to,
              })
            : t('overview.subtitleFallback')
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
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('overview.loadError')}
        </Alert>
      )}

      {data && isEmpty && (
        <EmptyState
          title={t('overview.emptyTitle')}
          description={t('overview.emptyDescription')}
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
            {t('overview.footnote')}
          </Typography>
        </>
      )}
    </Box>
  );
};

export default RevenueOverviewPage;
