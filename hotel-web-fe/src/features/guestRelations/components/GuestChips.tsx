import React from 'react';
import { Box, Chip, alpha } from '@mui/material';
import {
  GppBadOutlined as BlacklistedBadgeIcon,
  Star as MemberIcon,
  SupportAgentOutlined as OpenRequestsIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { formatStatusLabel } from '../../../utils/formatters';
import { GUEST_DESIGN } from '../../guests/constants';
import { guestHasMissingTourismType } from '../../guests/utils';
import { avatarFor, initialsOf } from '../utils';

export const GuestAvatar: React.FC<{ guest: Guest; size?: number }> = ({ guest, size = 34 }) => {
  const av = avatarFor(guest.id);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: av.bg,
        color: av.fg,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.31,
        border: '1px solid rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      {initialsOf(guest.nick_name)}
    </Box>
  );
};

export const MemberChip: React.FC = () => (
  <Chip
    size="small"
    icon={<MemberIcon sx={{ fontSize: 12 }} />}
    label="Member"
    sx={{ bgcolor: GUEST_DESIGN.goldBg, color: GUEST_DESIGN.gold, fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
  />
);

export const VipChip: React.FC<{ status: string }> = ({ status }) => (
  <Chip
    size="small"
    icon={<VipIcon sx={{ fontSize: 12 }} />}
    label={formatStatusLabel(status, 'VIP')}
    sx={{ bgcolor: alpha('#5b3aa8', 0.12), color: '#5b3aa8', fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
  />
);

export const OpenRequestChip: React.FC = () => (
  <Chip
    size="small"
    icon={<OpenRequestsIcon sx={{ fontSize: 13 }} />}
    label="Open request"
    sx={{
      bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.blue} 10%, transparent)`,
      color: GUEST_DESIGN.blue,
      fontWeight: 700,
      '& .MuiChip-icon': { color: 'inherit' },
    }}
  />
);

export const TourismChip: React.FC<{ guest: Guest }> = ({ guest }) => {
  if (guestHasMissingTourismType(guest)) {
    return (
      <Chip
        size="small"
        label="Missing tourism"
        sx={{ bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.rose} 10%, transparent)`, color: GUEST_DESIGN.rose, fontWeight: 700 }}
      />
    );
  }
  if (guest.tourism_type === 'foreign') {
    return (
      <Chip
        size="small"
        label="Tourist"
        sx={{ bgcolor: GUEST_DESIGN.blueBg, color: GUEST_DESIGN.blue, fontWeight: 700 }}
      />
    );
  }
  if (guest.tourism_type === 'local') {
    return (
      <Chip
        size="small"
        label="Local"
        sx={{ bgcolor: GUEST_DESIGN.green50, color: GUEST_DESIGN.green700, fontWeight: 700 }}
      />
    );
  }
  return null;
};

/**
 * Blacklisted badge. The alerts column shows it under a reason Tooltip with the
 * default shield icon; the mobile card passes the plainer Block icon — the
 * `icon` prop keeps either look while sharing the chip itself.
 */
export const BlacklistedChip: React.FC<{ icon?: React.ReactElement }> = ({
  icon = <BlacklistedBadgeIcon sx={{ fontSize: 14 }} />,
}) => (
  <Chip
    size="small"
    icon={icon}
    label="Blacklisted"
    sx={{
      bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.rose} 10%, transparent)`,
      color: GUEST_DESIGN.rose,
      fontWeight: 700,
      '& .MuiChip-icon': { color: 'inherit' },
    }}
  />
);
