import { emitApiNotification } from '../../../utils/apiNotifications';

// Login accepts either an authenticator TOTP code or a 2FA recovery code in the
// same field, so the input has to tolerate both shapes.
export const TOTP_CODE_LENGTH = 6;
// XXXXX-XXXXX-XXXXX-XXXXX — uppercase hex in four groups of five.
export const RECOVERY_CODE_LENGTH = 23;
const MAX_CODE_LENGTH = 25;

/** Keeps only characters either code shape can contain, and uppercases hex so a
 *  pasted recovery code renders like the printed one (the backend compares
 *  case-insensitively either way). */
export function sanitizeTwoFactorCode(value: string): string {
  return value
    .replace(/[^0-9A-Fa-f-]/g, '')
    .toUpperCase()
    .slice(0, MAX_CODE_LENGTH);
}

export function isCompleteTwoFactorCode(code: string): boolean {
  return code.length === TOTP_CODE_LENGTH || code.length === RECOVERY_CODE_LENGTH;
}

/** A recovery code is spent once used, so say so and point at where to make more.
 *  Deferred a tick so the notification host has re-rendered with the now
 *  signed-in user and files the warning under their notification history rather
 *  than the signed-out scope. */
export function notifyRecoveryCodeUsed(remaining: number): void {
  setTimeout(() => {
    emitApiNotification({
      message:
        `Signed in with a recovery code. ${remaining} recovery code${remaining === 1 ? '' : 's'} ` +
        'remaining — regenerate them in Profile → Security.',
      severity: 'warning',
    });
  }, 0);
}
