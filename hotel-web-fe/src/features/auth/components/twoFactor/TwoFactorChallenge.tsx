import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  Fade,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Key as KeyIcon } from '@mui/icons-material';
import { useTranslation } from '../../../../i18n';
import { LanguageSwitcher } from '../../../../components/common/LanguageSwitcher';
import type { SecondFactorMethod } from '../../twoFactorChallenge';
import {
  BACKUP_CODE_LENGTH,
  BACKUP_CODE_PLACEHOLDER,
  formatBackupCode,
  isCompleteBackupCode,
  isCompleteTotpCode,
} from '../../utils/twoFactorCode';
import OtpCodeInput from './OtpCodeInput';
import { useKeyboardInset } from './useKeyboardInset';

export type TwoFactorView = 'methods' | 'backup';

export interface TwoFactorChallengeProps {
  /** What the account can finish with, from the `two_factor_required` answer. */
  methods: SecondFactorMethod[];
  view: TwoFactorView;
  /** A code check or passkey ceremony is in flight. */
  loading: boolean;
  /** Turnstile is on and its fresh token for this attempt is not ready yet. */
  awaitingTurnstile: boolean;
  turnstileEnabled: boolean;
  /** Callback ref for the Turnstile widget container (code views only). */
  turnstileRef: (node: HTMLDivElement | null) => void;
  error: string;
  errorRef: React.Ref<HTMLDivElement>;
  onDismissError: () => void;
  /** Bumped by the page after a rejected code: clears the input and refocuses it. */
  resetKey: number;
  onSubmitCode: (code: string) => void;
  onUsePasskey: () => void;
  onShowBackup: () => void;
  onShowMethods: () => void;
  /** Leave the second-factor step for the password form. */
  onCancel: () => void;
}

const ERROR_ID = 'two-factor-error';

/**
 * The sign-in second-factor step, loaded on demand (see LoginPage).
 *
 * The authenticator code and the passkey are the methods; an account with
 * both gets the code box with "use a passkey instead", one with only a passkey
 * gets the passkey as its primary action. Backup codes are deliberately not a
 * method: they sit behind a "lost access" link on their own view, because
 * each one is single-use and they are the last resort.
 *
 * Layout: a centred ~440px card on wider screens; on phones the card fills the
 * screen (safe areas respected) and the primary action is a sticky footer
 * kept above the on-screen keyboard.
 */
