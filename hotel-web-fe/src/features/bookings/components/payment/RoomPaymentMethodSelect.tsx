import React, { useEffect, useMemo } from 'react';
import { Alert, Box, Chip, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { useTranslation } from '../../../../i18n';
import {
  getRoomMethodOptions,
  getSettlementLock,
  paymentMethodsMatch,
  presetRoomMethod,
  type SettlementLock,
} from '../../utils/settlementLock';

export interface RoomPaymentMethodSelectProps {
  booking: Parameters<typeof getSettlementLock>[0];
  paymentMethods: readonly string[];
  value: string;
  onChange: (method: string) => void;
  label: string;
  size?: 'small' | 'medium';
}

/** "Settled via {platform}" chip shown next to a locked tender. */
export const SettledViaChip: React.FC<{ lock: SettlementLock; size?: 'small' | 'medium' }> = ({ lock, size = 'small' }) => {
  const { t } = useTranslation('bookings');
  if (lock.kind !== 'locked') return null;
  return (
    <Chip
      icon={<LockIcon />}
      size={size}
      color="info"
      variant="outlined"
      label={t('settlementLock.settledVia', { platform: lock.platform })}
      data-testid="settled-via-chip"
      sx={{ maxWidth: '100%' }}
    />
  );
};

/** Alert for an online booking whose room charge cannot be recorded yet. */
export const SettlementLockAlert: React.FC<{ lock: SettlementLock }> = ({ lock }) => {
  const { t } = useTranslation('bookings');
  if (lock.kind === 'missing_channel') {
    return <Alert severity="error" sx={{ mb: 1 }}>{t('settlementLock.missingChannel')}</Alert>;
  }
  if (lock.kind === 'unconfigured') {
    return <Alert severity="error" sx={{ mb: 1 }}>{t('settlementLock.unconfigured', { platform: lock.platform })}</Alert>;
  }
  return null;
};

/**
 * Room-charge tender picker. On an online booking it offers only the
 * channel's settlement tender(s), presets the value to an allowed one, and is
 * disabled when there is a single choice. Walk-in/phone bookings get the full
 * configured list, unchanged.
 */
const RoomPaymentMethodSelect: React.FC<RoomPaymentMethodSelectProps> = ({
  booking,
  paymentMethods,
  value,
  onChange,
  label,
  size,
}) => {
  const lock = useMemo(() => getSettlementLock(booking), [booking]);
  const options = useMemo(() => getRoomMethodOptions(lock, paymentMethods), [lock, paymentMethods]);
  const locked = lock.kind !== 'unlocked';

  useEffect(() => {
    if (!locked) return;
    const preset = presetRoomMethod(lock, paymentMethods, value);
    if (preset && preset !== value) onChange(preset);
  }, [lock, locked, paymentMethods, value, onChange]);

  const selectValue = locked ? (options.find((m) => paymentMethodsMatch(m, value)) ?? '') : value;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
      <SettlementLockAlert lock={lock} />
      <FormControl fullWidth size={size} disabled={locked && options.length <= 1}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={selectValue}
          label={label}
          onChange={(e) => onChange(String(e.target.value))}
          inputProps={{ 'data-testid': 'room-payment-method' }}
        >
          {options.map((m) => (
            <MenuItem key={m} value={m}>{m}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {lock.kind === 'locked' && (
        <Box>
          <SettledViaChip lock={lock} />
        </Box>
      )}
    </Box>
  );
};

export default RoomPaymentMethodSelect;
