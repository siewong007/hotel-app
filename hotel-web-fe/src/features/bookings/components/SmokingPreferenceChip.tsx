// Guest room smoking-preference chip, shared by the Room Management card and
// the staff booking details panel. Mirrors the cleaning-preference chip on the
// room card. The preference is soft (allocation tries to honour it but never
// refuses a booking), so a mismatch with the assigned room is possible and is
// flagged in the warning style for staff to follow up.

import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import {
  SmokingRooms as SmokingIcon,
  SmokeFree as SmokeFreeIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';
import { useTranslation } from '../../../i18n/useTranslation';

export type SmokingPreferenceValue = 'smoking' | 'non_smoking';

/**
 * True when the guest asked for one kind of room and the booked room is the
 * other kind. Unknown room (`null`/`undefined`, e.g. no room assigned) or no
 * preference is never a mismatch.
 */
export function isSmokingPreferenceMismatch(
  preference: SmokingPreferenceValue | null | undefined,
  roomIsSmoking: boolean | null | undefined,
): boolean {
  if (!preference || roomIsSmoking == null) return false;
  return (preference === 'smoking') !== roomIsSmoking;
}

export interface SmokingPreferenceChipProps {
  preference: SmokingPreferenceValue | null | undefined;
  /** `rooms.is_smoking` of the booked room; omit when no room is assigned. */
  roomIsSmoking?: boolean | null;
  sx?: React.ComponentProps<typeof Box>['sx'];
}

export const SmokingPreferenceChip: React.FC<SmokingPreferenceChipProps> = ({ preference, roomIsSmoking, sx }) => {
  const { t } = useTranslation('bookings');
  if (preference !== 'smoking' && preference !== 'non_smoking') return null;

  const wantsSmoking = preference === 'smoking';
  const mismatch = isSmokingPreferenceMismatch(preference, roomIsSmoking);
  const label = wantsSmoking ? t('smokingPreference.chipSmoking') : t('smokingPreference.chipNonSmoking');
  const tooltip = mismatch
    ? wantsSmoking
      ? t('smokingPreference.mismatchWantsSmoking')
      : t('smokingPreference.mismatchWantsNonSmoking')
    : t('smokingPreference.hint');
  const Icon = mismatch ? WarningIcon : wantsSmoking ? SmokingIcon : SmokeFreeIcon;

  return (
    <Tooltip title={tooltip} arrow>
      <Box
        data-testid="smoking-preference-chip"
        data-mismatch={mismatch ? 'true' : 'false'}
        aria-label={mismatch ? `${label}. ${tooltip}` : label}
        sx={[
          {
            display: 'inline-flex',
            alignSelf: 'flex-start',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.3,
            borderRadius: 999,
          },
          mismatch
            ? {
                bgcolor: 'var(--hotel-warning-bg)',
                color: 'var(--hotel-warning)',
                border: '1px solid var(--hotel-warning-border)',
              }
            : {
                bgcolor: 'background.paper',
                color: 'text.secondary',
                border: '1px solid var(--hotel-border-strong)',
              },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Icon sx={{ fontSize: 13 }} />
        <Typography component="span" sx={{ fontSize: '0.65rem', fontWeight: 700 }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
};

export default SmokingPreferenceChip;
