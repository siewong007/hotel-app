import StatusChip from '../../../components/common/StatusChip';
import type { StatusTone } from '../../../components/common/StatusChip';
import { statusLabel, useTranslation } from '../../../i18n';
import type { Voucher, VoucherDisplayStatus } from '../types';
import { voucherDisplayStatus } from '../utils';

const TONES: Record<VoucherDisplayStatus, StatusTone> = {
  available: 'success',
  expired: 'warning',
  redeemed: 'info',
  revoked: 'error',
};

export function VoucherStatusChip({
  voucher,
  size = 'small',
}: {
  voucher: Pick<Voucher, 'status' | 'expires_at'>;
  size?: 'small' | 'medium';
}) {
  const { t } = useTranslation('promotions');
  const display = voucherDisplayStatus(voucher);
  return (
    <StatusChip
      status={display}
      label={statusLabel(t, 'voucher', display)}
      tone={TONES[display] ?? 'neutral'}
      size={size}
    />
  );
}
