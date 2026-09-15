// Pure validation for the admin "Create eKYC" dialog. Returns the first
// human-readable error, or null when the form is ready to submit.

import { t } from '../../../i18n';

export interface EkycCreateFormState {
  guestId: number | null;
  fullName: string;
  dateOfBirth: string;
  idType: string;
  idNumber: string;
  idExpiryDate: string;
  hasIdFront: boolean;
  hasSelfie: boolean;
}

export function validateEkycCreateForm(form: EkycCreateFormState): string | null {
  if (!form.guestId) return t('ekyc:createDialog.errors.selectGuest');
  if (!form.fullName.trim()) return t('ekyc:createDialog.errors.fullNameRequired');
  if (!form.dateOfBirth) return t('ekyc:createDialog.errors.dateOfBirthRequired');
  if (!form.idType.trim()) return t('ekyc:createDialog.errors.idTypeRequired');
  if (!form.idNumber.trim()) return t('ekyc:createDialog.errors.idNumberRequired');
  if (!form.idExpiryDate) return t('ekyc:createDialog.errors.idExpiryRequired');
  if (!form.hasIdFront) return t('ekyc:createDialog.errors.idFrontRequired');
  if (!form.hasSelfie) return t('ekyc:createDialog.errors.selfieRequired');

  // ID must not already be expired.
  const expiry = new Date(form.idExpiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!Number.isNaN(expiry.getTime()) && expiry <= today) {
    return t('ekyc:createDialog.errors.expiryFuture');
  }
  return null;
}