const TwoFactorChallenge: React.FC<TwoFactorChallengeProps> = ({
  methods,
  view,
  loading,
  awaitingTurnstile,
  turnstileEnabled,
  turnstileRef,
  error,
  errorRef,
  onDismissError,
  resetKey,
  onSubmitCode,
  onUsePasskey,
  onShowBackup,
  onShowMethods,
  onCancel,
}) => {
  const { t } = useTranslation('auth');
  const keyboardInset = useKeyboardInset();
  const hasTotp = methods.includes('totp');
  const hasPasskey = methods.includes('passkey');
  const hasBackupCodes = methods.includes('backup_code');

  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  // Auto-submit fires once per complete code; a code that arrives while the
  // Turnstile token is still being minted is held and sent the moment it is.
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const totpInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  // A rejected code clears the field and puts the cursor back, ready for the
  // next code from the app.
  // Only a new reset clears; switching views keeps what was typed.
  const handledResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === handledResetKey.current) {
      return;
    }
    handledResetKey.current = resetKey;
    setTotpCode('');
    setBackupCode('');
    setPendingCode(null);
    (view === 'backup' ? backupInputRef : totpInputRef).current?.focus();
  }, [resetKey, view]);

  useEffect(() => {
    if (pendingCode && !loading && !awaitingTurnstile) {
      setPendingCode(null);
      onSubmitCode(pendingCode);
    }
  }, [pendingCode, loading, awaitingTurnstile, onSubmitCode]);

  const handleTotpComplete = (code: string) => {
    if (!loading) {
      setPendingCode(code);
    }
  };

  const handleTotpSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isCompleteTotpCode(totpCode) && !loading) {
      setPendingCode(totpCode);
    }
  };

  const handleBackupSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isCompleteBackupCode(backupCode) && !loading && !awaitingTurnstile) {
      onSubmitCode(backupCode);
    }
  };

  const lostAccessLabel =
    hasTotp && hasPasskey
      ? t('twoFactor.lostAccessBoth')
      : hasPasskey
        ? t('twoFactor.lostAccessPasskey')
        : t('twoFactor.lostAccessTotp');

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={view === 'backup' ? onShowMethods : onCancel}
        sx={{ ml: -1, color: 'var(--hotel-text-secondary)' }}
      >
        {t('common.back')}
      </Button>
      <LanguageSwitcher color="default" size="small" />
    </Box>
  );

  const errorAlert = (
    <Collapse in={!!error}>
      <Alert
        id={ERROR_ID}
        severity="error"
        role="alert"
        ref={errorRef}
        tabIndex={-1}
        sx={{ mb: 2 }}
        onClose={onDismissError}
      >
        {error}
      </Alert>
    </Collapse>
  );

  const turnstileSlot = turnstileEnabled ? (
    <Box
      ref={turnstileRef}
      className="two-factor__turnstile"
      sx={{ display: 'flex', justifyContent: 'center', mt: 2, minHeight: 65 }}
    />
  ) : null;

  const spinnerOr = (label: string) =>
    loading ? <CircularProgress size={20} color="inherit" aria-label={t('twoFactor.verifying')} /> : label;

  const footer = (children: React.ReactNode) => (
    <Box
      className="two-factor__actions"
      style={{ ['--keyboard-inset' as string]: `${keyboardInset}px` }}
    >
      {children}
    </Box>
  );

  const linkSx = {
    p: 0.5,
    minHeight: 44,
    textTransform: 'none',
    fontWeight: 600,
    color: 'var(--hotel-primary-text)',
    justifyContent: 'flex-start',
    textAlign: 'left',
    '&:hover': { background: 'transparent', textDecoration: 'underline' },
  } as const;

  let body: React.ReactNode;
  if (view === 'backup') {
    body = (
      <form onSubmit={handleBackupSubmit} className="two-factor__form" noValidate>
        <Box className="two-factor__body">
          {hasBackupCodes ? (
            <TextField
              fullWidth
              label={t('twoFactor.backupLabel')}
              value={backupCode}
              onChange={(event) => setBackupCode(formatBackupCode(event.target.value))}
              placeholder={BACKUP_CODE_PLACEHOLDER}
              helperText={t('twoFactor.backupHelp')}
              autoFocus
              inputRef={backupInputRef}
              error={!!error}
              slotProps={{
                htmlInput: {
                  name: 'backup-code',
                  maxLength: BACKUP_CODE_LENGTH,
                  inputMode: 'text',
                  autoComplete: 'off',
                  autoCapitalize: 'characters',
                  autoCorrect: 'off',
                  spellCheck: false,
                  'aria-describedby': error ? ERROR_ID : undefined,
                  style: {
                    textAlign: 'center',
                    fontSize: '18px',
                    letterSpacing: '1px',
                    fontVariantNumeric: 'tabular-nums',
                  },
                },
              }}
            />
          ) : (
            <Alert severity="info">{t('twoFactor.backupUnavailable')}</Alert>
          )}
          {hasBackupCodes && turnstileSlot}
          <Typography variant="body2" sx={{ mt: 2.5, color: 'var(--hotel-text-secondary)' }}>
            {t('twoFactor.noBackupCodes')}
          </Typography>
          <Button startIcon={<ArrowBackIcon />} onClick={onShowMethods} sx={{ ...linkSx, mt: 1 }}>
            {t('twoFactor.backToOptions')}
          </Button>
        </Box>
        {hasBackupCodes &&
          footer(
            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading || awaitingTurnstile || !isCompleteBackupCode(backupCode)}
              sx={{ py: 1.5 }}
            >
              {spinnerOr(t('twoFactor.verify'))}
            </Button>
          )}
      </form>
    );
  } else if (hasTotp) {
    body = (
      <form onSubmit={handleTotpSubmit} className="two-factor__form" noValidate>
        <Box className="two-factor__body">
          <OtpCodeInput
            value={totpCode}
            onChange={setTotpCode}
            onComplete={handleTotpComplete}
            label={t('twoFactor.totpLabel')}
            helperText={t('twoFactor.totpHelp')}
            invalid={!!error}
            errorId={error ? ERROR_ID : undefined}
            disabled={loading}
            autoFocus
            inputRef={totpInputRef}
          />
          {turnstileSlot}
          {hasPasskey && (
            <>
              <Divider sx={{ my: 2.5, color: 'var(--hotel-text-secondary)' }}>
                {t('twoFactor.or')}
              </Divider>
              <Button
                fullWidth
                variant="outlined"
                size="large"
                startIcon={<KeyIcon />}
                onClick={onUsePasskey}
                disabled={loading}
                sx={{ py: 1.25 }}
              >
                {t('twoFactor.usePasskeyInstead')}
              </Button>
            </>
          )}
          <Button onClick={onShowBackup} sx={{ ...linkSx, mt: 2 }}>
            <span>
              {lostAccessLabel}{' '}
              <Box component="span" sx={{ textDecoration: 'underline' }}>
                {t('twoFactor.useBackupCode')}
              </Box>
            </span>
          </Button>
        </Box>
        {footer(
          <Button
            fullWidth
            type="submit"
            variant="contained"
            size="large"
            disabled={loading || awaitingTurnstile || !isCompleteTotpCode(totpCode)}
            sx={{ py: 1.5 }}
          >
            {spinnerOr(t('twoFactor.verify'))}
          </Button>
        )}
      </form>
    );
  } else {
    // Passkey only: the passkey is the primary action. No auto-prompt —
    // Safari only opens the WebAuthn sheet from a user gesture.
    body = (
      <Box className="two-factor__form">
        <Box className="two-factor__body">
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              py: 2,
              color: 'var(--hotel-primary-text)',
            }}
            aria-hidden="true"
          >
            <KeyIcon sx={{ fontSize: 56 }} />
          </Box>
          <Button onClick={onShowBackup} sx={{ ...linkSx, mt: 1 }}>
            <span>
              {lostAccessLabel}{' '}
              <Box component="span" sx={{ textDecoration: 'underline' }}>
                {t('twoFactor.useBackupCode')}
              </Box>
            </span>
          </Button>
        </Box>
        {footer(
          <Button
            fullWidth
            variant="contained"
            size="large"
            startIcon={loading ? undefined : <KeyIcon />}
            onClick={onUsePasskey}
            disabled={loading}
            sx={{ py: 1.5 }}
          >
            {loading ? (
              <CircularProgress size={20} color="inherit" aria-label={t('twoFactor.passkeyWaiting')} />
            ) : (
              t('twoFactor.usePasskey')
            )}
          </Button>
        )}
      </Box>
    );
  }

  const title = view === 'backup' ? t('twoFactor.backupTitle') : t('twoFactor.title');
  const subtitle =
    view === 'backup'
      ? t('twoFactor.backupSubtitle')
      : hasTotp
        ? t('twoFactor.totpSubtitle')
        : t('twoFactor.passkeySubtitle');

  return (
    <Box className="auth-page auth-page--2fa">
      <Container className="auth-container" maxWidth="sm">
        <Fade in timeout={200}>
          <Paper className="auth-card two-factor-card" sx={{ width: '100%' }}>
            {header}
            <Box className="auth-heading auth-heading--compact" sx={{ mb: { xs: 2.5, sm: 3 } }}>
              <Typography variant="h1">{title}</Typography>
              <Typography variant="body2" sx={{ mt: 1, color: 'var(--hotel-text-secondary)' }}>
                {subtitle}
              </Typography>
            </Box>
            {errorAlert}
            {/* Polite status for screen readers while a check runs. */}
            <Box role="status" aria-live="polite" className="visually-hidden" sx={visuallyHidden}>
              {loading ? t('twoFactor.verifying') : ''}
            </Box>
            {body}
          </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

export default TwoFactorChallenge;
