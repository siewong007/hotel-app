import { HTTPError } from 'ky';
import { api, APIError } from './client';
import {
  UserProfile,
  UserProfileUpdate,
  PasswordUpdate,
  PasskeyInfo,
  PasskeyUpdateInput,
  AccessSnapshot,
  UserSessionInfo,
  AuthResponse,
} from '../types';

export class AuthService {
  // Registration & Verification
  static async register(data: {
    username: string;
    email?: string;
    password: string;
    first_name: string;
    last_name: string;
    phone: string;
    address_line1?: string;
  }): Promise<void> {
    try {
      await api.post('auth/register', { json: data });
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Registration failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Registration failed');
    }
  }

  // Google Guest Sign-In
  static async loginWithGoogle(credential: string): Promise<AuthResponse> {
    try {
      return await api.post('auth/google', { json: { credential } }).json<AuthResponse>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Google sign-in failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Google sign-in failed');
    }
  }

  static async completeGuestProfile(input: {
    first_name: string;
    last_name: string;
    phone: string;
    address_line1?: string;
  }): Promise<UserProfile> {
    try {
      return await api.post('profile/complete', { json: input }).json<UserProfile>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Profile completion failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Profile completion failed');
    }
  }

  static async verifyEmail(token: string): Promise<void> {
    try {
      await api.post('auth/verify-email', { json: { token } });
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Email verification failed',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Email verification failed');
    }
  }

  // Health & Status
  static async getHealth(): Promise<{ status: string }> {
    return await api.get('health').json<{ status: string }>();
  }

  static async getWebSocketStatus(): Promise<{ status: string; protocol: string; endpoint: string; message: string }> {
    return await api.get('ws/status').json<{ status: string; protocol: string; endpoint: string; message: string }>();
  }

  static async getAccessSnapshot(): Promise<AccessSnapshot> {
    return await api.get('auth/access').json<AccessSnapshot>();
  }

  // Passkey Management
  static async listPasskeys(): Promise<PasskeyInfo[]> {
    return await api.get('profile/passkeys').json<PasskeyInfo[]>();
  }

  static async updatePasskey(passkeyId: string, data: PasskeyUpdateInput): Promise<void> {
    await api.patch(`profile/passkeys/${passkeyId}`, { json: data });
  }

  static async deletePasskey(passkeyId: string): Promise<void> {
    await api.delete(`profile/passkeys/${passkeyId}`);
  }

  static async listSessions(): Promise<UserSessionInfo[]> {
    return await api.get('profile/sessions').json<UserSessionInfo[]>();
  }

  static async revokeSession(sessionId: string): Promise<void> {
    await api.delete(`profile/sessions/${sessionId}`);
  }

  // 2FA Management
  static async setupTwoFactor(): Promise<{
    secret: string;
    qr_code_url: string;
    challenge_code: string;
  }> {
    return await api.post('profile/2fa/setup', { json: {} }).json();
  }

  static async enableTwoFactor(
    code: string,
    challengeCode: string
  ): Promise<{ message: string; backup_codes: string[] }> {
    return await api
      .post('profile/2fa/enable', { json: { code, challenge_code: challengeCode } })
      .json();
  }

  static async disableTwoFactor(code: string): Promise<void> {
    await api.post('profile/2fa/disable', { json: { code } });
  }

  static async getTwoFactorStatus(): Promise<{ enabled: boolean; backup_codes_remaining: number }> {
    return await api.get('auth/2fa/status').json();
  }

  static async regenerateBackupCodes(code: string): Promise<{ backup_codes: string[] }> {
    return await api.post('auth/2fa/regenerate-backup-codes', { json: { code } }).json();
  }
}
