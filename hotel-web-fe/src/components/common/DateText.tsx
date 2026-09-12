import React from 'react';
import { Typography } from '@mui/material';
import type { TypographyProps } from '@mui/material';
import { formatHotelDate, formatHotelDateTime, type BusinessDateValue } from '../../utils/date';
import { formatDateRange } from '../../utils/formatters';

export interface DateTextProps extends Omit<TypographyProps, 'children'> {
  value: BusinessDateValue;
  /** 'date' → Sep 13, 2026 · 'long' → Sunday, September 13, 2026 · 'dateTime' → date + time */
  format?: 'date' | 'long' | 'dateTime';
  fallback?: string;
}

/** A date rendered in the hotel timezone via the shared formatters — never
 * hand-rolled `toLocaleDateString` output. */
export const DateText: React.FC<DateTextProps> = ({
  value,
  format = 'date',
  fallback = '—',
  ...props
}) => {
  const text =
    format === 'dateTime'
      ? formatHotelDateTime(value, fallback)
      : formatHotelDate(value, fallback);
  return (
    <Typography component="span" {...props}>
      {text}
    </Typography>
  );
};

export interface DateRangeTextProps extends Omit<TypographyProps, 'children'> {
  from: BusinessDateValue;
  to: BusinessDateValue;
  fallback?: string;
}

/** `Sep 13 – Sep 15, 2026` — the canonical stay-range rendering. */
export const DateRangeText: React.FC<DateRangeTextProps> = ({ from, to, fallback, ...props }) => (
  <Typography component="span" {...props}>
    {formatDateRange(from, to, fallback)}
  </Typography>
);

export default DateText;
