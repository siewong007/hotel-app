import React from 'react';
import { Box } from '@mui/material';
import type { BoxProps, SxProps, Theme } from '@mui/material';
import StatCard from './StatCard';
import type { StatCardTrend } from './StatCard';

export interface StatStripItem {
  key?: string;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
  trend?: StatCardTrend;
  onClick?: () => void;
  active?: boolean;
}

export interface StatStripProps extends BoxProps {
  items: StatStripItem[];
  itemSx?: SxProps<Theme>;
}

/**
 * A row of stat cards that becomes a horizontally scrollable strip on phones
 * instead of stacking six full-width cards ahead of the actionable content.
 */
const StatStrip: React.FC<StatStripProps> = ({ items, itemSx, sx, ...boxProps }) => (
  <Box
    sx={[
      {
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: {
          xs: `repeat(${items.length}, minmax(150px, 1fr))`,
          sm: 'repeat(auto-fit, minmax(170px, 1fr))',
        },
        overflowX: { xs: 'auto', sm: 'visible' },
        pb: { xs: 1, sm: 0 },
        scrollSnapType: { xs: 'x proximity', sm: 'none' },
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
    {...boxProps}
  >
    {items.map((item, index) => (
      <StatCard
        key={item.key ?? index}
        title={item.label}
        value={item.value}
        subtitle={item.hint}
        icon={item.icon}
        color={item.color}
        trend={item.trend}
        onClick={item.onClick}
        sx={[
          {
            scrollSnapAlign: 'start',
            minWidth: 0,
            ...(item.onClick && { cursor: 'pointer' }),
            ...(item.active && { outline: '2px solid', outlineColor: 'primary.main' }),
          },
          ...(Array.isArray(itemSx) ? itemSx : itemSx ? [itemSx] : []),
        ]}
        titleSx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
        valueSx={{ fontSize: '1.4rem', fontWeight: 900 }}
        subtitleVariant="caption"
      />
    ))}
  </Box>
);

export default StatStrip;
