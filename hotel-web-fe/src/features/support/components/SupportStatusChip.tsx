import { Chip, type ChipProps } from '@mui/material';
import StatusChip, { type StatusTone } from '../../../components/common/StatusChip';
import { formatStatusLabel } from '../../../utils/formatters';
import { formatHotelDateTime } from '../../../utils/date';
import { useTranslation, type UseTranslationResult } from '../../../i18n/useTranslation';
import { statusLabel } from '../../../i18n/statusLabel';
import type { SupportConversationStatus, SupportPriority } from '../types';

const STATUS_COLORS: Record<SupportConversationStatus, StatusTone> = {
  waiting_for_staff: 'warning',
  waiting_for_guest: 'info',
  resolved: 'success',
  closed: 'neutral',
};

const PRIORITY_COLORS: Record<SupportPriority, ChipProps['color']> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'error',
};

export function humanizeSupportValue(value?: string | null): string {
  return formatStatusLabel(value);
}

/** Localized label for a support conversation category (`support:categories.*`),
 *  falling back to the humanized raw value for categories outside the enum. */
export function supportCategoryLabel(
  tOr: UseTranslationResult['tOr'],
  category?: string | null,
): string {
  return category ? tOr(`categories.${category}`, formatStatusLabel(category)) : formatStatusLabel(category);
}

export function formatSupportDate(value?: string | null): string {
  if (!value) return '—';
  return formatHotelDateTime(value, '—');
}

export function SupportStatusChip({ status }: { status: SupportConversationStatus }) {
  return (
    <StatusChip
      status={status}
      domain="support"
      tone={STATUS_COLORS[status]}
      variant={status === 'closed' ? 'outlined' : 'filled'}
    />
  );
}

export function SupportPriorityChip({ priority }: { priority: SupportPriority }) {
  const { t } = useTranslation('support');
  return <Chip size="small" label={statusLabel(t, 'priority', priority)} color={PRIORITY_COLORS[priority]} />;
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
  const { t } = useTranslation('support');
  if (isBreached) {
    return <Chip size="small" label={t('sla.breached')} color="error" variant="outlined" />;
  }

  if (isAtRisk) {
    return <Chip size="small" label={t('sla.atRisk')} color="warning" variant="outlined" />;
  }

  if (!dueAt) return null;

  return <Chip size="small" label={t('sla.due', { date: formatSupportDate(dueAt) })} variant="outlined" />;
}
