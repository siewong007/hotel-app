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
