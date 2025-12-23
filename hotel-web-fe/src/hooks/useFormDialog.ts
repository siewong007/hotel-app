import { useState } from 'react';

interface UseFormDialogReturn<T> {
  open: boolean;
  formData: T;
  openDialog: (initialData?: Partial<T>) => void;
  closeDialog: () => void;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  setFormData: (data: T) => void;
  resetForm: () => void;
}

/**
 * Generic hook for managing dialog forms
 *
 * Eliminates boilerplate for form dialog state management.
 *
 * @example
 * const {
 *   open,
 *   formData,
 *   openDialog,
 *   closeDialog,
 *   updateField,
 *   resetForm
 * } = useFormDialog<BookingData>({
 *   guestId: 0,
 *   roomId: 0,
 *   checkIn: '',
 *   checkOut: '',
 * });
 */
export function useFormDialog<T extends object>(
  initialFormState: T
): UseFormDialogReturn<T> {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<T>(initialFormState);

  const openDialog = (initialData?: Partial<T>) => {
    if (initialData) {
      setFormData({ ...initialFormState, ...initialData });
    }
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setFormData(initialFormState);
  };

  const updateField = <K extends keyof T>(field: K, value: T[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => setFormData(initialFormState);

  return {
    open,
    formData,
    openDialog,
    closeDialog,
    updateField,
    setFormData,
    resetForm,
  };
}
