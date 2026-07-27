// Framework-free eKYC field rules, derived from EkycRegistrationPage.tsx
// (handleNext).
//
// NOTE: currently consumed ONLY by the guest-portal IdentitySection.
// EkycRegistrationPage.tsx has NOT been migrated onto it, so the two copies can
// still drift — migrating the page is the follow-up that makes this module
// actually shared rather than merely extracted.
//
// Pure TypeScript only: no React, no MUI, no network/localStorage access.

import { validateEmail } from '../../../utils/validation';

export interface EkycPersonalFields {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
  email: string;
  currentAddress: string;
}

export interface EkycDocumentFields {
  idType: string;
  idNumber: string;
  idIssuingCountry: string;
  idExpiryDate: string;
}

export interface EkycUploadFields {
  idFront: string | null;
  idBack: string | null;
  selfie: string | null;
}

export type EkycFieldValues = EkycPersonalFields & EkycDocumentFields & EkycUploadFields;

export const REQUIRED_PERSONAL_FIELDS: (keyof EkycPersonalFields)[] = [
  'fullName',
  'dateOfBirth',
  'nationality',
  'phone',
  'email',
  'currentAddress',
];

export const REQUIRED_DOCUMENT_FIELDS: (keyof EkycDocumentFields)[] = [
  'idType',
  'idNumber',
  'idIssuingCountry',
  'idExpiryDate',
];

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  dateOfBirth: 'Date of birth',
  nationality: 'Nationality',
  phone: 'Phone number',
  email: 'Email',
  currentAddress: 'Current address',
  idType: 'ID type',
  idNumber: 'ID number',
  idIssuingCountry: 'ID issuing country',
  idExpiryDate: 'ID expiry date',
  idFront: 'ID front photo',
  idBack: 'ID back photo',
  selfie: 'Selfie photo',
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Every ID type except passport requires a photo of the back of the document. */
export function isIdBackRequired(idType: string): boolean {
  return idType !== 'passport';
}

/**
 * Mirrors EkycRegistrationPage.tsx handleNext: an expiry date is valid only
 * when it parses to a real date AND is strictly after the reference instant
 * (defaults to now) — i.e. `new Date(idExpiryDate) <= new Date()` is rejected.
 */
export function isExpiryDateValid(value: string, today: Date = new Date()): boolean {
  if (!value) return false;
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry > today;
}

export interface EkycFieldError {
  field: string;
  message: string;
}

/**
 * Aggregate validation across the whole eKYC form (personal info, document
 * details, and required uploads). Returns one entry per violated rule; an
 * empty array means the form is ready to submit.
 */
export function validateEkycFields(
  values: EkycFieldValues,
  today: Date = new Date(),
): EkycFieldError[] {
  const errors: EkycFieldError[] = [];

  for (const field of REQUIRED_PERSONAL_FIELDS) {
    if (!values[field] || !String(values[field]).trim()) {
      errors.push({ field, message: `${labelFor(field)} is required.` });
    }
  }

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    if (!values[field] || !String(values[field]).trim()) {
      errors.push({ field, message: `${labelFor(field)} is required.` });
    }
  }

  if (values.idExpiryDate && !isExpiryDateValid(values.idExpiryDate, today)) {
    errors.push({ field: 'idExpiryDate', message: 'ID expiry date must be in the future.' });
  }

  // Format-check the email once it is non-empty. The backend only lowercases
  // it, and the portal form renders with `noValidate` (so the browser's
  // type="email" check never runs) — without this, "not-an-email" reaches the
  // compliance record unchallenged.
  if (values.email && values.email.trim()) {
    const emailError = validateEmail(values.email);
    if (emailError) {
      errors.push({ field: 'email', message: emailError });
    }
  }

  if (!values.idFront) {
    errors.push({ field: 'idFront', message: `${labelFor('idFront')} is required.` });
  }
  if (!values.selfie) {
    errors.push({ field: 'selfie', message: `${labelFor('selfie')} is required.` });
  }
  if (isIdBackRequired(values.idType) && !values.idBack) {
    errors.push({ field: 'idBack', message: `${labelFor('idBack')} is required.` });
  }

  return errors;
}
