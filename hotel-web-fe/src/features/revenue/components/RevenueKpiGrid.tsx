import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';

import { StatCard } from '../../../components/common/StatCard';
import { formatCurrency } from '../../../utils/currency';
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
      title: t('kpis.roomRevenue'),
      value: formatCurrency(toNumber(kpis.room_revenue), currency),
    },
    {
      key: 'occupancy_rate',
      title: t('kpis.occupancy'),
      value: `${toNumber(kpis.occupancy_rate).toFixed(1)}%`,
      subtitle: t('kpis.roomNightsSold', { count: kpis.room_nights_sold }),
    },
    {
      key: 'adr',
      title: t('kpis.adr'),
      value: formatCurrency(toNumber(kpis.adr), currency),
      subtitle: t('kpis.perSoldRoomNight'),
    },
    {
      key: 'revpar',
      title: t('kpis.revpar'),
      value: formatCurrency(toNumber(kpis.revpar), currency),
      subtitle: t('kpis.perSellableRoom'),
    },
    {
      key: 'alos_nights',
      title: t('kpis.avgStay'),
      value: t('kpis.nightsValue', { value: toNumber(kpis.alos_nights).toFixed(1) }),
      subtitle: t('kpis.perBooking'),
    },
    {
      key: 'bookings_created',
      title: t('kpis.bookingsCreated'),
      value: String(kpis.bookings_created),
      subtitle: t('kpis.voidNoShow', {
        voidRate: toNumber(kpis.void_rate).toFixed(1),
        noShowRate: toNumber(kpis.no_show_rate).toFixed(1),
      }),
    },
    {
      key: 'direct_share',
      title: t('kpis.directShare'),
      value: `${toNumber(kpis.direct_share).toFixed(1)}%`,
      subtitle: t('kpis.ofNetRevenue'),
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
                  <Tooltip title={t('kpis.noBaseline')}>
                    <Typography variant="caption" color="text.disabled" component="span">
                      {t('kpis.noPrior')}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            }
            trend={trendFor(delta, t('kpis.vsPrior'))}
            showPositiveTrendSign
          />
        );
      })}
    </Box>
  );
};

export default RevenueKpiGrid;
