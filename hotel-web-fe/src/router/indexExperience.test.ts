import { describe, expect, it } from 'vitest';
import { resolveIndexExperience } from './indexExperience';

describe('resolveIndexExperience', () => {
  it('shows the Salim Inn model to signed-out visitors', () => {
    expect(resolveIndexExperience(false, undefined)).toBe('salim-inn-model');
  });

  it('keeps the Salim Inn model as the guest home', () => {
    expect(resolveIndexExperience(true, 'guest')).toBe('salim-inn-model');
  });

  it('opens the operational dashboard for authenticated staff', () => {
    expect(resolveIndexExperience(true, 'admin')).toBe('staff-dashboard');
  });
});
