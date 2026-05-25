// Reusable status pill / badge components for ledger UI

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { ToneName, LedgerUiStatus } from './types';
import { TONE, STATUS_TONE } from './helpers';

export const StatusPill: React.FC<{ tone: ToneName; children: React.ReactNode; sm?: boolean }> = ({ tone, children, sm }) => {
  const t = TONE[tone];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: t.bg,
        color: t.fg,
        px: sm ? '6px' : '8px',
        py: sm ? '1px' : '2px',
        fontSize: sm ? 10 : 10.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: t.dot }} />
      {children}
    </Box>
  );
};

export const LedgerStatusBadge: React.FC<{ status: LedgerUiStatus; sm?: boolean }> = ({ status, sm }) => {
  const meta = STATUS_TONE[status];
  return <StatusPill tone={meta.tone} sm={sm}>{meta.label}</StatusPill>;
};

export const InfoField: React.FC<{ label: string; value: React.ReactNode; span?: 1 | 2 | 3 }> = ({
  label,
  value,
  span,
}) => (
  <Box sx={{ gridColumn: span ? `span ${span}` : 'auto' }}>
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        fontWeight: 600,
        color: 'text.secondary',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </Typography>
    <Typography sx={{ fontSize: 13.5, mt: 0.5, wordBreak: 'break-word' }}>{value}</Typography>
  </Box>
);
