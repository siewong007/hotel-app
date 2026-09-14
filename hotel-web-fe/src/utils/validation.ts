/**
 * Stable translation keys for each failure below. Guest-facing pages resolve
 * them through `t()` (the `validation.*` group in the auth bundle); the
 * `validateEmail`/`validatePhone` helpers keep returning English text for the
 * staff-facing callers that predate the i18n pass. One check list, two views —
 * a rule change here cannot drift between them.
 */
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
      return 'Email is required';
    case 'validation.emailInvalid':
      return 'Please enter a valid email address';
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
      return 'Phone number is required';
    case 'validation.phoneTooShort':
      return 'Phone number must be at least 10 digits';
    case 'validation.phoneTooLong':
      return 'Phone number cannot exceed 15 digits';
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
