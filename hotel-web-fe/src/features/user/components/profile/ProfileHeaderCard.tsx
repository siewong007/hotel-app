import React from 'react';
import { Avatar, Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import {
  MailOutlined as MailIcon,
  CalendarMonthOutlined as CalendarIcon,
} from '@mui/icons-material';
import type { UserProfile } from '../../../../types';
import { useTranslation } from '../../../../i18n';
import { formatHotelDate } from '../../../../utils/date';
import { formatStatusLabel } from '../../../../utils/formatters';

/** Two-letter initials from the full name, else the username's first letter. */
export const profileInitials = (profile: Pick<UserProfile, 'full_name' | 'username'>): string => {
  const parts = (profile.full_name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return profile.username?.[0]?.toUpperCase() || '?';
};

interface ProfileHeaderCardProps {
  profile: UserProfile;
  roles: string[];
}

/**
 * Identity summary at the top of /profile: avatar or initials, name,
 * @username, role chips and email. Compact on phones (avatar beside the text,
 * everything wraps) so the first screen shows who is signed in without the
 * form pushing it away.
 */
const ProfileHeaderCard: React.FC<ProfileHeaderCardProps> = ({ profile, roles }) => {
  const { t } = useTranslation('auth');
  const { tOr } = useTranslation('nav');
  const src = profile.avatar_url;
  // Guests without a real address carry a placeholder; never show it.
  const email = profile.email?.endsWith('@no-email.invalid') ? '' : profile.email;

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 2, sm: 3 } }}>
          <Avatar
            src={src || undefined}
            alt=""
            sx={{
              width: { xs: 64, sm: 80 },
              height: { xs: 64, sm: 80 },
              flexShrink: 0,
              bgcolor: 'primary.main',
              fontSize: { xs: '1.5rem', sm: '2rem' },
              fontWeight: 600,
            }}
          >
            {!src && profileInitials(profile)}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="h6"
              component="p"
              sx={{ fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}
            >
              {profile.full_name || profile.username}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
              @{profile.username}
            </Typography>
            {roles.length > 0 && (
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                {roles.map(role => (
                  <Chip
                    key={role}
                    size="small"
                    color="primary"
                    variant="outlined"
                    // intentional: dynamic key — role is a DB enum value; unknown roles humanize
                    label={tOr(`roles.${role}`, formatStatusLabel(role))}
                  />
                ))}
              </Stack>
            )}
          </Box>
        </Box>

        <Stack
          spacing={0.75}
          sx={{
            mt: 2,
            pt: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            color: 'text.secondary',
          }}
        >
          {email && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <MailIcon fontSize="small" aria-hidden />
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {email}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CalendarIcon fontSize="small" aria-hidden />
            <Typography variant="body2">
              {t('profile.memberSince', { date: formatHotelDate(profile.created_at) })}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ProfileHeaderCard;
