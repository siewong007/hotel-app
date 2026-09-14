import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FingerprintOutlinedIcon from '@mui/icons-material/FingerprintOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import PhonelinkLockOutlinedIcon from '@mui/icons-material/PhonelinkLockOutlined';

import { useAuth } from '../../../../auth/AuthContext';
import { useConfirm } from '../../../../components/common/ConfirmProvider';
import type { PasskeyInfo } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { guestErrorMessage } from '../../utils/feedback';
import { useTranslation } from '../../../../i18n';
import {
  useDisableTwoFactor,
  useEnableTwoFactor,
  useRegenerateBackupCodes,
  useSetupTwoFactor,
  useTwoFactorStatus,
} from '../../../auth/hooks/useTwoFactorQueries';
import {
  useDeletePasskeyMutation,
  usePasskeysQuery,
  useRegisterPasskeyMutation,
  useRenamePasskeyMutation,
} from '../../../user/hooks/useProfileQueries';
import { formatHotelDate } from '../../../../utils/date';
import { ErrorState, LoadingState, SectionHeading } from './PortalDashboardSections';
import { formatPortalDate } from './dashboardUtils';
import { useAutoFocusError } from '../../../../hooks/useAutoFocusError';

const FOREST = 'var(--hotel-text)';
const GOLD_TEXT = 'var(--hotel-primary-text)';

/** Matches `services::passkey`, which refuses an eleventh passkey per user. */
export const MAX_PASSKEYS = 10;

/** Below this, the guest is one bad day away from being locked out. */
const LOW_RECOVERY_CODES = 3;

const TOTP_CODE_LENGTH = 6;

function notify(message: string, severity: 'success' | 'error' | 'warning' | 'info') {
  emitApiNotification({ message, severity });
}

async function copyToClipboard(text: string, successMessage: string, failureMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(successMessage, 'success');
  } catch {
    notify(failureMessage, 'warning');
  }
}

/** Whether this browser can create a passkey at all. */
function supportsPasskeys(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

function CredentialCard({
  icon,
  title,
  description,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Paper
      component="section"
      aria-label={title}
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--hotel-surface-raised)' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
          <Box sx={{ color: GOLD_TEXT, lineHeight: 0, mt: 0.25 }}>{icon}</Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h3" sx={{ color: FOREST, fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {description}
            </Typography>
          </Box>
        </Box>
        {status}
      </Box>
      <Divider sx={{ my: 2.5 }} />
      {children}
    </Paper>
  );
}

/**
 * One-time display of freshly minted recovery codes.
 *
 * The API returns each code in plaintext exactly once — at enable and at
 * regeneration — so this dialog has no "close without reading" affordance
 * beyond the explicit acknowledgement.
 */
