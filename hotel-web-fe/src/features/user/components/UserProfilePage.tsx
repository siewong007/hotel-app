import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HTTPError } from 'ky';
import { useSearchParams } from '../../../router';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import { LogoLoader } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import type { UserSessionInfo } from '../../../types';
import { ApiNotificationSeverity, emitApiNotification } from '../../../utils/apiNotifications';
import TwoFactorSetup from '../../auth/components/TwoFactorSetup';
import {
  useDeletePasskeyMutation,
  usePasskeysQuery,
  useProfileQuery,
  useRegisterPasskeyMutation,
  useRenamePasskeyMutation,
  useRevokeSessionMutation,
  useSessionsQuery,
  useUpdatePasswordMutation,
  useUpdateProfileMutation,
} from '../hooks/useProfileQueries';
import ProfileHeaderCard from './profile/ProfileHeaderCard';
import ProfileTab from './profile/ProfileTab';
import SecurityTab from './profile/SecurityTab';
import PasskeysTab, { MAX_PASSKEYS } from './profile/PasskeysTab';
import DevicesTab from './profile/DevicesTab';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useTranslation } from '../../../i18n';

// MUI's visuallyHidden recipe, inlined (@mui/utils is not a direct dependency).
const VISUALLY_HIDDEN = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const UserProfilePage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const { registerPasskey, roles } = useAuth();

  const profileQuery = useProfileQuery();
  const passkeysQuery = usePasskeysQuery();
  const sessionsQuery = useSessionsQuery();

  const updateProfile = useUpdateProfileMutation();
  const updatePassword = useUpdatePasswordMutation();
  const deletePasskey = useDeletePasskeyMutation();
  const renamePasskey = useRenamePasskeyMutation();
  const addPasskey = useRegisterPasskeyMutation(registerPasskey);
  const revokeSession = useRevokeSessionMutation();

  // Phone-only jump links: the page is one scrolling column there, so these
  // replace the old tab bar (whose last two tabs were scrolled out of view).
  const SECTIONS = [
    { id: 'profile-account', label: t('profile.sections.accountDetails') },
    { id: 'profile-security', label: t('profile.tabs.security') },
    { id: 'profile-devices', label: t('profile.tabs.devices') },
  ];
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const notify = useCallback((message: string, severity: ApiNotificationSeverity) => {
    emitApiNotification({ message, severity });
  }, []);

  // Auto-enter edit mode from a one-time `?edit=true` URL param, then strip it.
  // Guarded so it only acts once (setSearchParams below would otherwise
  // re-trigger this effect via the new searchParams identity).
  const hasCheckedEditParamRef = useRef(false);
  useEffect(() => {
    if (hasCheckedEditParamRef.current) return;
    hasCheckedEditParamRef.current = true;

    if (searchParams.get('edit') === 'true') {
      setEditing(true);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const profile = profileQuery.data;

  const handleSaveProfile = async (data: Parameters<typeof updateProfile.mutateAsync>[0]) => {
    const isAddingGuestEmail =
      profile?.user_type === 'guest' && !profile.email_configured && Boolean(data.email);
    try {
      await updateProfile.mutateAsync(data);
      setEditing(false);
      notify(
        isAddingGuestEmail
          ? t('profile.emailAddedVerify')
          : t('profile.updated'),
        'success'
      );
    } catch (error) {
      notify(errorMessage(error, t('profile.updateFailed')), 'error');
    }
  };

  const handleUpdatePassword = async (data: {
    current_password: string;
    new_password: string;
  }) => {
    try {
      await updatePassword.mutateAsync(data);
      notify(t('security.passwordUpdated'), 'success');
    } catch (error) {
      // The backend returns 401 when the current password is wrong; the
      // generic coded-error message would misread that as a sign-in prompt.
      const isWrongCurrentPassword =
        error instanceof HTTPError && error.response.status === 401;
      notify(
        isWrongCurrentPassword
          ? t('security.currentPasswordIncorrect')
          : errorMessage(error, t('security.passwordUpdateFailed')),
        isWrongCurrentPassword ? 'warning' : 'error'
      );
      throw error;
    }
  };

  const handleAddPasskey = async () => {
    const passkeys = passkeysQuery.data ?? [];
    if (passkeys.length >= MAX_PASSKEYS) {
      notify(t('passkeys.limitReached', { max: MAX_PASSKEYS }), 'warning');
      return;
    }
    if (!profile) return;

    try {
      await addPasskey.mutateAsync({ username: profile.username });
      notify(t('passkeys.registered'), 'success');
    } catch (error) {
      notify(errorMessage(error, t('passkeys.registerFailed')), 'error');
    }
  };

  const handleDeletePasskey = async (id: string) => {
    const accepted = await confirm({
      title: t('passkeys.delete'),
      message: t('passkeys.deleteMessage'),
      confirmText: t('passkeys.delete'),
      severity: 'error',
    });
    if (!accepted) return;
    try {
      await deletePasskey.mutateAsync(id);
      notify(t('passkeys.deleted'), 'success');
    } catch (error) {
      notify(errorMessage(error, t('passkeys.deleteFailed')), 'error');
    }
  };

  const handleRenamePasskey = async (id: string, deviceName: string) => {
    try {
      await renamePasskey.mutateAsync({ id, deviceName });
      notify(t('passkeys.nameUpdated'), 'success');
    } catch (error) {
      notify(errorMessage(error, t('passkeys.nameUpdateFailed')), 'error');
    }
  };

  const handleRevokeSession = async (session: UserSessionInfo) => {
    const accepted = await confirm({
      title: t('devices.revokeTitle'),
      message: t('devices.revokeMessage'),
      confirmText: t('devices.revoke'),
      severity: 'warning',
    });
    if (!accepted) return;
    try {
      await revokeSession.mutateAsync(session.id);
      notify(t('devices.revoked'), 'success');
    } catch (error) {
      notify(errorMessage(error, t('devices.revokeFailed')), 'error');
    }
  };

  if (profileQuery.isPending) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        <LogoLoader variant="inline" size={48} />
      </Box>
    );
  }

  if (!profile) {
    return <Alert severity="error">{t('profile.loadFailed')}</Alert>;
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      {/* The phone top bar already names the page, so the heading is kept for
          screen readers only there. */}
      <Typography
        variant="h4"
        component="h1"
        sx={theme => ({
          fontWeight: 700,
          mb: 3,
          color: 'primary.main',
          [theme.breakpoints.down('sm')]: VISUALLY_HIDDEN,
        })}
      >
        {t('profile.title')}
      </Typography>

      <ProfileHeaderCard profile={profile} roles={roles} />

      <Stack
        component="nav"
        aria-label={t('common:actions.sections')}
        direction="row"
        spacing={1}
        sx={{
          display: { xs: 'flex', md: 'none' },
          mt: 2,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {SECTIONS.map(section => (
          <Chip
            key={section.id}
            label={section.label}
            variant="outlined"
            onClick={() => jumpTo(section.id)}
            sx={{ height: 44, borderRadius: 22, px: 0.5, flexShrink: 0, fontWeight: 600 }}
          />
        ))}
      </Stack>

      {/* One column on phones (account, security, devices); on desktop the
          account and device cards sit left and the security stack right. */}
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, md: 3 },
          mt: { xs: 2, md: 3 },
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          // The security stack spans both rows; `1fr` hands its extra height
          // to the second row so Devices sits right under Account details.
          gridTemplateRows: { md: 'auto 1fr' },
          gridTemplateAreas: {
            xs: '"account" "security" "devices"',
            md: '"account security" "devices security"',
          },
          alignItems: 'start',
          // Jump links land below the sticky top bar, not under it.
          '& > section': { scrollMarginTop: 80 },
        }}
      >
        <Box component="section" id="profile-account" sx={{ gridArea: 'account', minWidth: 0 }}>
          <ProfileTab
            profile={profile}
            editing={editing}
            onEditingChange={setEditing}
            onSave={handleSaveProfile}
            notify={notify}
          />
        </Box>

        <Box
          component="section"
          id="profile-security"
          aria-labelledby="profile-security-heading"
          sx={{ gridArea: 'security', minWidth: 0 }}
        >
          <Typography
            id="profile-security-heading"
            variant="overline"
            component="h2"
            sx={{ display: 'block', color: 'text.secondary', fontWeight: 700, lineHeight: 1.5, mb: 1, px: 0.5 }}
          >
            {t('profile.tabs.security')}
          </Typography>
          <Stack spacing={{ xs: 2, md: 3 }}>
            <SecurityTab onUpdatePassword={handleUpdatePassword} notify={notify} />
            <TwoFactorSetup />
            <PasskeysTab
              passkeys={passkeysQuery.data ?? []}
              onAdd={handleAddPasskey}
              onDelete={handleDeletePasskey}
              onRename={handleRenamePasskey}
              notify={notify}
            />
          </Stack>
        </Box>

        <Box component="section" id="profile-devices" sx={{ gridArea: 'devices', minWidth: 0 }}>
          <DevicesTab sessions={sessionsQuery.data ?? []} onRevoke={handleRevokeSession} />
        </Box>
      </Box>
    </Box>
  );
};

export default UserProfilePage;
