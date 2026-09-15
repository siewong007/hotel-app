import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';

import { StatCard } from '../../../components/common/StatCard';
import { formatCurrency } from '../../../utils/currency';
import { formatNumber } from '../../../i18n';
import { useTranslation } from '../../../i18n';
import type { RevenueDeltas, RevenueKpis } from '../types';

interface RevenueKpiGridProps {
  kpis: RevenueKpis;
  deltas: RevenueDeltas;
  currency: string;
}

const toNumber = (value: string): number => Number.parseFloat(value) || 0;

/** Trend descriptor for one KPI; `null` delta renders a muted "no prior" tag. */
function trendFor(delta: number | null, vsPrior: string) {
  if (delta === null) {
    return undefined;
  }
  return { value: delta, label: vsPrior };
}

/**
 * Headline revenue metrics. `void_rate`/`no_show_rate` trend deltas invert the
 * "up is good" convention — a rising void rate is worse — so those cards flag
 * the direction explicitly instead of colouring green.
 */
const RevenueKpiGrid: React.FC<RevenueKpiGridProps> = ({ kpis, deltas, currency }) => {
  const { t } = useTranslation('revenue');
  const cards: Array<{
    key: keyof RevenueKpis;
    title: string;
    value: string;
    subtitle?: string;
  }> = [
    {
      key: 'room_revenue',
      title: t('kpi.roomRevenue'),
      value: formatCurrency(toNumber(kpis.room_revenue), currency),
    },
    {
      key: 'occupancy_rate',
      title: t('kpi.occupancy'),
      value: `${formatNumber(toNumber(kpis.occupancy_rate), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`,
      subtitle: t('kpi.roomNightsSold', { count: kpis.room_nights_sold }),
    },
    {
      key: 'adr',
      title: t('kpi.adr'),
      value: formatCurrency(toNumber(kpis.adr), currency),
      subtitle: t('kpi.adrSubtitle'),
    },
    {
      key: 'revpar',
      title: t('kpi.revpar'),
      value: formatCurrency(toNumber(kpis.revpar), currency),
      subtitle: t('kpi.revparSubtitle'),
    },
    {
      key: 'alos_nights',
      title: t('kpi.avgStay'),
      value: t('kpi.avgStayValue', { value: formatNumber(toNumber(kpis.alos_nights), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }),
      subtitle: t('kpi.avgStaySubtitle'),
    },
    {
      key: 'bookings_created',
      title: t('kpi.bookingsCreated'),
      value: formatNumber(kpis.bookings_created),
      subtitle: t('kpi.bookingsSubtitle', {
        voided: formatNumber(toNumber(kpis.void_rate), { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
        noShow: formatNumber(toNumber(kpis.no_show_rate), { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
      }),
    },
    {
      key: 'direct_share',
      title: t('kpi.directShare'),
      value: `${formatNumber(toNumber(kpis.direct_share), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`,
      subtitle: t('kpi.directShareSubtitle'),
    },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 2,
        mb: 3,
      }}
    >
      {cards.map((card) => {
        const delta = deltas[card.key];
        return (
          <StatCard
            key={card.key}
            title={card.title}
            value={card.value}
            subtitle={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {card.subtitle}
                {delta === null && (
                  <Tooltip title={t('kpi.noBaseline')}>
                    <Typography variant="caption" color="text.disabled" component="span">
                      {t('kpi.noPrior')}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            }
            trend={trendFor(delta, t('kpi.vsPrior'))}
            showPositiveTrendSign
          />
        );
      })}
    </Box>
  );
};

export default RevenueKpiGrid;
