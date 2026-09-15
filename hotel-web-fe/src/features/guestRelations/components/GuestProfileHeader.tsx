import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import {
  BlockOutlined as BlacklistedIcon,
  EditOutlined as EditIcon,
  EventAvailableOutlined as NewBookingIcon,
  MailOutlineOutlined as EmailIcon,
  NoteAddOutlined as AddNoteIcon,
  PersonSearchOutlined as DuplicateIcon,
  PhoneIphoneOutlined as AltPhoneIcon,
  PhoneOutlined as PhoneIcon,
  Star as MemberIcon,
  SupportAgentOutlined as SupportIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import type { Guest, GuestSummary } from '../../../types';
import { formatStatusLabel } from '../../../utils/formatters';
import { useTranslation } from '../../../i18n/useTranslation';
import { GUEST_DESIGN } from '../../guests/constants';
import { formatGuestProfileDate } from '../../guests/components/GuestProfileParts';
import { avatarFor, guestDisplayName, initialsOf } from '../utils';

interface GuestProfileHeaderProps {
  guest: Guest;
  summary: GuestSummary;
  duplicateCount: number;
  canEdit: boolean;
  canAddNote: boolean;
  canOpenSupport: boolean;
  onEdit: () => void;
  onNewBooking: () => void;
  onAddNote: () => void;
  onOpenSupport: () => void;
}

const ContactItem: React.FC<{ icon: React.ReactNode; value?: string | null; emptyText: string }> = ({
  icon,
  value,
  emptyText,
}) => (
  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
    <Box sx={{ color: GUEST_DESIGN.ink4, display: 'flex', '& svg': { fontSize: 15 } }}>{icon}</Box>
    <Typography
      variant="body2"
      sx={{ color: value ? GUEST_DESIGN.ink2 : GUEST_DESIGN.ink4, overflowWrap: 'anywhere' }}
    >
      {value || emptyText}
    </Typography>
  </Stack>
);

/**
 * Guest 360 header — identity block (avatar, display name, status chips,
 * contact points, stay recency) plus the quick-action row. Display name
 * follows `display_guest_name`: legal name once both halves exist, else the
 * booking nickname.
 */
const GuestProfileHeader: React.FC<GuestProfileHeaderProps> = ({
  guest,
  summary,
  duplicateCount,
  canEdit,
  canAddNote,
  canOpenSupport,
  onEdit,
  onNewBooking,
  onAddNote,
  onOpenSupport,
}) => {
  const { t } = useTranslation('guests');
  const displayName = guestDisplayName(guest);
  const bookedAs = guest.nick_name.trim() !== displayName ? guest.nick_name.trim() : null;
  const { bg, fg } = avatarFor(guest.id);
  const vipStatus = guest.vip_status?.trim();

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2.5}
        sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'flex-start' } }}
      >
        <Stack direction="row" spacing={2} sx={{ minWidth: 0, flex: 1 }}>
          <Avatar
            sx={{
              width: 64,
              height: 64,
              bgcolor: bg,
              color: fg,
              fontWeight: 800,
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {initialsOf(displayName)}
          </Avatar>

          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Typography variant="h5" sx={{ fontWeight: 900, overflowWrap: 'anywhere' }}>
                {displayName}
              </Typography>
              {guest.title && (
                <Typography variant="body2" sx={{ color: GUEST_DESIGN.ink3 }}>
                  {guest.title}
                </Typography>
              )}
            </Stack>
            <Typography variant="body2" sx={{ color: GUEST_DESIGN.ink3, mt: 0.25 }}>
              {t('profile.guestNumber', { id: guest.id })}
              {bookedAs && <> · {t('profile.bookedAs', { name: bookedAs })}</>}
              {guest.company_name && <> · {guest.company_name}</>}
            </Typography>

            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
              {guest.guest_type === 'member' && (
                <Chip
                  size="small"
                  icon={<MemberIcon sx={{ fontSize: 12 }} />}
                  label={t('profile.member')}
                  sx={{
                    bgcolor: GUEST_DESIGN.goldBg,
                    color: GUEST_DESIGN.gold,
                    fontWeight: 700,
                    '& .MuiChip-icon': { color: 'inherit' },
                  }}
                />
              )}
              {vipStatus && (
                <Chip
                  size="small"
                  icon={<VipIcon sx={{ fontSize: 12 }} />}
                  label={formatStatusLabel(vipStatus, 'VIP')}
                  sx={{
                    bgcolor: alpha('#5b3aa8', 0.12),
                    color: '#5b3aa8',
                    fontWeight: 700,
                    '& .MuiChip-icon': { color: 'inherit' },
                  }}
                />
              )}
              {summary.completed_stays > 0 && (
                <Chip size="small" label={t('profile.returning')} color="success" variant="outlined" />
              )}
              {guest.is_blacklisted && (
                <Tooltip title={guest.blacklist_reason ? t('profile.blacklistReason', { reason: guest.blacklist_reason }) : t('profile.noReason')}>
                  <Chip
                    size="small"
                    icon={<BlacklistedIcon sx={{ fontSize: 12 }} />}
                    label={t('profile.blacklisted')}
                    color="error"
                    sx={{ fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                </Tooltip>
              )}
              {duplicateCount > 0 && (
                <Tooltip title={t('profile.duplicateTooltip', { count: duplicateCount })}>
                  <Chip
                    size="small"
                    icon={<DuplicateIcon sx={{ fontSize: 12 }} />}
                    label={t('profile.duplicateChip')}
                    color="warning"
                    variant="outlined"
                    sx={{ fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                </Tooltip>
              )}
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.75, sm: 2.5 }}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 1.5 }}
            >
              <ContactItem icon={<EmailIcon />} value={guest.email} emptyText={t('profile.noEmail')} />
              <ContactItem icon={<PhoneIcon />} value={guest.phone} emptyText={t('profile.noPhone')} />
              <ContactItem icon={<AltPhoneIcon />} value={guest.alt_phone} emptyText={t('profile.noAltPhone')} />
            </Stack>

            <Typography variant="body2" sx={{ color: GUEST_DESIGN.ink3, mt: 1.5 }}>
              {t('profile.lastStay', { date: formatGuestProfileDate(summary.last_stay_at) })}
              {' · '}
              {t('profile.nextStay', { date: formatGuestProfileDate(summary.next_stay_at) })}
            </Typography>
          </Box>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
        >
          {canEdit && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={onEdit}
              sx={{ textTransform: 'none' }}
            >
              {t('profile.edit')}
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={<NewBookingIcon />}
            onClick={onNewBooking}
            sx={{ textTransform: 'none' }}
          >
            {t('profile.newBooking')}
          </Button>
          {canAddNote && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddNoteIcon />}
              onClick={onAddNote}
              sx={{ textTransform: 'none' }}
            >
              {t('profile.addNote')}
            </Button>
          )}
          {canOpenSupport && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SupportIcon />}
              onClick={onOpenSupport}
              sx={{ textTransform: 'none' }}
            >
              {t('profile.openSupport')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
};

export default GuestProfileHeader;
