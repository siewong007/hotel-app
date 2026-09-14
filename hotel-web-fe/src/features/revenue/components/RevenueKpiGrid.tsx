import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';

import { StatCard } from '../../../components/common/StatCard';
import { formatCurrency } from '../../../utils/currency';
import type { RevenueDeltas, RevenueKpis } from '../types';

interface RevenueKpiGridProps {
  kpis: RevenueKpis;
  deltas: RevenueDeltas;
  currency: string;
}

const toNumber = (value: string): number => Number.parseFloat(value) || 0;

/** Trend descriptor for one KPI; `null` delta renders a muted "no prior" tag. */
function trendFor(delta: number | null) {
  if (delta === null) {
    return undefined;
  }
  return { value: delta, label: 'vs prior' };
}

/**
 * Headline revenue metrics. `void_rate`/`no_show_rate` trend deltas invert the
 * "up is good" convention — a rising void rate is worse — so those cards flag
 * the direction explicitly instead of colouring green.
 */
const RevenueKpiGrid: React.FC<RevenueKpiGridProps> = ({ kpis, deltas, currency }) => {
  const cards: Array<{
    key: keyof RevenueKpis;
    title: string;
    value: string;
    subtitle?: string;
  }> = [
    {
      key: 'room_revenue',
      title: 'Room Revenue',
      value: formatCurrency(toNumber(kpis.room_revenue), currency),
    },
    {
      key: 'occupancy_rate',
      title: 'Occupancy',
      value: `${toNumber(kpis.occupancy_rate).toFixed(1)}%`,
      subtitle: `${kpis.room_nights_sold} room nights sold`,
    },
    {
      key: 'adr',
      title: 'ADR',
      value: formatCurrency(toNumber(kpis.adr), currency),
      subtitle: 'per sold room night',
    },
    {
      key: 'revpar',
      title: 'RevPAR',
      value: formatCurrency(toNumber(kpis.revpar), currency),
      subtitle: 'per sellable room',
    },
    {
      key: 'alos_nights',
      title: 'Avg Stay',
      value: `${toNumber(kpis.alos_nights).toFixed(1)} nights`,
      subtitle: 'per booking in range',
    },
    {
      key: 'bookings_created',
      title: 'Bookings Created',
      value: String(kpis.bookings_created),
      subtitle: `voided ${toNumber(kpis.void_rate).toFixed(1)}% · no-show ${toNumber(kpis.no_show_rate).toFixed(1)}%`,
    },
    {
      key: 'direct_share',
      title: 'Direct Share',
      value: `${toNumber(kpis.direct_share).toFixed(1)}%`,
      subtitle: 'of net revenue',
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
                  <Tooltip title="No previous-period baseline">
                    <Typography variant="caption" color="text.disabled" component="span">
                      · no prior
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            }
            trend={trendFor(delta)}
            showPositiveTrendSign
          />
        );
      })}
    </Box>
  );
};

export default RevenueKpiGrid;
