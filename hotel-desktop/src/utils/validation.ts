export const validateEmail = (email: string): string => {
  if (!email || !email.trim()) {
    return 'Email is required';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return 'Please enter a valid email address';
  }

  return '';
};

export const validatePhone = (phone: string): string => {
  if (!phone || !phone.trim()) {
    return 'Phone number is required';
  }

  // Remove all non-digit characters for validation
  const digitsOnly = phone.replace(/\D/g, '');

  // Check if it has at least 10 digits (adjust based on your requirements)
  if (digitsOnly.length < 10) {
    return 'Phone number must be at least 10 digits';
  }

  if (digitsOnly.length > 15) {
    return 'Phone number cannot exceed 15 digits';
  }

  return '';
};

export const isValidEmail = (email: string): boolean => {
  return validateEmail(email) === '';
};

export const isValidPhone = (phone: string): boolean => {
  return validatePhone(phone) === '';
};
