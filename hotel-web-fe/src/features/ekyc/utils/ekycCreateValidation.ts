// Pure validation for the admin "Create eKYC" dialog. Returns the first
// human-readable error, or null when the form is ready to submit.

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
  if (!form.guestId) return 'Select the guest this verification is for.';
  if (!form.fullName.trim()) return 'Full name is required.';
  if (!form.dateOfBirth) return 'Date of birth is required.';
  if (!form.idType.trim()) return 'ID type is required.';
  if (!form.idNumber.trim()) return 'ID number is required.';
  if (!form.idExpiryDate) return 'ID expiry date is required.';
  if (!form.hasIdFront) return 'Upload the front of the ID document.';
  if (!form.hasSelfie) return 'Upload a selfie photo.';

  // ID must not already be expired.
  const expiry = new Date(form.idExpiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!Number.isNaN(expiry.getTime()) && expiry <= today) {
    return 'ID expiry date must be in the future.';
  }
  return null;
}
