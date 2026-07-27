import { describe, expect, it } from 'vitest';
import {
  isIdBackRequired,
  isExpiryDateValid,
  validateEkycFields,
  type EkycFieldValues,
} from './ekycFieldRules';

const valid = (): EkycFieldValues => ({
  fullName: 'Jane Doe',
  dateOfBirth: '1990-05-01',
  nationality: 'Singapore',
  phone: '+65 9123 4567',
  email: 'jane@example.com',
  currentAddress: '1 Marina Blvd',
  idType: 'passport',
  idNumber: 'X1234567',
  idIssuingCountry: 'Singapore',
  idExpiryDate: '2999-01-01',
  idFront: 'data:image/jpeg;base64,abc',
  idBack: null,
  selfie: 'data:image/jpeg;base64,abc',
});

describe('isIdBackRequired', () => {
  it('is not required for a passport', () => {
    expect(isIdBackRequired('passport')).toBe(false);
  });

  it('is required for every other id type', () => {
    expect(isIdBackRequired('drivers_license')).toBe(true);
    expect(isIdBackRequired('national_id')).toBe(true);
    expect(isIdBackRequired('')).toBe(true);
  });
});

describe('isExpiryDateValid', () => {
  it('rejects a date in the past', () => {
    expect(isExpiryDateValid('2000-01-01')).toBe(false);
  });

  it('accepts a date in the future', () => {
    expect(isExpiryDateValid('2999-01-01')).toBe(true);
  });

  it('rejects an empty or unparsable value', () => {
    expect(isExpiryDateValid('')).toBe(false);
    expect(isExpiryDateValid('not-a-date')).toBe(false);
  });

  it('compares against a supplied reference instant', () => {
    const reference = new Date('2020-06-15T00:00:00Z');
    expect(isExpiryDateValid('2020-06-16', reference)).toBe(true);
    expect(isExpiryDateValid('2020-06-01', reference)).toBe(false);
  });
});

describe('validateEkycFields', () => {
  it('passes a complete, valid form with no id_back for a passport', () => {
    expect(validateEkycFields(valid())).toEqual([]);
  });

  it('requires id_back when the id type is not passport', () => {
    const errors = validateEkycFields({ ...valid(), idType: 'national_id', idBack: null });
    expect(errors).toContainEqual({ field: 'idBack', message: expect.stringMatching(/back/i) });
  });

  it('does not require id_back for a passport', () => {
    const errors = validateEkycFields({ ...valid(), idType: 'passport', idBack: null });
    expect(errors.some((e) => e.field === 'idBack')).toBe(false);
  });

  it('rejects an expiry date in the past', () => {
    const errors = validateEkycFields({ ...valid(), idExpiryDate: '2000-01-01' });
    expect(errors).toContainEqual({
      field: 'idExpiryDate',
      message: expect.stringMatching(/future/i),
    });
  });

  it('accepts an expiry date in the future', () => {
    const errors = validateEkycFields({ ...valid(), idExpiryDate: '2999-01-01' });
    expect(errors.some((e) => e.field === 'idExpiryDate')).toBe(false);
  });

  it('reports every missing required field', () => {
    const errors = validateEkycFields({
      ...valid(),
      fullName: '',
      dateOfBirth: '',
      nationality: '',
      phone: '',
      email: '',
      currentAddress: '',
      idType: '',
      idNumber: '',
      idIssuingCountry: '',
      idExpiryDate: '',
      idFront: null,
      selfie: null,
    });

    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'fullName',
        'dateOfBirth',
        'nationality',
        'phone',
        'email',
        'currentAddress',
        'idType',
        'idNumber',
        'idIssuingCountry',
        'idExpiryDate',
        'idFront',
        'selfie',
      ]),
    );
    // Empty idType is not 'passport', so id_back is also required here.
    expect(fields).toContain('idBack');
  });
});

describe('email format', () => {
  const base = {
    fullName: 'A', dateOfBirth: '1990-01-01', nationality: 'MY',
    phone: '123', email: 'a@b.com', currentAddress: 'X',
    idType: 'passport', idNumber: 'X1', idIssuingCountry: 'MY',
    idExpiryDate: '2030-01-01',
    idFront: 'p/front.jpg', idBack: null, selfie: 'p/selfie.jpg',
  };

  it('rejects a malformed email', () => {
    const errors = validateEkycFields({ ...base, email: 'not-an-email' });
    expect(errors.some((e) => e.field === 'email')).toBe(true);
  });

  it('accepts a well-formed email', () => {
    const errors = validateEkycFields({ ...base, email: 'guest@example.com' });
    expect(errors.some((e) => e.field === 'email')).toBe(false);
  });
});
