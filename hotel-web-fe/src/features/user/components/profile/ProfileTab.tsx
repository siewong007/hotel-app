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
  Edit as EditIcon,
  FileUploadOutlined as UploadIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import type { UserProfile } from '../../../../types';
import { validateEmail } from '../../../../utils/validation';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import EkycStatusCard from '../../../ekyc/components/EkycStatusCard';
import { useTranslation } from '../../../../i18n';
import { StickyActionBar } from '../../../../components/common/StickyActionBar';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { profileInitials } from './ProfileHeaderCard';

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
  const isPhone = useIsPhone();
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

  const emailStatusChip =
    profile.user_type === 'guest' ? (
      <Chip
        size="small"
        sx={{ mt: 1 }}
        color={profile.email_configured && profile.is_verified ? 'success' : 'default'}
        icon={profile.email_configured && profile.is_verified ? <CheckIcon /> : undefined}
        label={
          !profile.email_configured
            ? t('profile.emailNotConfigured')
            : profile.is_verified
              ? t('profile.emailVerified')
              : t('profile.emailVerificationPending')
        }
      />
    ) : null;

  const cancelButton = (
    <Button variant="outlined" startIcon={<CancelIcon />} onClick={handleCancel}>
      {t('common:actions.cancel')}
    </Button>
  );
  const saveButton = (
    <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
      {t('common:actions.save')}
    </Button>
  );

  // Read-only rows: plain text reads better than greyed-out disabled inputs,
  // and a phone shows all three on one screen.
  const readOnlyRows: Array<{ key: string; label: string; value?: string; extra?: React.ReactNode }> = [
    { key: 'full_name', label: t('common:field.fullName'), value: profile.full_name },
    {
      key: 'email',
      label: t('common:field.email'),
      value: profile.email?.endsWith('@no-email.invalid') ? '' : profile.email,
      extra: emailStatusChip,
    },
    { key: 'phone', label: t('common:field.phone'), value: profile.phone },
  ];

  return (
    <>
      {/* eKYC self check-in is guest-only — for staff the status endpoint
          400s, which the global error hook surfaces as a toast and a
          notification-center entry on every profile visit. */}
      {profile.user_type === 'guest' && (
        <Box sx={{ mb: 2 }}>
          <EkycStatusCard />
        </Box>
      )}
      {profile.user_type === 'guest' && !profile.email_configured && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
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
        <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              mb: 2,
            }}
          >
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
              {t('profile.sections.accountDetails')}
            </Typography>
            {!editing && (
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => onEditingChange(true)}
                sx={{ flexShrink: 0 }}
              >
                {t('profile.editProfile')}
              </Button>
            )}
          </Box>

          {!editing ? (
            <Box component="dl" sx={{ m: 0 }}>
              {readOnlyRows.map((row, index) => (
                <Box
                  key={row.key}
                  sx={{
                    py: 1.5,
                    borderTop: index === 0 ? 'none' : '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
                    {row.label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body1"
                    sx={{
                      m: 0,
                      overflowWrap: 'anywhere',
                      color: row.value ? 'text.primary' : 'text.disabled',
                    }}
                  >
                    {row.value || '—'}
                  </Typography>
                  {row.extra}
                </Box>
              ))}
            </Box>
          ) : (
            <Grid container spacing={{ xs: 2, sm: 3 }}>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label={t('common:field.fullName')}
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                  autoComplete="name"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
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
                  disabled={!canEditEmail}
                  autoComplete="email"
                  slotProps={{ htmlInput: { inputMode: 'email' } }}
                />
                {emailStatusChip}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
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
                  autoComplete="tel"
                />
              </Grid>
              <Grid size={12}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                  }}
                >
                  <Avatar
                    src={formData.avatar_url || undefined}
                    alt=""
                    sx={{ width: 56, height: 56, flexShrink: 0, bgcolor: 'primary.main', fontWeight: 600 }}
                  >
                    {!formData.avatar_url && profileInitials(profile)}
                  </Avatar>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      gap: 1,
                      flex: 1,
                      minWidth: 0,
                      '& > .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
                    }}
                  >
                    <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
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
                  </Box>
                </Box>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', mt: 1, display: 'block' }}
                >
                  {t('profile.avatarFormats')}
                </Typography>
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label={t('profile.avatarUrl')}
                  value={formData.avatar_url}
                  onChange={e => setFormData({ ...formData, avatar_url: e.target.value })}
                  helperText={t('profile.avatarUrlHint')}
                  slotProps={{ htmlInput: { inputMode: 'url' } }}
                />
              </Grid>
              {!isPhone && (
                <Grid size={12}>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                    {cancelButton}
                    {saveButton}
                  </Box>
                </Grid>
              )}
            </Grid>
          )}
        </CardContent>
      </Card>

      {/* Phones: Save/Cancel pin above the bottom nav so they stay in reach
          while the keyboard and long form scroll; the spacer keeps the last
          field clear of the fixed bar. */}
      {editing && isPhone && (
        <>
          <Box aria-hidden sx={{ height: 72 }} />
          <StickyActionBar secondary={cancelButton} primary={saveButton} />
        </>
      )}
    </>
  );
};

export default ProfileTab;
