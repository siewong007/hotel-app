import React from 'react';
import { Typography } from '@mui/material';
import type { TypographyProps } from '@mui/material';
import { useCurrency } from '../../hooks/useCurrency';

export interface MoneyTextProps extends Omit<TypographyProps, 'children'> {
  amount: number | string | null | undefined;
}

/** Money rendered in the hotel currency with tabular figures so columns of
 * amounts line up. Use instead of hand-formatting `RM` strings. */
const MoneyText: React.FC<MoneyTextProps> = ({ amount, sx, ...props }) => {
  const { format } = useCurrency();
  return (
    <Typography
      component="span"
      sx={[
        { fontVariantNumeric: 'tabular-nums' },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...props}
    >
      {format(toSafeNumber(amount))}
    </Typography>
  );
};

const toSafeNumber = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
};

export default MoneyText;
