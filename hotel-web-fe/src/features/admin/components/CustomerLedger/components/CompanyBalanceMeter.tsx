// Billed / Collected / Outstanding / Overdue / Collection meter row shown
// under the company header in the ledger detail pane.

import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import type { CompanyLedgerAggregate } from '../hooks/useCustomerLedgerWorkspace';
import { isPositiveMoney } from '../../../../../utils/money';

interface CompanyBalanceMeterProps {
  agg: CompanyLedgerAggregate;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

interface BalanceCell {
  key: string;
  label: string;
  value: number;
  color?: 'success.main' | 'error.main';
  barWidth: number;
  barColor: string;
  sub?: string;
}

const CompanyBalanceMeter: React.FC<CompanyBalanceMeterProps> = ({
  agg,
  currencySymbol,
  formatCurrency,
}) => {
  const pct = isPositiveMoney(agg.total) ? (agg.paid / agg.total) * 100 : 0;
  const allCells: BalanceCell[] = [
    {
      key: 'billed',
      label: 'Total Billed',
      value: agg.total,
      barWidth: 100,
      barColor: 'success.main',
    },
    {
      key: 'collected',
      label: 'Collected',
      value: agg.paid,
      color: 'success.main',
      barWidth: pct,
      barColor: 'success.main',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: agg.due,
      color: 'error.main',
      barWidth: Math.min(100, isPositiveMoney(agg.total) ? (agg.due / agg.total) * 100 : 0),
      barColor: 'error.main',
      sub: `${agg.pending} open item${agg.pending === 1 ? '' : 's'}`,
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: agg.overdue,
      color: isPositiveMoney(agg.overdue) ? 'error.main' : 'success.main',
      barWidth: Math.min(100, isPositiveMoney(agg.total) ? (agg.overdue / agg.total) * 100 : 0),
      barColor: 'error.main',
      sub: isPositiveMoney(agg.overdue) ? 'needs follow-up' : 'none overdue',
    },
    {
      key: 'collection',
      label: 'Collection',
      value: pct,
      color: 'success.main',
      barWidth: pct,
      barColor: 'success.main',
      sub: `${Math.round(pct)}% collected`,
    },
  ];
  const cells = allCells.filter((cell) => cell.key !== 'overdue' || isPositiveMoney(agg.overdue));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          lg: `repeat(${cells.length}, minmax(0, 1fr))`,
        },
        bgcolor: 'action.hover',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {cells.map((c, idx) => (
        <Box
          key={c.key}
          sx={{
            px: 2.5,
            py: 1.5,
            borderRight: {
              xs: 'none',
              lg: idx < cells.length - 1 ? '1px solid' : 'none',
            },
            borderBottom: {
              xs: idx < cells.length - 1 ? '1px solid' : 'none',
              sm: idx < cells.length - 2 ? '1px solid' : 'none',
              lg: 'none',
            },
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: 'text.secondary',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              display: 'block',
            }}
          >
            {c.label}
          </Typography>
          <Typography
            sx={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.3px',
              mt: 0.5,
              color: c.color || 'text.primary',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {c.key === 'collection' ? (
              `${Math.round(c.value)}%`
            ) : (
              <>
                <Box
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'text.secondary',
                    mr: 0.5,
                    letterSpacing: 0.4,
                  }}
                >
                  {currencySymbol}
                </Box>
                {formatCurrency(c.value).replace(currencySymbol, '').trim()}
              </>
            )}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, c.barWidth))}
            sx={{
              height: 5,
              borderRadius: 999,
              bgcolor: 'action.selected',
              mt: 1,
              '& .MuiLinearProgress-bar': { bgcolor: c.barColor },
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
            {c.sub}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

export default CompanyBalanceMeter;