function RecoveryCodesDialog({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation('guestPortal');
  return (
    <Dialog open={codes.length > 0} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dashboard.security.recoveryDialog.title')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          {t('dashboard.security.recoveryDialog.body')}
        </Typography>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'var(--hotel-warning-bg)' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 1,
            }}
          >
            {codes.map((code) => (
              <Typography key={code} sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {code}
              </Typography>
            ))}
          </Box>
        </Paper>
        <Button
          size="small"
          startIcon={<ContentCopyOutlinedIcon />}
          sx={{ mt: 2 }}
          onClick={() =>
            void copyToClipboard(
              codes.join('\n'),
              t('dashboard.security.recoveryDialog.copied'),
              t('dashboard.security.copyBlocked'),
            )
          }
        >
          {t('dashboard.security.recoveryDialog.copyAll')}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('dashboard.security.recoveryDialog.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Passkeys: the guest's phone or laptop unlock as a sign-in credential.
 *
 * Registration runs through `AuthContext.registerPasskey`, which owns the
 * WebAuthn ceremony and is shared with the staff profile page. The backend
 * names a new passkey by its creation date, so renaming is offered right in
 * the list rather than behind a separate screen.
 */
function PasskeysCard({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const { t } = useTranslation('guestPortal');
  const confirm = useConfirm();
  const { registerPasskey, user } = useAuth();
  // The card renders its own ErrorState + retry, so a failed load should not
  // ALSO raise the client's global toast.
  const passkeysQuery = usePasskeysQuery({ suppressApiNotification: true });
  const addPasskey = useRegisterPasskeyMutation(registerPasskey);
  const deletePasskey = useDeletePasskeyMutation();
  const renamePasskey = useRenamePasskeyMutation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const stepUpErrorRef = useAutoFocusError(stepUpError);

  const passkeys: PasskeyInfo[] = passkeysQuery.data ?? [];
  const atLimit = passkeys.length >= MAX_PASSKEYS;
  const browserSupported = supportsPasskeys();
  const username = user?.username ?? '';

  const closeStepUp = () => {
    setStepUpOpen(false);
    setStepUpPassword('');
    setStepUpCode('');
    setStepUpError(null);
  };

  const handleAdd = () => {
    if (!username) {
      notify(t('dashboard.security.passkeys.accountNameMissing'), 'error');
      return;
    }
    setStepUpError(null);
    setStepUpOpen(true);
  };

  /**
   * Runs the WebAuthn ceremony with the step-up secret the guest just supplied.
   *
   * The failure is shown inside the dialog rather than as a toast: a wrong
   * password is a retry, and the field to retry in is right here. The API
   * treats a passkey registration 401 as an auth-endpoint failure, so it does
   * not refresh-and-logout on a mistyped password.
   */
  const submitStepUp = async () => {
    setStepUpError(null);
    try {
      await addPasskey.mutateAsync({
        username,
        stepUp: { password: stepUpPassword || undefined, totpCode: stepUpCode || undefined },
      });
      closeStepUp();
      notify(t('dashboard.security.passkeys.added'), 'success');
    } catch (error) {
      setStepUpError(guestErrorMessage(error, t('dashboard.security.passkeys.addFailed')));
    }
  };

  const handleDelete = async (passkey: PasskeyInfo) => {
    const accepted = await confirm({
      title: t('dashboard.security.passkeys.confirmRemoveTitle'),
      message: t('dashboard.security.passkeys.confirmRemoveBody', {
        name: passkey.device_name || t('dashboard.security.passkeys.thisDevice'),
      }),
      confirmText: t('dashboard.security.passkeys.confirmRemoveButton'),
      cancelText: t('common:actions.cancel'),
      severity: 'error',
    });
    if (!accepted) return;
    try {
      await deletePasskey.mutateAsync(passkey.id);
      notify(t('dashboard.security.passkeys.removed'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.passkeys.removeFailed')), 'error');
    }
  };

  const handleRename = async (id: string) => {
    const name = draftName.trim();
    if (!name) {
      notify(t('dashboard.security.passkeys.nameRequired'), 'warning');
      return;
    }
    try {
      await renamePasskey.mutateAsync({ id, deviceName: name });
      setEditingId(null);
      setDraftName('');
      notify(t('dashboard.security.passkeys.renamed'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.passkeys.renameFailed')), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<FingerprintOutlinedIcon />}
      title={t('dashboard.security.passkeys.title')}
      description={t('dashboard.security.passkeys.description')}
      status={
        <Chip
          label={
            passkeys.length > 0
              ? t('dashboard.security.passkeys.saved', { count: passkeys.length })
              : t('dashboard.security.passkeys.none')
          }
          color={passkeys.length > 0 ? 'success' : 'default'}
          variant={passkeys.length > 0 ? 'filled' : 'outlined'}
        />
      }
    >
      {!browserSupported ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('dashboard.security.passkeys.unsupported')}
        </Alert>
      ) : null}

      {passkeysQuery.isPending ? (
        <LoadingState label={t('dashboard.security.passkeys.loading')} />
      ) : passkeysQuery.isError ? (
        <ErrorState
          message={t('dashboard.security.passkeys.loadFailed')}
          retry={() => void passkeysQuery.refetch()}
        />
      ) : passkeys.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', mb: 2 }}>
          {t('dashboard.security.passkeys.empty')}
        </Typography>
      ) : (
        <List disablePadding sx={{ mb: 2 }}>
          {passkeys.map((passkey, index) => {
            const isEditing = editingId === passkey.id;
            return (
              <ListItem
                key={passkey.id}
                divider={index < passkeys.length - 1}
                disableGutters
                sx={{ py: 1.5, gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}
              >
                {isEditing ? (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
                    <TextField
                      size="small"
                      autoFocus
                      fullWidth
                      label={t('dashboard.security.passkeys.nameLabel')}
                      placeholder={t('dashboard.security.passkeys.namePlaceholder')}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                    <IconButton
                      aria-label={t('dashboard.security.passkeys.saveNameAria')}
                      color="primary"
                      onClick={() => void handleRename(passkey.id)}
                    >
                      <CheckOutlinedIcon />
                    </IconButton>
                    <IconButton
                      aria-label={t('dashboard.security.passkeys.cancelRenameAria')}
                      onClick={() => {
                        setEditingId(null);
                        setDraftName('');
                      }}
                    >
                      <CancelOutlinedIcon />
                    </IconButton>
                  </Box>
                ) : (
                  <>
                    <ListItemText
                      primary={passkey.device_name || t('dashboard.security.passkeys.unnamed')}
                      secondary={
                        passkey.last_used_at
                          ? t('dashboard.security.passkeys.addedLastUsed', {
                              added: formatPortalDate(passkey.created_at),
                              used: formatPortalDate(passkey.last_used_at),
                            })
                          : t('dashboard.security.passkeys.addedNeverUsed', {
                              added: formatPortalDate(passkey.created_at),
                            })
                      }
                      sx={{ flex: '1 1 12rem', minWidth: 0, my: 0 }}
                      slotProps={{
                        primary: { sx: { fontWeight: 600, color: FOREST } },
                        secondary: { sx: { color: 'text.secondary' } },
                      }}
                    />
                    {/* In normal flow, not `secondaryAction`: that is absolutely
                        positioned, so a name that wraps on a phone runs under
                        the buttons. Here they wrap below it instead. */}
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, ml: 'auto' }}>
                      <IconButton
                        aria-label={t('dashboard.security.passkeys.renameAria', {
                          name: passkey.device_name || t('dashboard.security.passkeys.defaultName'),
                        })}
                        onClick={() => {
                          setEditingId(passkey.id);
                          setDraftName(passkey.device_name || '');
                        }}
                      >
                        <EditOutlinedIcon />
                      </IconButton>
                      <IconButton
                        aria-label={t('dashboard.security.passkeys.removeAria', {
                          name: passkey.device_name || t('dashboard.security.passkeys.defaultName'),
                        })}
                        color="error"
                        onClick={() => void handleDelete(passkey)}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Box>
                  </>
                )}
              </ListItem>
            );
          })}
        </List>
      )}

      {atLimit ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('dashboard.security.passkeys.atLimit', { max: MAX_PASSKEYS })}
        </Alert>
      ) : null}

      <Button
        variant="contained"
        startIcon={<FingerprintOutlinedIcon />}
        disabled={atLimit || !browserSupported || addPasskey.isPending}
        onClick={handleAdd}
      >
        {addPasskey.isPending
          ? t('dashboard.security.passkeys.waiting')
          : t('dashboard.security.passkeys.add')}
      </Button>

      <Dialog open={stepUpOpen} onClose={closeStepUp} maxWidth="xs" fullWidth>
        <DialogTitle>{t('dashboard.security.passkeys.stepUpTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('dashboard.security.passkeys.stepUpBody')}
          </Typography>
          {stepUpError ? (
            <Alert severity="error" role="alert" ref={stepUpErrorRef} tabIndex={-1} sx={{ mb: 2 }}>
              {stepUpError}
            </Alert>
          ) : null}
          <TextField
            fullWidth
            autoFocus
            type="password"
            label={t('dashboard.security.passkeys.passwordLabel')}
            autoComplete="current-password"
            value={stepUpPassword}
            onChange={(event) => setStepUpPassword(event.target.value)}
          />
          {/* Only when 2FA is on: `ensure_step_up` accepts a TOTP code as an
              alternative to the password, and a guest who signed in with Google
              may not have a password at all. */}
          {twoFactorEnabled ? (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary', my: 1.5 }}>
                {t('dashboard.security.passkeys.orAuthenticator')}
              </Typography>
              <TextField
                fullWidth
                label={t('dashboard.security.passkeys.codeLabel')}
                value={stepUpCode}
                onChange={(event) =>
                  setStepUpCode(event.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH))
                }
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: TOTP_CODE_LENGTH } }}
              />
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeStepUp}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={(!stepUpPassword && !stepUpCode) || addPasskey.isPending}
            onClick={() => void submitStepUp()}
          >
            {addPasskey.isPending
              ? t('dashboard.security.passkeys.waiting')
              : t('dashboard.security.passkeys.continue')}
          </Button>
        </DialogActions>
      </Dialog>
    </CredentialCard>
  );
}

/**
 * Authenticator app (TOTP) enrolment.
 *
 * The QR code is rendered locally on purpose: its `otpauth://` URI carries the
 * shared secret, which must never travel to a third-party QR service.
 */
function AuthenticatorCard({
  enabled,
  onCodesIssued,
}: {
  enabled: boolean;
  onCodesIssued: (codes: string[]) => void;
}) {
  const { t } = useTranslation('guestPortal');
  const setupTwoFactor = useSetupTwoFactor();
  const enableTwoFactor = useEnableTwoFactor();
  const disableTwoFactor = useDisableTwoFactor();

  const [setupData, setSetupData] = useState<{
    secret: string;
    qr_code_url: string;
    challenge_code: string;
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const closeSetup = () => {
    setSetupData(null);
    setVerificationCode('');
  };

  const handleStartSetup = async () => {
    try {
      setSetupData(await setupTwoFactor.mutateAsync());
      setVerificationCode('');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.authenticator.setupFailed')), 'error');
    }
  };

  const handleEnable = async () => {
    if (!setupData) return;
    try {
      const result = await enableTwoFactor.mutateAsync({
        code: verificationCode,
        challengeCode: setupData.challenge_code,
      });
      closeSetup();
      onCodesIssued(result.backup_codes);
      notify(t('dashboard.security.authenticator.enabled'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.authenticator.codeMismatch')), 'error');
    }
  };

  const handleDisable = async () => {
    try {
      await disableTwoFactor.mutateAsync(disableCode.trim());
      setDisableOpen(false);
      setDisableCode('');
      notify(t('dashboard.security.authenticator.disabled'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.authenticator.codeMismatch')), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<PhonelinkLockOutlinedIcon />}
      title={t('dashboard.security.authenticator.title')}
      description={t('dashboard.security.authenticator.description')}
      status={
        <Chip
          label={enabled ? t('dashboard.security.authenticator.on') : t('dashboard.security.authenticator.off')}
          color={enabled ? 'success' : 'default'}
          variant={enabled ? 'filled' : 'outlined'}
        />
      }
    >
      {enabled ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ color: 'text.secondary' }}>
            {t('dashboard.security.authenticator.enabledBody')}
          </Typography>
          <Button color="error" variant="outlined" onClick={() => setDisableOpen(true)}>
            {t('dashboard.security.authenticator.turnOff')}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ color: 'text.secondary' }}>
            {t('dashboard.security.authenticator.setupHint')}
          </Typography>
          <Button
            variant="contained"
            disabled={setupTwoFactor.isPending}
            onClick={() => void handleStartSetup()}
          >
            {setupTwoFactor.isPending
              ? t('dashboard.security.authenticator.preparing')
              : t('dashboard.security.authenticator.setup')}
          </Button>
        </Stack>
      )}

      <Dialog open={setupData !== null} onClose={closeSetup} maxWidth="sm" fullWidth>
        <DialogTitle>{t('dashboard.security.authenticator.setupTitle')}</DialogTitle>
        <DialogContent>
          {setupData ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ mb: 2 }}>
                {t('dashboard.security.authenticator.scanStep')}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                {/* Rendered locally: the otpauth URI contains the shared secret
                    and must not be sent to a third-party QR service. */}
                <Box sx={{ border: '1px solid', borderColor: 'divider', lineHeight: 0 }}>
                  <QRCodeSVG
                    value={setupData.qr_code_url}
                    size={200}
                    marginSize={4}
                    title={t('dashboard.security.authenticator.qrTitle')}
                  />
                </Box>
              </Box>
              <Typography sx={{ mb: 1 }}>{t('dashboard.security.authenticator.manualKey')}</Typography>
              <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontFamily: 'monospace', flexGrow: 1, wordBreak: 'break-all' }}>
                    {setupData.secret}
                  </Typography>
                  <IconButton
                    aria-label={t('dashboard.security.authenticator.copyKeyAria')}
                    size="small"
                    onClick={() =>
                      void copyToClipboard(
                        setupData.secret,
                        t('dashboard.security.authenticator.keyCopied'),
                        t('dashboard.security.copyBlocked'),
                      )
                    }
                  >
                    <ContentCopyOutlinedIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Paper>
              <Typography sx={{ mb: 2 }}>
                {t('dashboard.security.authenticator.codeStep', { count: TOTP_CODE_LENGTH })}
              </Typography>
              <TextField
                fullWidth
                label={t('dashboard.security.authenticator.codeLabel')}
                value={verificationCode}
                onChange={(event) =>
                  setVerificationCode(
                    event.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH),
                  )
                }
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: TOTP_CODE_LENGTH } }}
              />
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {t('dashboard.security.authenticator.recoveryNote')}
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSetup}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={verificationCode.length !== TOTP_CODE_LENGTH || enableTwoFactor.isPending}
            onClick={() => void handleEnable()}
          >
            {enableTwoFactor.isPending
              ? t('dashboard.security.authenticator.checking')
              : t('dashboard.security.authenticator.turnOn')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={disableOpen} onClose={() => setDisableOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('dashboard.security.authenticator.disableTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('dashboard.security.authenticator.disableBody')}
          </Typography>
          <TextField
            fullWidth
            label={t('dashboard.security.authenticator.disableCodeLabel')}
            value={disableCode}
            onChange={(event) => setDisableCode(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisableOpen(false)}>
            {t('dashboard.security.authenticator.keepOn')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!disableCode.trim() || disableTwoFactor.isPending}
            onClick={() => void handleDisable()}
          >
            {disableTwoFactor.isPending
              ? t('dashboard.security.authenticator.checking')
              : t('dashboard.security.authenticator.turnOff')}
          </Button>
        </DialogActions>
      </Dialog>
    </CredentialCard>
  );
}

/**
 * Recovery codes.
 *
 * They exist only alongside the authenticator app — the API mints them at
 * enable time and requires a live code to reissue them — so with the app off
 * this card explains where they come from rather than offering a dead button.
 */
function RecoveryCodesCard({
  enabled,
  remaining,
  generatedAt,
  onCodesIssued,
}: {
  enabled: boolean;
  remaining: number;
  generatedAt: string | null;
  onCodesIssued: (codes: string[]) => void;
}) {
  const { t } = useTranslation('guestPortal');
  const regenerate = useRegenerateBackupCodes();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  const handleRegenerate = async () => {
    try {
      const result = await regenerate.mutateAsync(code.trim());
      setOpen(false);
      setCode('');
      onCodesIssued(result.backup_codes);
      notify(t('dashboard.security.recovery.issued'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.security.recovery.codeMismatch')), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<KeyOutlinedIcon />}
      title={t('dashboard.security.recovery.title')}
      description={t('dashboard.security.recovery.description')}
      status={
        enabled ? (
          <Chip
            label={t('dashboard.security.recovery.left', { count: remaining })}
            color={remaining < LOW_RECOVERY_CODES ? 'warning' : 'success'}
            variant="filled"
          />
        ) : (
          <Chip label={t('dashboard.security.recovery.notSetUp')} variant="outlined" />
        )
      }
    >
      {!enabled ? (
        <Typography sx={{ color: 'text.secondary' }}>
          {t('dashboard.security.recovery.notEnabledBody')}
        </Typography>
      ) : (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          {remaining === 0 ? (
            <Alert severity="error" role="alert" sx={{ width: '100%' }}>
              {t('dashboard.security.recovery.allUsed')}
            </Alert>
          ) : remaining < LOW_RECOVERY_CODES ? (
            <Alert severity="warning" role="alert" sx={{ width: '100%' }}>
              {t('dashboard.security.recovery.low', { count: remaining })}
            </Alert>
          ) : null}
          {/* Which set these are. A guest with codes saved in two places needs
              to know whether the ones in front of them are the live set — the
              count alone cannot tell them that. `formatHotelDate` is used
              rather than the portal's date helper because this value is a
              zoned timestamp, not a business date. */}
          <Typography sx={{ color: 'text.secondary' }}>
            {generatedAt
              ? t('dashboard.security.recovery.issuedOn', { date: formatHotelDate(generatedAt) })
              : t('dashboard.security.recovery.issuedUnknown')}
          </Typography>
          {enabled && !generatedAt ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('dashboard.security.recovery.issueDateMissing')}
            </Typography>
          ) : null}
          <Button variant="outlined" onClick={() => setOpen(true)}>
            {t('dashboard.security.recovery.generate')}
          </Button>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('dashboard.security.recovery.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('dashboard.security.recovery.dialogBody')}
          </Typography>
          <TextField
            fullWidth
            label={t('dashboard.security.recovery.codeLabel')}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH))
            }
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: TOTP_CODE_LENGTH } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={code.length !== TOTP_CODE_LENGTH || regenerate.isPending}
            onClick={() => void handleRegenerate()}
          >
            {regenerate.isPending
              ? t('dashboard.security.recovery.generating')
              : t('dashboard.security.recovery.generateButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </CredentialCard>
  );
}

/**
 * The guest's sign-in credentials, in one place.
 *
 * Unlike every other portal section this one takes no portal token: passkeys
 * and two-factor settings belong to the guest's ACCOUNT, and their endpoints
 * (`/api/profile/*`, `/api/auth/2fa/*`) authenticate with the ordinary account
 * session that `AuthContext` already holds. The short-lived portal bearer
 * token is scoped to `/api/guest-portal/me*` and would not be accepted here.
 */
export function SecuritySection() {
  const { t } = useTranslation('guestPortal');
  // The section renders its own ErrorState + retry, so a failed load should
  // not ALSO raise the client's global toast.
  const statusQuery = useTwoFactorStatus({ suppressApiNotification: true });
  const [issuedCodes, setIssuedCodes] = useState<string[]>([]);

  const enabled = statusQuery.data?.enabled ?? false;
  const remaining = statusQuery.data?.backup_codes_remaining ?? 0;

  return (
    <Box>
      <SectionHeading
        eyebrow={t('dashboard.security.eyebrow')}
        title={t('dashboard.security.title')}
        description={t('dashboard.security.description')}
      />

      <Stack spacing={3}>
        <PasskeysCard twoFactorEnabled={enabled} />

        {statusQuery.isPending ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={22} />
            <Typography sx={{ color: 'text.secondary' }}>
              {t('dashboard.security.loading')}
            </Typography>
          </Box>
        ) : statusQuery.isError ? (
          <ErrorState
            message={t('dashboard.security.loadFailed')}
            retry={() => void statusQuery.refetch()}
          />
        ) : (
          <>
            <AuthenticatorCard enabled={enabled} onCodesIssued={setIssuedCodes} />
            <RecoveryCodesCard
              enabled={enabled}
              remaining={remaining}
              generatedAt={statusQuery.data?.backup_codes_generated_at ?? null}
              onCodesIssued={setIssuedCodes}
            />
          </>
        )}
      </Stack>

      <RecoveryCodesDialog codes={issuedCodes} onClose={() => setIssuedCodes([])} />
    </Box>
  );
}

export default SecuritySection;
