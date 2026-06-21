import { describe, expect, it } from 'vitest';
import { validateEkycCreateForm, type EkycCreateFormState } from './ekycCreateValidation';

const valid = (): EkycCreateFormState => ({
  guestId: 7,
  fullName: 'Jane Doe',
  dateOfBirth: '1990-05-01',
  idType: 'passport',
  idNumber: 'X1234567',
  idExpiryDate: '2999-01-01',
  hasIdFront: true,
  hasSelfie: true,
});

describe('validateEkycCreateForm', () => {
  it('passes a complete, valid form', () => {
    expect(validateEkycCreateForm(valid())).toBeNull();
  });

  it('requires a guest', () => {
    expect(validateEkycCreateForm({ ...valid(), guestId: null })).toMatch(/guest/i);
  });

  it('requires identity fields and documents', () => {
    expect(validateEkycCreateForm({ ...valid(), fullName: '  ' })).toMatch(/full name/i);
    expect(validateEkycCreateForm({ ...valid(), dateOfBirth: '' })).toMatch(/date of birth/i);
    expect(validateEkycCreateForm({ ...valid(), idType: '' })).toMatch(/id type/i);
    expect(validateEkycCreateForm({ ...valid(), idNumber: '' })).toMatch(/id number/i);
    expect(validateEkycCreateForm({ ...valid(), idExpiryDate: '' })).toMatch(/expiry/i);
    expect(validateEkycCreateForm({ ...valid(), hasIdFront: false })).toMatch(/front of the id/i);
    expect(validateEkycCreateForm({ ...valid(), hasSelfie: false })).toMatch(/selfie/i);
  });

  it('rejects an already-expired ID', () => {
    expect(validateEkycCreateForm({ ...valid(), idExpiryDate: '2000-01-01' })).toMatch(/future/i);
  });
});
