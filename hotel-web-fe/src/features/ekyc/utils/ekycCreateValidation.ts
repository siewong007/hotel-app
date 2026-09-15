// Pure validation for the admin "Create eKYC" dialog. One check list, two
// views (same pattern as `validateEmailKey`/`validateEmail`): the key form
// resolves through `t()` under `ekyc:create.validation.*`; the string form
// keeps returning English for tests and legacy callers.

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

export type EkycCreateValidationKey =
  | 'guest'
  | 'fullName'
  | 'dateOfBirth'
  | 'idType'
  | 'idNumber'
  | 'idExpiryDate'
  | 'idFront'
  | 'selfie'
  | 'expiryFuture'
  | null;

export function validateEkycCreateFormKey(form: EkycCreateFormState): EkycCreateValidationKey {
  if (!form.guestId) return 'guest';
  if (!form.fullName.trim()) return 'fullName';
  if (!form.dateOfBirth) return 'dateOfBirth';
  if (!form.idType.trim()) return 'idType';
  if (!form.idNumber.trim()) return 'idNumber';
  if (!form.idExpiryDate) return 'idExpiryDate';
  if (!form.hasIdFront) return 'idFront';
  if (!form.hasSelfie) return 'selfie';

  // ID must not already be expired.
  const expiry = new Date(form.idExpiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!Number.isNaN(expiry.getTime()) && expiry <= today) {
    return 'expiryFuture';
  }
  return null;
}

export function validateEkycCreateForm(form: EkycCreateFormState): string | null {
  switch (validateEkycCreateFormKey(form)) {
    case 'guest':
      return 'Select the guest this verification is for.';
    case 'fullName':
      return 'Full name is required.';
    case 'dateOfBirth':
      return 'Date of birth is required.';
    case 'idType':
      return 'ID type is required.';
    case 'idNumber':
      return 'ID number is required.';
    case 'idExpiryDate':
      return 'ID expiry date is required.';
    case 'idFront':
      return 'Upload the front of the ID document.';
    case 'selfie':
      return 'Upload a selfie photo.';
    case 'expiryFuture':
      return 'ID expiry date must be in the future.';
    default:
      return null;
  }
}
