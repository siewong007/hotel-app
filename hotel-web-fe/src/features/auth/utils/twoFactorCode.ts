import { emitApiNotification } from '../../../utils/apiNotifications';

// Login accepts either an authenticator TOTP code or a 2FA recovery code in the
// same request field, but the sign-in form now asks which one the user is
// holding before it asks for the code. Each shape gets its own sanitiser and
// completeness rule so the input can reject the other shape's characters
// outright instead of accepting anything the backend might refuse.
export type TwoFactorMethod = 'totp' | 'recovery';

export const TOTP_CODE_LENGTH = 6;
// XXXXX-XXXXX-XXXXX-XXXXX — uppercase hex in four groups of five.
export const RECOVERY_CODE_LENGTH = 23;

/** Keeps only characters the chosen code shape can contain, and uppercases hex
 *  so a pasted recovery code renders like the printed one (the backend compares
 *  case-insensitively either way). */
export function sanitizeTwoFactorCode(value: string, method: TwoFactorMethod): string {
  if (method === 'totp') {
    return value.replace(/[^0-9]/g, '').slice(0, TOTP_CODE_LENGTH);
  }
  return value
    .replace(/[^0-9A-Fa-f-]/g, '')
    .toUpperCase()
    .slice(0, RECOVERY_CODE_LENGTH);
}

export function isCompleteTwoFactorCode(code: string, method: TwoFactorMethod): boolean {
  return code.length === (method === 'totp' ? TOTP_CODE_LENGTH : RECOVERY_CODE_LENGTH);
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
