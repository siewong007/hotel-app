import React, { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import {
  Cancel as CancelIcon,
  Check as CheckIcon,
  Person as PersonIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import type { UserProfile } from '../../../../types';
import { validateEmail } from '../../../../utils/validation';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import EkycStatusCard from '../../../ekyc/components/EkycStatusCard';
import { useTranslation } from '../../../../i18n';
import { formatHotelDate } from '../../../../utils/date';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

interface ProfileFormData {
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string;
}

const formFromProfile = (profile: UserProfile): ProfileFormData => ({
  full_name: profile.full_name || '',
  email: profile.email || '',
  phone: profile.phone || '',
  avatar_url: profile.avatar_url || '',
});

interface ProfileTabProps {
  profile: UserProfile;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** `email` is omitted when the profile is a guest who already confirmed one. */
  onSave: (data: Omit<ProfileFormData, 'email'> & { email?: string }) => Promise<void>;
  notify: (message: string, severity: ApiNotificationSeverity) => void;
}

const ProfileTab: React.FC<ProfileTabProps> = ({
  profile,
  editing,
  onEditingChange,
  onSave,
  notify,
}) => {
  const { t } = useTranslation('auth');
  const [formData, setFormData] = useState<ProfileFormData>(() => formFromProfile(profile));
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Re-seed the form whenever a fresh profile arrives (initial load, refetch).
  useEffect(() => {
    setFormData(formFromProfile(profile));
  }, [profile]);

  // A guest keeps the email they already confirmed; support changes it for them.
  const canEditEmail = profile.user_type !== 'guest' || !profile.email_configured;

  const handleSave = async () => {
    const nextEmail = formData.email.trim();
    const emailValidation = canEditEmail && nextEmail ? validateEmail(nextEmail) : '';
    if (emailValidation) {
      setEmailError(emailValidation);
      notify(emailValidation, 'warning');
      return;
    }

    await onSave({
      ...formData,
      email: canEditEmail && nextEmail ? nextEmail : undefined,
    });
  };

  const handleCancel = () => {
    onEditingChange(false);
    setFormData(formFromProfile(profile));
    setEmailError('');
    setPhoneError('');
  };

  const handleAvatarUpload = (file: File) => {
    if (file.size > MAX_AVATAR_BYTES) {
      notify(t('profile.avatarTooLarge'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(current => ({ ...current, avatar_url: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      {/* eKYC self check-in is guest-only — for staff the status endpoint
          400s, which the global error hook surfaces as a toast and a
          notification-center entry on every profile visit. */}
      {profile.user_type === 'guest' && (
        <Box sx={{ mb: 3 }}>
          <EkycStatusCard />
        </Box>
      )}
      {profile.user_type === 'guest' && !profile.email_configured && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => onEditingChange(true)}>
              {t('profile.addEmail')}
            </Button>
          }
        >
          {t('profile.addEmailHint')}
        </Alert>
      )}
      <Card>
        <CardContent>
          {/* Wraps on phones: the Cancel/Save pair used to push Save past the
              right edge of a 390px screen. */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 2, mb: 4 }}>
            <Avatar
              src={formData.avatar_url || profile.avatar_url}
              sx={{
                width: 80,
                height: 80,
                mr: 3,
                bgcolor: 'primary.main',
                fontSize: '2rem',
                fontWeight: 600,
              }}
            >
              {!formData.avatar_url &&
                !profile.avatar_url &&
                (profile.full_name?.charAt(0) || profile.username?.charAt(0))}
            </Avatar>
            <Box sx={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {profile.full_name || profile.username}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                @{profile.username}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('profile.memberSince', { date: formatHotelDate(profile.created_at) })}
              </Typography>
            </Box>
            {!editing ? (
              <Button
                variant="contained"
                startIcon={<PersonIcon />}
                onClick={() => onEditingChange(true)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                {t('profile.editProfile')}
              </Button>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  width: { xs: '100%', sm: 'auto' },
                  '& > .MuiButton-root': { flex: { xs: 1, sm: 'none' } },
                }}
              >
                <Button variant="outlined" startIcon={<CancelIcon />} onClick={handleCancel}>
                  {t('common:actions.cancel')}
                </Button>
                <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
                  {t('common:actions.save')}
                </Button>
              </Box>
            )}
          </Box>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('common:field.fullName')}
                value={formData.full_name}
                onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                disabled={!editing}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box>
                <TextField
                  fullWidth
                  label={t('common:field.email')}
                  type="email"
                  value={formData.email}
                  onChange={e => {
                    setFormData({ ...formData, email: e.target.value });
                    setEmailError('');
                  }}
                  onBlur={() => {
                    if (editing && formData.email.trim()) {
                      setEmailError(validateEmail(formData.email));
                    }
                  }}
                  error={!!emailError}
                  helperText={
                    emailError ||
                    (canEditEmail
                      ? t('profile.emailHintEditable')
                      : t('profile.emailHintLocked'))
                  }
                  disabled={!editing || !canEditEmail}
                />
                {profile.user_type === 'guest' && (
                  <Chip
                    size="small"
                    sx={{ mt: 1 }}
                    color={profile.email_configured && profile.is_verified ? 'success' : 'default'}
                    icon={
                      profile.email_configured && profile.is_verified ? <CheckIcon /> : undefined
                    }
                    label={
                      !profile.email_configured
                        ? t('profile.emailNotConfigured')
                        : profile.is_verified
                          ? t('profile.emailVerified')
                          : t('profile.emailVerificationPending')
                    }
                  />
                )}
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="tel"
                label={t('common:field.phone')}
                value={formData.phone}
                onChange={e => {
                  setFormData({ ...formData, phone: e.target.value });
                  setPhoneError('');
                }}
                onBlur={() => setPhoneError('')}
                error={!!phoneError}
                helperText={phoneError}
                disabled={!editing}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('profile.avatarUrl')}
                value={formData.avatar_url}
                onChange={e => setFormData({ ...formData, avatar_url: e.target.value })}
                disabled={!editing}
                helperText={t('profile.avatarUrlHint')}
              />
            </Grid>
            {editing && (
              <Grid size={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                  <Button variant="outlined" component="label">
                    {t('profile.uploadAvatar')}
                    <input
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleAvatarUpload(file);
                      }}
                    />
                  </Button>
                  {formData.avatar_url && (
                    <Button
                      variant="text"
                      color="error"
                      onClick={() => setFormData({ ...formData, avatar_url: '' })}
                    >
                      {t('profile.removeAvatar')}
                    </Button>
                  )}
                  {formData.avatar_url && (
                    <Avatar src={formData.avatar_url} sx={{ width: 40, height: 40 }} />
                  )}
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    mt: 1,
                    display: 'block'
                  }}>
                  {t('profile.avatarFormats')}
                </Typography>
              </Grid>
            )}
          </Grid>
        </CardContent>
      </Card>
    </>
  );
};

export default ProfileTab;
