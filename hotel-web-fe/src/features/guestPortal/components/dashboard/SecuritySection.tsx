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
import { errorMessage } from '../../../../utils/errorMessage';
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

async function copyToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(successMessage, 'success');
  } catch {
    notify('Your browser would not let us copy that. Please select and copy it by hand.', 'warning');
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
  return (
    <Dialog open={codes.length > 0} maxWidth="sm" fullWidth>
      <DialogTitle>Save your recovery codes</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          These are the only way back into your account if you lose your phone. Each code works
          once, and we cannot show them again.
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
          onClick={() => void copyToClipboard(codes.join('\n'), 'Recovery codes copied')}
        >
          Copy all codes
        </Button>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          I have saved them
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
  const confirm = useConfirm();
  const { registerPasskey, user } = useAuth();
  const passkeysQuery = usePasskeysQuery();
  const addPasskey = useRegisterPasskeyMutation(registerPasskey);
  const deletePasskey = useDeletePasskeyMutation();
  const renamePasskey = useRenamePasskeyMutation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);

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
      notify('We could not read your account name. Please sign in again.', 'error');
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
      notify('Passkey added. You can now sign in with this device.', 'success');
    } catch (error) {
      setStepUpError(errorMessage(error, 'We could not add that passkey.'));
    }
  };

  const handleDelete = async (passkey: PasskeyInfo) => {
    const accepted = await confirm({
      title: 'Remove this passkey?',
      message: `You will no longer be able to sign in with ${passkey.device_name || 'this device'}. You can add it again at any time.`,
      confirmText: 'Remove passkey',
      severity: 'error',
    });
    if (!accepted) return;
    try {
      await deletePasskey.mutateAsync(passkey.id);
      notify('Passkey removed.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'We could not remove that passkey.'), 'error');
    }
  };

  const handleRename = async (id: string) => {
    const name = draftName.trim();
    if (!name) {
      notify('Please give this passkey a name.', 'warning');
      return;
    }
    try {
      await renamePasskey.mutateAsync({ id, deviceName: name });
      setEditingId(null);
      setDraftName('');
      notify('Passkey renamed.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'We could not rename that passkey.'), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<FingerprintOutlinedIcon />}
      title="Passkeys"
      description="Sign in with your fingerprint, face, or screen lock instead of a password."
      status={
        <Chip
          label={passkeys.length > 0 ? `${passkeys.length} saved` : 'None yet'}
          color={passkeys.length > 0 ? 'success' : 'default'}
          variant={passkeys.length > 0 ? 'filled' : 'outlined'}
        />
      }
    >
      {!browserSupported ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          This browser does not support passkeys. Open the portal in a recent version of Chrome,
          Safari, Edge or Firefox to add one.
        </Alert>
      ) : null}

      {passkeysQuery.isPending ? (
        <LoadingState label="Loading your passkeys…" />
      ) : passkeysQuery.isError ? (
        <ErrorState
          message="We could not load your passkeys."
          retry={() => void passkeysQuery.refetch()}
        />
      ) : passkeys.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', mb: 2 }}>
          You have not added a passkey yet. A passkey never leaves your device, so there is nothing
          for anyone else to steal or guess.
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
                      label="Passkey name"
                      placeholder="My iPhone"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                    <IconButton
                      aria-label="Save passkey name"
                      color="primary"
                      onClick={() => void handleRename(passkey.id)}
                    >
                      <CheckOutlinedIcon />
                    </IconButton>
                    <IconButton
                      aria-label="Cancel renaming"
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
                      primary={passkey.device_name || 'Unnamed device'}
                      secondary={
                        passkey.last_used_at
                          ? `Added ${formatPortalDate(passkey.created_at)} · last used ${formatPortalDate(passkey.last_used_at)}`
                          : `Added ${formatPortalDate(passkey.created_at)} · never used`
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
                        aria-label={`Rename ${passkey.device_name || 'passkey'}`}
                        onClick={() => {
                          setEditingId(passkey.id);
                          setDraftName(passkey.device_name || '');
                        }}
                      >
                        <EditOutlinedIcon />
                      </IconButton>
                      <IconButton
                        aria-label={`Remove ${passkey.device_name || 'passkey'}`}
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
          You have saved the maximum of {MAX_PASSKEYS} passkeys. Remove one to add another.
        </Alert>
      ) : null}

      <Button
        variant="contained"
        startIcon={<FingerprintOutlinedIcon />}
        disabled={atLimit || !browserSupported || addPasskey.isPending}
        onClick={handleAdd}
      >
        {addPasskey.isPending ? 'Waiting for your device…' : 'Add a passkey'}
      </Button>

      <Dialog open={stepUpOpen} onClose={closeStepUp} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm it is you</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            A passkey is a permanent way into your account, so we ask you to confirm before adding
            one.
          </Typography>
          {stepUpError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {stepUpError}
            </Alert>
          ) : null}
          <TextField
            fullWidth
            autoFocus
            type="password"
            label="Your password"
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
                or use a code from your authenticator app
              </Typography>
              <TextField
                fullWidth
                label="6-digit code"
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
          <Button onClick={closeStepUp}>Cancel</Button>
          <Button
            variant="contained"
            disabled={(!stepUpPassword && !stepUpCode) || addPasskey.isPending}
            onClick={() => void submitStepUp()}
          >
            {addPasskey.isPending ? 'Waiting for your device…' : 'Continue'}
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
      notify(errorMessage(error, 'We could not start the setup. Please try again.'), 'error');
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
      notify('Your authenticator app is now set up.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'That code did not match. Please try again.'), 'error');
    }
  };

  const handleDisable = async () => {
    try {
      await disableTwoFactor.mutateAsync(disableCode.trim());
      setDisableOpen(false);
      setDisableCode('');
      notify('Your authenticator app has been turned off.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'That code did not match. Please try again.'), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<PhonelinkLockOutlinedIcon />}
      title="Authenticator app"
      description="Ask for a 6-digit code from your phone whenever you sign in."
      status={
        <Chip
          label={enabled ? 'On' : 'Off'}
          color={enabled ? 'success' : 'default'}
          variant={enabled ? 'filled' : 'outlined'}
        />
      }
    >
      {enabled ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ color: 'text.secondary' }}>
            You are asked for a code from your authenticator app each time you sign in.
          </Typography>
          <Button color="error" variant="outlined" onClick={() => setDisableOpen(true)}>
            Turn off
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ color: 'text.secondary' }}>
            Use Google Authenticator, Authy, or any app that generates 6-digit codes. Setting this
            up also gives you a set of recovery codes.
          </Typography>
          <Button
            variant="contained"
            disabled={setupTwoFactor.isPending}
            onClick={() => void handleStartSetup()}
          >
            {setupTwoFactor.isPending ? 'Preparing…' : 'Set up authenticator app'}
          </Button>
        </Stack>
      )}

      <Dialog open={setupData !== null} onClose={closeSetup} maxWidth="sm" fullWidth>
        <DialogTitle>Set up your authenticator app</DialogTitle>
        <DialogContent>
          {setupData ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ mb: 2 }}>
                1. Open your authenticator app and scan this code.
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                {/* Rendered locally: the otpauth URI contains the shared secret
                    and must not be sent to a third-party QR service. */}
                <Box sx={{ border: '1px solid', borderColor: 'divider', lineHeight: 0 }}>
                  <QRCodeSVG
                    value={setupData.qr_code_url}
                    size={200}
                    marginSize={4}
                    title="Authenticator setup QR code"
                  />
                </Box>
              </Box>
              <Typography sx={{ mb: 1 }}>Or type this key in by hand:</Typography>
              <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontFamily: 'monospace', flexGrow: 1, wordBreak: 'break-all' }}>
                    {setupData.secret}
                  </Typography>
                  <IconButton
                    aria-label="Copy setup key"
                    size="small"
                    onClick={() => void copyToClipboard(setupData.secret, 'Setup key copied')}
                  >
                    <ContentCopyOutlinedIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Paper>
              <Typography sx={{ mb: 2 }}>
                2. Enter the {TOTP_CODE_LENGTH}-digit code your app shows.
              </Typography>
              <TextField
                fullWidth
                label="6-digit code"
                value={verificationCode}
                onChange={(event) =>
                  setVerificationCode(
                    event.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH),
                  )
                }
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: TOTP_CODE_LENGTH } }}
              />
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Your recovery codes are shown once, right after this step.
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSetup}>Cancel</Button>
          <Button
            variant="contained"
            disabled={verificationCode.length !== TOTP_CODE_LENGTH || enableTwoFactor.isPending}
            onClick={() => void handleEnable()}
          >
            {enableTwoFactor.isPending ? 'Checking…' : 'Turn on'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={disableOpen} onClose={() => setDisableOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Turn off your authenticator app?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Your account will be protected by your password alone. Your recovery codes stop working
            too.
          </Typography>
          <TextField
            fullWidth
            label="Code from your app, or a recovery code"
            value={disableCode}
            onChange={(event) => setDisableCode(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisableOpen(false)}>Keep it on</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!disableCode.trim() || disableTwoFactor.isPending}
            onClick={() => void handleDisable()}
          >
            {disableTwoFactor.isPending ? 'Checking…' : 'Turn off'}
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
  const regenerate = useRegenerateBackupCodes();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  const handleRegenerate = async () => {
    try {
      const result = await regenerate.mutateAsync(code.trim());
      setOpen(false);
      setCode('');
      onCodesIssued(result.backup_codes);
      notify('New recovery codes issued. Your old ones no longer work.', 'success');
    } catch (error) {
      notify(errorMessage(error, 'That code did not match. Please try again.'), 'error');
    }
  };

  return (
    <CredentialCard
      icon={<KeyOutlinedIcon />}
      title="Recovery codes"
      description="One-time codes that get you back in if you lose your phone."
      status={
        enabled ? (
          <Chip
            label={`${remaining} left`}
            color={remaining < LOW_RECOVERY_CODES ? 'warning' : 'success'}
            variant="filled"
          />
        ) : (
          <Chip label="Not set up" variant="outlined" />
        )
      }
    >
      {!enabled ? (
        <Typography sx={{ color: 'text.secondary' }}>
          You get a set of recovery codes when you set up an authenticator app above.
        </Typography>
      ) : (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          {remaining === 0 ? (
            <Alert severity="error" sx={{ width: '100%' }}>
              You have used every recovery code. Generate a new set now — without one, losing your
              phone means losing access to your account.
            </Alert>
          ) : remaining < LOW_RECOVERY_CODES ? (
            <Alert severity="warning" sx={{ width: '100%' }}>
              Only {remaining} recovery {remaining === 1 ? 'code' : 'codes'} left. Generating a new
              set is a good idea.
            </Alert>
          ) : null}
          {/* Which set these are. A guest with codes saved in two places needs
              to know whether the ones in front of them are the live set — the
              count alone cannot tell them that. `formatHotelDate` is used
              rather than the portal's date helper because this value is a
              zoned timestamp, not a business date. */}
          <Typography sx={{ color: 'text.secondary' }}>
            {generatedAt
              ? `This set was issued on ${formatHotelDate(generatedAt)}. Each code works once, and generating a new set replaces every code you have now.`
              : 'Each code works once. Generating a new set replaces every code you have now.'}
          </Typography>
          {enabled && !generatedAt ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              We no longer have a record of when this set was issued. If you are unsure the codes
              you saved are still the current ones, generate a new set.
            </Typography>
          ) : null}
          <Button variant="outlined" onClick={() => setOpen(true)}>
            Generate new codes
          </Button>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate new recovery codes?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Your current codes stop working straight away. Confirm with a code from your
            authenticator app.
          </Typography>
          <TextField
            fullWidth
            label="6-digit code"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH))
            }
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: TOTP_CODE_LENGTH } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={code.length !== TOTP_CODE_LENGTH || regenerate.isPending}
            onClick={() => void handleRegenerate()}
          >
            {regenerate.isPending ? 'Generating…' : 'Generate'}
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
  const statusQuery = useTwoFactorStatus();
  const [issuedCodes, setIssuedCodes] = useState<string[]>([]);

  const enabled = statusQuery.data?.enabled ?? false;
  const remaining = statusQuery.data?.backup_codes_remaining ?? 0;

  return (
    <Box>
      <SectionHeading
        eyebrow="Your account"
        title="Sign-in & security"
        description="Choose how you prove it is you: a passkey on your device, a code from an authenticator app, or a recovery code when neither is to hand."
      />

      <Stack spacing={3}>
        <PasskeysCard twoFactorEnabled={enabled} />

        {statusQuery.isPending ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={22} />
            <Typography sx={{ color: 'text.secondary' }}>
              Loading your security settings…
            </Typography>
          </Box>
        ) : statusQuery.isError ? (
          <ErrorState
            message="We could not load your two-factor settings."
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
