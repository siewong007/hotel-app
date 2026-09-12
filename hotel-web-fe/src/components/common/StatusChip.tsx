import React from 'react';
import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import { formatStatusLabel } from '../../utils/formatters';

export type StatusTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'primary'
  | 'secondary'
  | 'neutral';

/**
 * Shared tone map so the same status reads the same colour on every screen.
 * Unknown statuses render neutral — the label is still humanized, never raw.
 */
const STATUS_TONES: Record<string, StatusTone> = {
  // done / good
  confirmed: 'success',
  checked_in: 'success',
  auto_checked_in: 'success',
  paid: 'success',
  available: 'success',
  active: 'success',
  resolved: 'success',
  completed: 'success',
  clean: 'success',
  approved: 'success',
  complimentary: 'secondary',
  fully_complimentary: 'secondary',
  partial_complimentary: 'secondary',
  // attention
  pending: 'warning',
  pending_payment: 'warning',
  partial: 'warning',
  unpaid_deposit: 'warning',
  dirty: 'warning',
  cleaning: 'warning',
  needs_reply: 'warning',
  reserved_dirty: 'warning',
  maintenance: 'warning',
  // neutral / in-flight
  checked_out: 'info',
  refunded: 'info',
  scheduled: 'info',
  waiting_for_guest: 'info',
  in_progress: 'primary',
  reserved: 'info',
  occupied: 'info',
  paid_rate: 'info',
  // negative
  cancelled: 'error',
  canceled: 'error',
  unpaid: 'error',
  overdue: 'error',
  failed: 'error',
  at_risk: 'error',
  no_show: 'error',
  declined: 'error',
  // inactive
  voided: 'neutral',
  void: 'neutral',
  draft: 'neutral',
  closed: 'neutral',
  unassigned: 'neutral',
};

export const statusTone = (status: string | null | undefined): StatusTone =>
  STATUS_TONES[(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral';

export interface StatusChipProps extends Omit<ChipProps, 'color' | 'label'> {
  /** Raw API status, e.g. `pending_payment`. */
  status: string | null | undefined;
  /** Override the humanized label. */
  label?: React.ReactNode;
  /** Override the auto-mapped tone. */
  tone?: StatusTone;
}

const StatusChip: React.FC<StatusChipProps> = ({
  status,
  label,
  tone,
  size = 'small',
  variant = 'outlined',
  sx,
  ...chipProps
}) => {
  const resolved = tone ?? statusTone(status);
  return (
    <Chip
      size={size}
      variant={variant}
      label={label ?? formatStatusLabel(status)}
      color={resolved === 'neutral' ? 'default' : resolved}
      sx={[{ fontWeight: 700 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      {...chipProps}
    />
  );
};

export default StatusChip;
