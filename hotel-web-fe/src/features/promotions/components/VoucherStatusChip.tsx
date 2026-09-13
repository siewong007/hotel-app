import StatusChip from '../../../components/common/StatusChip';
import type { StatusTone } from '../../../components/common/StatusChip';
import { VOUCHER_DISPLAY_STATUS_LABELS } from '../constants';
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
  const display = voucherDisplayStatus(voucher);
  return (
    <StatusChip
      status={display}
      label={VOUCHER_DISPLAY_STATUS_LABELS[display] ?? display}
      tone={TONES[display] ?? 'neutral'}
      size={size}
    />
  );
}
