import { HTTPError } from 'ky';
import { api, APIError } from './client';
import {
  UserProfile,
  UserProfileUpdate,
  PasswordUpdate,
  PasskeyInfo,
  PasskeyUpdateInput,
} from '../types';

export class AuthService {
  // Registration & Verification
  static async register(data: {
    username: string;
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    phone?: string
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

  // User Profile
  static async getUserProfile(): Promise<UserProfile> {
    return await api.get('profile').json<UserProfile>();
  }

  static async updateUserProfile(data: UserProfileUpdate): Promise<UserProfile> {
    return await api.patch('profile', { json: data }).json<UserProfile>();
  }

  static async updatePassword(data: PasswordUpdate): Promise<void> {
    await api.post('profile/password', { json: data });
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

  // 2FA Management
  static async setupTwoFactor(): Promise<{ secret: string; qr_code_url: string; backup_codes: string[] }> {
    return await api.post('profile/2fa/setup', { json: {} }).json();
  }

  static async enableTwoFactor(code: string): Promise<void> {
    await api.post('profile/2fa/enable', { json: { code } });
  }

  static async disableTwoFactor(code: string): Promise<void> {
    await api.post('profile/2fa/disable', { json: { code } });
  }

  static async getTwoFactorStatus(): Promise<{ enabled: boolean; backup_codes_remaining: number }> {
    return await api.get('auth/2fa/status').json();
  }

  static async regenerateBackupCodes(code: string): Promise<{ backup_codes: string[] }> {
    return await api.post('profile/2fa/regenerate-codes', { json: { code } }).json();
  }
}
