import { describe, expect, it } from 'vitest';
import { resolveIndexExperience } from './indexExperience';

describe('resolveIndexExperience', () => {
  it('always shows the Salim Inn model on the index route', () => {
    expect(resolveIndexExperience()).toBe('salim-inn-model');
  });
});
