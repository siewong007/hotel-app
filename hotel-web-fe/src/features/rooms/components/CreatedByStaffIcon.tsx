// Small badge on a room card or timeline chip when the current booking was
// created by staff. The API only sends created_by_name for user_type staff
// with a non-blank full_name, so a missing name means website / guest.

import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { BadgeOutlined } from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from '../../../i18n/useTranslation';
import { COARSE_HIT_AREA_SX } from '../../../components/common/touchTarget';

export function staffCreatorLabel(name?: string | null): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

export const CreatedByStaffIcon: React.FC<{
  name?: string | null;
  sx?: SxProps<Theme>;
}> = ({ name, sx }) => {
  const { t } = useTranslation('rooms');
  const creator = staffCreatorLabel(name);
  if (!creator) return null;
  const label = t('card.createdBy', { name: creator });
  return (
    <Tooltip title={label} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
      <IconButton
        size="small"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // Hover shows the name. On touch, the tap opens the tooltip and
          // must not also open the card menu or the timeline popover.
          e.stopPropagation();
        }}
        sx={[
          {
            ...COARSE_HIT_AREA_SX,
            width: 22,
            height: 22,
            p: 0,
            flexShrink: 0,
            color: 'inherit',
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        <BadgeOutlined sx={{ fontSize: 15 }} />
      </IconButton>
    </Tooltip>
  );
};
