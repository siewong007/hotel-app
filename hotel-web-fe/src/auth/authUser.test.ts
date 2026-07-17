import { describe, expect, it } from 'vitest';
import { normalizeAuthUser, normalizeUserType } from './authUser';

describe('auth user normalization', () => {
  it.each([
    ['Guest', 'guest'],
    ['guest', 'guest'],
    ['Staff', 'admin'],
    ['staff', 'admin'],
    [undefined, 'admin'],
  ])('maps %s to %s', (value, expected) => {
    expect(normalizeUserType(value)).toBe(expected);
  });

  it('builds a complete user from a refreshed profile', () => {
    expect(normalizeAuthUser({ id: 22, username: 'guest', email: '', user_type: 'Guest' })).toMatchObject({
      id: 22,
      username: 'guest',
      user_type: 'guest',
      is_active: true,
    });
  });

  it('derives a guest account from roles when the API user omits user_type', () => {
    expect(normalizeAuthUser(
      { id: 1004, username: 'guest', email: 'guest@no-email.invalid' },
      ['guest'],
    )).toMatchObject({
      username: 'guest',
      user_type: 'guest',
    });
  });
});
