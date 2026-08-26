import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from '../../../router';
import { Alert, Box, Card, CircularProgress, Tab, Tabs, Typography } from '@mui/material';
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

const TABS = [
  { label: 'Profile', icon: <PersonIcon /> },
  { label: 'Security', icon: <LockIcon /> },
  { label: 'Passkeys', icon: <FingerprintIcon /> },
  { label: '2FA', icon: <SecurityIcon /> },
  { label: 'Devices', icon: <LaptopIcon /> },
];

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const UserProfilePage: React.FC = () => {
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
          ? 'Email added. Verification is now pending.'
          : 'Profile updated successfully',
        'success'
      );
    } catch (error) {
      notify(errorMessage(error, 'Failed to update profile'), 'error');
    }
  };

  const handleUpdatePassword = async (data: {
    current_password: string;
    new_password: string;
  }) => {
    try {
      await updatePassword.mutateAsync(data);
      notify('Password updated successfully', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Failed to update password'), 'error');
      throw error;
    }
  };

  const handleAddPasskey = async () => {
    const passkeys = passkeysQuery.data ?? [];
    if (passkeys.length >= MAX_PASSKEYS) {
      notify(`Maximum of ${MAX_PASSKEYS} passkeys allowed`, 'warning');
      return;
    }
    if (!profile) return;

    try {
      await addPasskey.mutateAsync(profile.username);
      notify('Passkey registered successfully', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Failed to register passkey'), 'error');
    }
  };

  const handleDeletePasskey = async (id: string) => {
    const accepted = await confirm({
      title: 'Delete passkey',
      message: 'This passkey will stop working on the device it was created on. You can register a new one at any time.',
      confirmText: 'Delete passkey',
      severity: 'error',
    });
    if (!accepted) return;
    try {
      await deletePasskey.mutateAsync(id);
      notify('Passkey deleted successfully', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Failed to delete passkey'), 'error');
    }
  };

  const handleRenamePasskey = async (id: string, deviceName: string) => {
    try {
      await renamePasskey.mutateAsync({ id, deviceName });
      notify('Passkey name updated successfully', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Failed to update passkey name'), 'error');
    }
  };

  const handleRevokeSession = async (session: UserSessionInfo) => {
    const accepted = await confirm({
      title: 'Log out this device',
      message: 'The device will be signed out immediately and will need to sign in again.',
      confirmText: 'Log out device',
      severity: 'warning',
    });
    if (!accepted) return;
    try {
      await revokeSession.mutateAsync(session.id);
      notify('Device logged out successfully', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Failed to log out device'), 'error');
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
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (!profile) {
    return <Alert severity="error">Failed to load user profile. Please try again.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, mb: 3, color: 'primary.main' }}>
        User Profile
      </Typography>

      <Card sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
          {TABS.map(tab => (
            <Tab key={tab.label} label={tab.label} icon={tab.icon} iconPosition="start" />
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
