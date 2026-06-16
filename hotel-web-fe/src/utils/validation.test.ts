import { describe, expect, it } from 'vitest';
import { validateEmail, validatePhone, isValidEmail, isValidPhone } from './validation';

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
});