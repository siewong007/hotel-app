import { t } from '../../../i18n';
import { emitApiNotification } from '../../../utils/apiNotifications';

// Login accepts an authenticator TOTP code or a 2FA backup code in the same
// request field. The sign-in page shows the authenticator (and passkey) as the
// methods to use and keeps backup codes behind a "lost access" link, so each
// shape gets its own sanitiser and completeness rule: each input rejects the
// other shape's characters outright instead of accepting anything the backend
// might refuse.
export type TwoFactorCodeKind = 'totp' | 'backup';

export const TOTP_CODE_LENGTH = 6;
// XXXXX-XXXXX-XXXXX-XXXXX — uppercase hex in four groups of five.
const BACKUP_CODE_GROUP = 5;
const BACKUP_CODE_GROUPS = 4;
const BACKUP_CODE_CHARS = BACKUP_CODE_GROUP * BACKUP_CODE_GROUPS;
export const BACKUP_CODE_LENGTH = BACKUP_CODE_CHARS + BACKUP_CODE_GROUPS - 1;
export const BACKUP_CODE_PLACEHOLDER = 'XXXXX-XXXXX-XXXXX-XXXXX';

/** Digits only, capped at six — what an authenticator code can contain. A
 *  pasted "123 456" or "123-456" lands as "123456". */
export function sanitizeTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH);
}

/** Keeps only hex, uppercases it so a pasted code renders like the printed one
 *  (the backend compares case-insensitively either way), and inserts the group
 *  dashes itself — so a code typed or pasted without them, with spaces, or
 *  with them, all come out in the printed shape. */
export function formatBackupCode(value: string): string {
  const hex = value
    .replace(/[^0-9A-Fa-f]/g, '')
    .toUpperCase()
    .slice(0, BACKUP_CODE_CHARS);
  const groups: string[] = [];
  for (let start = 0; start < hex.length; start += BACKUP_CODE_GROUP) {
    groups.push(hex.slice(start, start + BACKUP_CODE_GROUP));
  }
  return groups.join('-');
}

export function isCompleteTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function isCompleteBackupCode(code: string): boolean {
  return code.length === BACKUP_CODE_LENGTH;
}

/** A backup code is spent once used, so say so and point at where to make
 *  more — the staff profile or the guest portal, depending on who signed in.
 *  Deferred a tick so the notification host has re-rendered with the now
 *  signed-in user and files the warning under their notification history rather
 *  than the signed-out scope. */
export function notifyBackupCodeUsed(remaining: number, isGuest: boolean): void {
  setTimeout(() => {
    emitApiNotification({
      message: t(
        isGuest ? 'twoFactor.backupUsedGuest' : 'twoFactor.backupUsedStaff',
        { count: remaining },
        'auth'
      ),
      severity: 'warning',
    });
  }, 0);
}
