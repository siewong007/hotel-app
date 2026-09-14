// Framework-free eKYC field rules, derived from EkycRegistrationPage.tsx
// (handleNext).
//
// NOTE: currently consumed ONLY by the guest-portal IdentitySection.
// EkycRegistrationPage.tsx has NOT been migrated onto it, so the two copies can
// still drift — migrating the page is the follow-up that makes this module
// actually shared rather than merely extracted.
//
// Pure TypeScript only: no React, no MUI, no network/localStorage access.

import { validateEmailKey } from '../../../utils/validation';

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

/**
 * guestPortal-bundle keys for the short label each field carries inside an
 * error message ("ID back photo is required."). IdentitySection resolves them
 * through `t()` — the keys mirror `dashboard.identity.errorLabels.*`.
 */
export const EKYC_FIELD_LABEL_KEYS: Record<string, string> = {
  fullName: 'dashboard.identity.errorLabels.fullName',
  dateOfBirth: 'dashboard.identity.errorLabels.dateOfBirth',
  nationality: 'dashboard.identity.errorLabels.nationality',
  phone: 'dashboard.identity.errorLabels.phone',
  email: 'dashboard.identity.errorLabels.email',
  currentAddress: 'dashboard.identity.errorLabels.currentAddress',
  idType: 'dashboard.identity.errorLabels.idType',
  idNumber: 'dashboard.identity.errorLabels.idNumber',
  idIssuingCountry: 'dashboard.identity.errorLabels.idIssuingCountry',
  idExpiryDate: 'dashboard.identity.errorLabels.idExpiryDate',
  idFront: 'dashboard.identity.errorLabels.idFront',
  idBack: 'dashboard.identity.errorLabels.idBack',
  selfie: 'dashboard.identity.errorLabels.selfie',
};

function labelKeyFor(field: string): string {
  return EKYC_FIELD_LABEL_KEYS[field] ?? '';
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
  /**
   * i18n key rather than rendered English — IdentitySection resolves it
   * through `t()` (same pattern as `validatePhoneKey`/`validateEmailKey`).
   * `key` is guestPortal-namespaced unless it carries an explicit `ns:` prefix;
   * `labelKey` is the `{{field}}` placeholder value for `required` errors.
   */
  key: string;
  labelKey?: string;
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
  const requiredKey = 'dashboard.identity.errors.required';

  for (const field of REQUIRED_PERSONAL_FIELDS) {
    if (!values[field] || !String(values[field]).trim()) {
      errors.push({ field, key: requiredKey, labelKey: labelKeyFor(field) });
    }
  }

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    if (!values[field] || !String(values[field]).trim()) {
      errors.push({ field, key: requiredKey, labelKey: labelKeyFor(field) });
    }
  }

  if (values.idExpiryDate && !isExpiryDateValid(values.idExpiryDate, today)) {
    errors.push({ field: 'idExpiryDate', key: 'dashboard.identity.errors.expiryFuture' });
  }

  // Format-check the email once it is non-empty. The backend only lowercases
  // it, and the portal form renders with `noValidate` (so the browser's
  // type="email" check never runs) — without this, "not-an-email" reaches the
  // compliance record unchallenged.
  if (values.email && values.email.trim()) {
    const emailKey = validateEmailKey(values.email);
    if (emailKey) {
      errors.push({ field: 'email', key: `auth:${emailKey}` });
    }
  }

  if (!values.idFront) {
    errors.push({ field: 'idFront', key: requiredKey, labelKey: labelKeyFor('idFront') });
  }
  if (!values.selfie) {
    errors.push({ field: 'selfie', key: requiredKey, labelKey: labelKeyFor('selfie') });
  }
  if (isIdBackRequired(values.idType) && !values.idBack) {
    errors.push({ field: 'idBack', key: requiredKey, labelKey: labelKeyFor('idBack') });
  }

  return errors;
}
