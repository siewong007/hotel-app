import { describe, expect, it } from 'vitest';
import {
  validateEmail,
  validatePhone,
  isValidEmail,
  isValidPhone,
  validatePassword,
  validatePasswordKey,
  PASSWORD_MAX_LENGTH,
} from './validation';

describe('validation utilities', () => {
  describe('validateEmail', () => {
    it('returns empty string for valid emails', () => {
      expect(validateEmail('user@example.com')).toBe('');
      expect(validateEmail('user.name+tag@example.co.uk')).toBe('');
    });

    it('returns error message for invalid emails', () => {
      expect(validateEmail('')).toBeTruthy();
      expect(validateEmail('not-an-email')).toBeTruthy();
      expect(validateEmail('@example.com')).toBeTruthy();
      expect(validateEmail('user@')).toBeTruthy();
    });
  });

  describe('isValidEmail', () => {
    it('returns true for valid emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('returns false for invalid emails', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('not-an-email')).toBe(false);
    });
  });

  describe('validatePhone', () => {
    it('returns empty string for valid phone numbers', () => {
      expect(validatePhone('+60123456789')).toBe('');
      expect(validatePhone('0123456789')).toBe('');
      expect(validatePhone('03-1234 5678')).toBe('');
    });

    it('returns error message for invalid phone numbers', () => {
      expect(validatePhone('')).toBeTruthy();
      expect(validatePhone('123')).toBeTruthy();
      expect(validatePhone('abc')).toBeTruthy();
    });
  });

  describe('isValidPhone', () => {
    it('returns true for valid phone numbers', () => {
      expect(isValidPhone('+60123456789')).toBe(true);
    });

    it('returns false for invalid phone numbers', () => {
      expect(isValidPhone('')).toBe(false);
    });
  });

  // Mirrors AuthService::validate_password (hotel-app-be/src/core/auth.rs) so
  // the profile form rejects weak passwords before the request is sent.
  describe('validatePasswordKey', () => {
    it('accepts a password that satisfies every rule', () => {
      expect(validatePasswordKey('Str0ng!Pass')).toBe('');
      expect(validatePasswordKey('xY9~long-enough')).toBe('');
    });

    it('flags each missing requirement with its own key', () => {
      expect(validatePasswordKey('Ab1!')).toBe('passwordTooShort');
      expect(validatePasswordKey(`${'aB1!'.repeat(40)}`)).toBe('passwordTooLong');
      expect(validatePasswordKey('abcdefg1!x')).toBe('passwordNeedsUppercase');
      expect(validatePasswordKey('ABCDEFG1!X')).toBe('passwordNeedsLowercase');
      expect(validatePasswordKey('Abcdefgh!x')).toBe('passwordNeedsDigit');
      expect(validatePasswordKey('Abcdefg12')).toBe('passwordNeedsSpecial');
    });

    it('flags passwords containing common weak substrings', () => {
      expect(validatePasswordKey('MyPassword1!x')).toBe('passwordTooCommon');
      expect(validatePasswordKey('qwerty123A!')).toBe('passwordTooCommon');
    });

    it('measures length in bytes, matching the backend', () => {
      const emojiPassword = `Ab1!${'🙂'.repeat(PASSWORD_MAX_LENGTH)}`;
      expect(validatePasswordKey(emojiPassword)).toBe('passwordTooLong');
    });
  });

  describe('validatePassword', () => {
    it('returns empty string for a valid password', () => {
      expect(validatePassword('Str0ng!Pass')).toBe('');
    });

    it('returns a localized message for invalid passwords', () => {
      expect(validatePassword('abcdefg1!x')).toBeTruthy();
      expect(validatePassword('short')).toBeTruthy();
    });
  });
});