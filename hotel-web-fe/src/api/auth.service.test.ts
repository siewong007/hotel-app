import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { AuthService } from './auth.service';
import { APIError } from './client';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/**
 * Unlike register/verifyEmail (which just `await api.post(...)` with no
 * `.json()` chain), loginWithGoogle/completeGuestProfile chain `.json<T>()`
 * onto the post() call. A bare `Promise.reject(...)` has no `.json` method,
 * so simulating an HTTPError on those methods needs the rejection to come
 * from the chained `.json()` call instead.
 */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

/** Build a ky HTTPError the way a real failed request would throw it. */
function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/auth/register') {
  const response = new Response(JSON.stringify(body), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
  const request = new Request(url, { method: 'POST' });
  return new HTTPError(response, request, {} as any);
}

describe('AuthService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    del.mockReset();
  });

  describe('register', () => {
    it('posts the registration payload as json to auth/register', async () => {
      const data = {
        username: 'newuser',
        password: 'hunter22',
        first_name: 'New',
        last_name: 'User',
        phone: '0123456789',
      };
      post.mockReturnValue(Promise.resolve(undefined));

      await AuthService.register(data);

      expect(post).toHaveBeenCalledWith('auth/register', { json: data });
    });

    it('wraps an HTTPError response into an APIError with the server message', async () => {
      post.mockReturnValue(Promise.reject(buildHttpError(409, { error: 'Username already taken' })));

      await expect(
        AuthService.register({
          username: 'dupe',
          password: 'hunter22',
          first_name: 'New',
          last_name: 'User',
          phone: '0123456789',
        }),
      ).rejects.toMatchObject({
        name: 'APIError',
        message: 'Username already taken',
        statusCode: 409,
      });
    });

    it('falls back to a generic message when the error is not an HTTPError', async () => {
      post.mockReturnValue(Promise.reject(new Error('network down')));

      await expect(
        AuthService.register({
          username: 'x',
          password: 'hunter22',
          first_name: 'X',
          last_name: 'Y',
          phone: '0123456789',
        }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Registration failed' });
    });
  });

  describe('loginWithGoogle', () => {
    it('posts the credential as json to auth/google', async () => {
      const authResponse = {
        access_token: 'tok_abc',
        user: { id: '1', username: 'guest@example.com', email: 'guest@example.com', is_active: true, created_at: 'x', updated_at: 'x' },
        roles: ['guest'],
        permissions: [],
        route_policies: [],
        is_first_login: true,
        profile_complete: false,
        missing_profile_fields: ['first_name', 'last_name', 'phone'],
      };
      post.mockReturnValue(mockJsonResponse(authResponse));

      const result = await AuthService.loginWithGoogle('google-id-token');

      expect(post).toHaveBeenCalledWith('auth/google', { json: { credential: 'google-id-token' } });
      expect(result).toEqual(authResponse);
    });

    it('wraps an HTTPError into an APIError with the server message (e.g. 503 when unconfigured)', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(503, { error: 'Google sign-in is not configured' })));

      let caught: unknown;
      try {
        await AuthService.loginWithGoogle('google-id-token');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIError);
      expect(caught).toMatchObject({ message: 'Google sign-in is not configured', statusCode: 503 });
    });
  });

  describe('completeGuestProfile', () => {
    it('posts the profile fields as json to profile/complete', async () => {
      const input = { first_name: 'New', last_name: 'Guest', phone: '0123456789' };
      const profile = {
        id: 1,
        username: 'guest@example.com',
        email: 'guest@example.com',
        email_configured: true,
        is_verified: true,
        created_at: 'x',
        updated_at: 'x',
        profile_complete: true,
        missing_profile_fields: [],
      };
      post.mockReturnValue(mockJsonResponse(profile));

      const result = await AuthService.completeGuestProfile(input);

      expect(post).toHaveBeenCalledWith('profile/complete', { json: input });
      expect(result).toEqual(profile);
    });

    it('wraps an HTTPError into an APIError with the server message', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(400, { error: 'Invalid phone number' })));

      await expect(
        AuthService.completeGuestProfile({ first_name: 'A', last_name: 'B', phone: 'bad' }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Invalid phone number', statusCode: 400 });
    });
  });

  describe('verifyEmail', () => {
    it('posts the token as json to auth/verify-email', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await AuthService.verifyEmail('tok_123');

      expect(post).toHaveBeenCalledWith('auth/verify-email', { json: { token: 'tok_123' } });
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(Promise.reject(buildHttpError(400, { error: 'Invalid or expired token' })));

      let caught: unknown;
      try {
        await AuthService.verifyEmail('bad-token');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIError);
      expect(caught).toMatchObject({ message: 'Invalid or expired token', statusCode: 400 });
    });
  });

  describe('getHealth', () => {
    it('calls GET health', async () => {
      get.mockReturnValue(mockJsonResponse({ status: 'ok' }));

      const result = await AuthService.getHealth();

      expect(get).toHaveBeenCalledWith('health');
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('getWebSocketStatus', () => {
    it('calls GET ws/status', async () => {
      const status = { status: 'ok', protocol: 'wss', endpoint: '/ws', message: 'ready' };
      get.mockReturnValue(mockJsonResponse(status));

      const result = await AuthService.getWebSocketStatus();

      expect(get).toHaveBeenCalledWith('ws/status');
      expect(result).toEqual(status);
    });
  });

  describe('getAccessSnapshot', () => {
    it('calls GET auth/access', async () => {
      const snapshot = { roles: ['admin'], permissions: ['bookings:manage'], route_policies: [] };
      get.mockReturnValue(mockJsonResponse(snapshot));

      const result = await AuthService.getAccessSnapshot();

      expect(get).toHaveBeenCalledWith('auth/access');
      expect(result).toEqual(snapshot);
    });
  });

  describe('listPasskeys', () => {
    it('calls GET profile/passkeys', async () => {
      const passkeys = [{ id: '1', credential_id: 'cred', created_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(passkeys));

      const result = await AuthService.listPasskeys();

      expect(get).toHaveBeenCalledWith('profile/passkeys');
      expect(result).toEqual(passkeys);
    });
  });

  describe('updatePasskey', () => {
    it('patches profile/passkeys/<id> with the input as json', async () => {
      patch.mockReturnValue(Promise.resolve(undefined));

      await AuthService.updatePasskey('pk1', { device_name: 'iPhone' });

      expect(patch).toHaveBeenCalledWith('profile/passkeys/pk1', { json: { device_name: 'iPhone' } });
    });
  });

  describe('deletePasskey', () => {
    it('calls DELETE profile/passkeys/<id>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AuthService.deletePasskey('pk1');

      expect(del).toHaveBeenCalledWith('profile/passkeys/pk1');
    });
  });

  describe('listSessions', () => {
    it('calls GET profile/sessions', async () => {
      const sessions = [{ id: 's1', created_at: 'x', expires_at: 'y', is_current: true }];
      get.mockReturnValue(mockJsonResponse(sessions));

      const result = await AuthService.listSessions();

      expect(get).toHaveBeenCalledWith('profile/sessions');
      expect(result).toEqual(sessions);
    });
  });

  describe('revokeSession', () => {
    it('calls DELETE profile/sessions/<id>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AuthService.revokeSession('s1');

      expect(del).toHaveBeenCalledWith('profile/sessions/s1');
    });
  });

  describe('setupTwoFactor', () => {
    it('posts an empty json body to profile/2fa/setup', async () => {
      const setup = {
        secret: 'abc',
        qr_code_url: 'data:...',
        challenge_code: 'c'.repeat(64),
      };
      post.mockReturnValue(mockJsonResponse(setup));

      const result = await AuthService.setupTwoFactor();

      expect(post).toHaveBeenCalledWith('profile/2fa/setup', { json: {} });
      expect(result).toEqual(setup);
    });
  });

  describe('enableTwoFactor', () => {
    it('posts the code and setup challenge, returning the minted backup codes', async () => {
      const enable = { message: '2FA enabled successfully', backup_codes: ['a-b', 'c-d'] };
      post.mockReturnValue(mockJsonResponse(enable));

      const challenge = 'c'.repeat(64);
      const result = await AuthService.enableTwoFactor('123456', challenge);

      expect(post).toHaveBeenCalledWith('profile/2fa/enable', {
        json: { code: '123456', challenge_code: challenge },
      });
      expect(result).toEqual(enable);
    });
  });

  describe('disableTwoFactor', () => {
    it('posts the code as json to profile/2fa/disable', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await AuthService.disableTwoFactor('123456');

      expect(post).toHaveBeenCalledWith('profile/2fa/disable', { json: { code: '123456' } });
    });
  });

  describe('getTwoFactorStatus', () => {
    it('calls GET auth/2fa/status', async () => {
      const status = { enabled: true, backup_codes_remaining: 5 };
      get.mockReturnValue(mockJsonResponse(status));

      const result = await AuthService.getTwoFactorStatus();

      expect(get).toHaveBeenCalledWith('auth/2fa/status');
      expect(result).toEqual(status);
    });
  });

  describe('regenerateBackupCodes', () => {
    it('posts the code as json to auth/2fa/regenerate-backup-codes', async () => {
      const codes = { backup_codes: ['a', 'b'] };
      post.mockReturnValue(mockJsonResponse(codes));

      const result = await AuthService.regenerateBackupCodes('123456');

      expect(post).toHaveBeenCalledWith('auth/2fa/regenerate-backup-codes', { json: { code: '123456' } });
      expect(result).toEqual(codes);
    });
  });
});
