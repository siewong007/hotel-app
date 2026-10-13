import { describe, expect, it } from 'vitest';
import { GOOGLE_SIGN_IN_ONLY_MESSAGE, isGoogleSignInOnly } from './googleSignInOnly';

describe('isGoogleSignInOnly', () => {
  it('matches the backend refusal for passwordless accounts', () => {
    expect(isGoogleSignInOnly(new Error(GOOGLE_SIGN_IN_ONLY_MESSAGE))).toBe(true);
  });

  it('ignores other sign-in failures', () => {
    expect(isGoogleSignInOnly(new Error('Invalid credentials. 4 attempts remaining'))).toBe(false);
    expect(isGoogleSignInOnly(null)).toBe(false);
    expect(isGoogleSignInOnly('This account uses Google sign-in')).toBe(false);
  });
});
