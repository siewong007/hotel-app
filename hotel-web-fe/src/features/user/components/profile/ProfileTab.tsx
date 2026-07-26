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
      notify('Image size must be less than 2MB', 'error');
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
      <Box sx={{ mb: 3 }}>
        <EkycStatusCard />
      </Box>

      {profile.user_type === 'guest' && !profile.email_configured && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => onEditingChange(true)}>
              Add Email
            </Button>
          }
        >
          Add an email address to receive account and booking updates.
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
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
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {profile.full_name || profile.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                @{profile.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Member since {new Date(profile.created_at).toLocaleDateString()}
              </Typography>
            </Box>
            {!editing ? (
              <Button
                variant="contained"
                startIcon={<PersonIcon />}
                onClick={() => onEditingChange(true)}
              >
                Edit Profile
              </Button>
            ) : (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" startIcon={<CancelIcon />} onClick={handleCancel}>
                  Cancel
                </Button>
                <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
                  Save
                </Button>
              </Box>
            )}
          </Box>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Full Name"
                value={formData.full_name}
                onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                disabled={!editing}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box>
                <TextField
                  fullWidth
                  label="Email"
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
                      ? 'Used for account verification and booking updates.'
                      : 'Contact support if you need to change this email.')
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
                        ? 'Email not configured'
                        : profile.is_verified
                          ? 'Email verified'
                          : 'Verification pending'
                    }
                  />
                )}
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Phone"
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
                label="Avatar URL"
                value={formData.avatar_url}
                onChange={e => setFormData({ ...formData, avatar_url: e.target.value })}
                disabled={!editing}
                helperText="Enter a URL to your profile picture or upload an image below"
              />
            </Grid>
            {editing && (
              <Grid size={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Button variant="outlined" component="label">
                    Upload Profile Picture
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
                      Remove Picture
                    </Button>
                  )}
                  {formData.avatar_url && (
                    <Avatar src={formData.avatar_url} sx={{ width: 40, height: 40 }} />
                  )}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: 'block' }}
                >
                  Supported formats: JPG, PNG, GIF. Max size: 2MB
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
