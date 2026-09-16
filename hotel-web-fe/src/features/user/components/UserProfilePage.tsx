import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from '../../../router';
import { Alert, Box, Card, Tab, Tabs, Typography } from '@mui/material';
import { LogoLoader } from '../../../components';
import {
  Fingerprint as FingerprintIcon,
  Laptop as LaptopIcon,
  Lock as LockIcon,
  Person as PersonIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
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
import TabPanel from './profile/TabPanel';
import ProfileTab from './profile/ProfileTab';
import SecurityTab from './profile/SecurityTab';
import PasskeysTab, { MAX_PASSKEYS } from './profile/PasskeysTab';
import DevicesTab from './profile/DevicesTab';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useTranslation } from '../../../i18n';

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const UserProfilePage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const { registerPasskey } = useAuth();

  const profileQuery = useProfileQuery();
  const passkeysQuery = usePasskeysQuery();
  const sessionsQuery = useSessionsQuery();

  const updateProfile = useUpdateProfileMutation();
  const updatePassword = useUpdatePasswordMutation();
  const deletePasskey = useDeletePasskeyMutation();
  const renamePasskey = useRenamePasskeyMutation();
  const addPasskey = useRegisterPasskeyMutation(registerPasskey);
  const revokeSession = useRevokeSessionMutation();

  // Labels resolve at render so the tab bar follows the active language.
  const TABS = [
    { id: 'profile', label: t('profile.tabs.profile'), icon: <PersonIcon /> },
    { id: 'security', label: t('profile.tabs.security'), icon: <LockIcon /> },
    { id: 'passkeys', label: t('profile.tabs.passkeys'), icon: <FingerprintIcon /> },
    { id: 'twoFactor', label: t('profile.tabs.twoFactor'), icon: <SecurityIcon /> },
    { id: 'devices', label: t('profile.tabs.devices'), icon: <LaptopIcon /> },
  ];

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
      notify(errorMessage(error, t('security.passwordUpdateFailed')), 'error');
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
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, mb: 3, color: 'primary.main' }}>
        {t('profile.title')}
      </Typography>

      <Card sx={{ mb: 3 }}>
        {/* Scrollable: the icon+label tabs need ~375px and the narrowest
            supported viewport is 320px. */}
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          {TABS.map(tab => (
            <Tab key={tab.id} label={tab.label} icon={tab.icon} iconPosition="start" />
          ))}
        </Tabs>
      </Card>

      <TabPanel value={activeTab} index={0}>
        <ProfileTab
          profile={profile}
          editing={editing}
          onEditingChange={setEditing}
          onSave={handleSaveProfile}
          notify={notify}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <SecurityTab onUpdatePassword={handleUpdatePassword} notify={notify} />
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <PasskeysTab
          passkeys={passkeysQuery.data ?? []}
          onAdd={handleAddPasskey}
          onDelete={handleDeletePasskey}
          onRename={handleRenamePasskey}
          notify={notify}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        <TwoFactorSetup />
      </TabPanel>

      <TabPanel value={activeTab} index={4}>
        <DevicesTab sessions={sessionsQuery.data ?? []} onRevoke={handleRevokeSession} />
      </TabPanel>
    </Box>
  );
};

export default UserProfilePage;
