import { Chip, type ChipProps } from '@mui/material';
import type { SupportConversationStatus, SupportPriority } from '../types';

const STATUS_COLORS: Record<SupportConversationStatus, ChipProps['color']> = {
  waiting_for_staff: 'warning',
  waiting_for_guest: 'info',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_COLORS: Record<SupportPriority, ChipProps['color']> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'error',
};

export function humanizeSupportValue(value?: string | null): string {
  if (!value) return '—';
  return value
    .split('_')
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function formatSupportDate(value?: string | null): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function SupportStatusChip({ status }: { status: SupportConversationStatus }) {
  return (
    <Chip
      size="small"
      label={humanizeSupportValue(status)}
      color={STATUS_COLORS[status]}
      variant={status === 'closed' ? 'outlined' : 'filled'}
    />
  );
}

export function SupportPriorityChip({ priority }: { priority: SupportPriority }) {
  return <Chip size="small" label={humanizeSupportValue(priority)} color={PRIORITY_COLORS[priority]} />;
}

export function SupportSlaChip({
  isAtRisk,
  isBreached,
  dueAt,
}: {
  isAtRisk: boolean;
  isBreached: boolean;
  dueAt?: string | null;
}) {
  if (isBreached) {
    return <Chip size="small" label="SLA breached" color="error" variant="outlined" />;
  }

  if (isAtRisk) {
    return <Chip size="small" label="SLA at risk" color="warning" variant="outlined" />;
  }

  if (!dueAt) return null;

  return <Chip size="small" label={`Due ${formatSupportDate(dueAt)}`} variant="outlined" />;
}

