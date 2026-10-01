/**
 * Stable translation keys for each failure below. `validateEmailKey` /
 * `validatePhoneKey` return the `validation.*` keys (auth bundle) for callers
 * that render their own copy; `validateEmail` / `validatePhone` resolve the
 * same keys through `t()` so every caller gets the active locale. One check
 * list, two views — a rule change here cannot drift between them.
 */

import { t } from '../i18n';
export type EmailValidationKey =
  | 'validation.emailRequired'
  | 'validation.emailInvalid'
  | '';

export type PhoneValidationKey =
  | 'validation.phoneRequired'
  | 'validation.phoneTooShort'
  | 'validation.phoneTooLong'
  | '';

export const validateEmailKey = (email: string): EmailValidationKey => {
  if (!email || !email.trim()) {
    return 'validation.emailRequired';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return 'validation.emailInvalid';
  }

  return '';
};

export const validateEmail = (email: string): string => {
  switch (validateEmailKey(email)) {
    case 'validation.emailRequired':
      return t('auth:validation.emailRequired');
    case 'validation.emailInvalid':
      return t('auth:validation.emailInvalid');
    default:
      return '';
  }
};

export const validatePhoneKey = (phone: string): PhoneValidationKey => {
  if (!phone || !phone.trim()) {
    return 'validation.phoneRequired';
  }

  // Remove all non-digit characters for validation
  const digitsOnly = phone.replace(/\D/g, '');

  // Check if it has at least 10 digits (adjust based on your requirements)
  if (digitsOnly.length < 10) {
    return 'validation.phoneTooShort';
  }

  if (digitsOnly.length > 15) {
    return 'validation.phoneTooLong';
  }

  return '';
};

export const validatePhone = (phone: string): string => {
  switch (validatePhoneKey(phone)) {
    case 'validation.phoneRequired':
      return t('auth:validation.phoneRequired');
    case 'validation.phoneTooShort':
      return t('auth:validation.phoneTooShort');
    case 'validation.phoneTooLong':
      return t('auth:validation.phoneTooLong');
    default:
      return '';
  }
};

export const isValidEmail = (email: string): boolean => {
  return validateEmail(email) === '';
};

export const isValidPhone = (phone: string): boolean => {
  return validatePhone(phone) === '';
};

// Password policy — mirrors AuthService::validate_password in
// hotel-app-be/src/core/auth.rs so the form rejects with a specific,
// localized message instead of round-tripping a generic 400.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const PASSWORD_SPECIAL_RE = /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\';/~`]/;
const WEAK_PASSWORD_PARTS = [
  'password',
  'password123',
  '12345678',
  'qwerty123',
  'abc123456',
  'password1',
  'welcome123',
  'admin123',
  'letmein123',
  'monkey123',
];

export type PasswordValidationKey =
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'passwordNeedsUppercase'
  | 'passwordNeedsLowercase'
  | 'passwordNeedsDigit'
  | 'passwordNeedsSpecial'
  | 'passwordTooCommon'
  | '';

export const validatePasswordKey = (password: string): PasswordValidationKey => {
  // The backend measures bytes (Rust String::len); match it so a multibyte
  // password cannot pass here and fail there.
  const byteLength = new TextEncoder().encode(password).length;
  if (byteLength < PASSWORD_MIN_LENGTH) return 'passwordTooShort';
  if (byteLength > PASSWORD_MAX_LENGTH) return 'passwordTooLong';
  if (!/[A-Z]/.test(password)) return 'passwordNeedsUppercase';
  if (!/[a-z]/.test(password)) return 'passwordNeedsLowercase';
  if (!/\d/.test(password)) return 'passwordNeedsDigit';
  if (!PASSWORD_SPECIAL_RE.test(password)) return 'passwordNeedsSpecial';
  const lower = password.toLowerCase();
  if (WEAK_PASSWORD_PARTS.some(part => lower.includes(part))) {
    return 'passwordTooCommon';
  }
  return '';
};

export const validatePassword = (password: string): string => {
  const key = validatePasswordKey(password);
  if (!key) return '';
  return t(`validation:${key}`, {
    min: PASSWORD_MIN_LENGTH,
    max: PASSWORD_MAX_LENGTH,
  });
};
