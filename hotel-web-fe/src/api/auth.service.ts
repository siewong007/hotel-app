import { api, toApiError } from './client';
import { SKIP_API_NOTIFICATION_HEADER } from '../utils/apiNotifications';
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
import type { ConsentAcceptance } from '../features/legal/useConsent';
import { t } from '../i18n';

/**
 * Per-call request options shared by the profile/security reads. Callers that
 * render a failure themselves (an inline error state with retry) opt out of
 * the client's global error toast; everyone else keeps it.
 */
export interface ApiRequestOptions {
  /** The caller renders this failure itself — skip the global toast. */
  suppressApiNotification?: boolean;
}

function apiRequestOptions(options?: ApiRequestOptions) {
  return options?.suppressApiNotification
    ? { headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' } }
    : undefined;
}

export class AuthService {
  /** First-step login: confirm username/email maps to an active account. */
  static async lookupLoginIdentifier(username: string): Promise<{ exists: boolean }> {
    try {
      return await api
        .post('auth/login/lookup', {
          json: { username },
          // LoginPage renders the failure inline; the global toast would duplicate it.
          headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
        })
        .json<{ exists: boolean }>();
    } catch (error) {
      throw toApiError(error, t('errors.verifyUsernameFailed', undefined, 'auth'));
    }
  }

  // Registration & Verification
  static async register(data: {
    username: string;
    email?: string;
    password: string;
    first_name: string;
    last_name: string;
    phone: string;
    address_line1?: string;
    /** PDPA consent taken on the form. The API rejects a registration whose
     *  Booking Terms or Privacy Notice consent is missing, refused, or pinned
     *  to a superseded version. */
    consents: ConsentAcceptance[];
    marketing_opt_in: boolean;
  }, turnstileToken?: string): Promise<void> {
    try {
      await api.post('auth/register', {
        json: data,
        headers: {
          // Cloudflare Turnstile token, when this build challenges.
          ...(turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {}),
          // RegisterPage renders the failure inline; the global toast would duplicate it.
          [SKIP_API_NOTIFICATION_HEADER]: 'true',
        },
      });
    } catch (error) {
      throw toApiError(error, t('errors.registrationFailed', undefined, 'auth'));
    }
  }

  // Google Guest Sign-In
  static async loginWithGoogle(
    credential: string,
    options?: { consents: ConsentAcceptance[]; marketing_opt_in: boolean },
  ): Promise<AuthResponse> {
    try {
      return await api
        .post('auth/google', {
          json: {
            credential,
            ...(options
              ? { consents: options.consents, marketing_opt_in: options.marketing_opt_in }
              : {}),
          },
          // Both callers (LoginPage's inline alert, useGoogleOneTap's own
          // translated toast) already surface the failure — the client's
          // global toast would be a second notification for one error.
          headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
        })
        .json<AuthResponse>();
    } catch (error) {
      throw toApiError(error, t('errors.googleSignInFailed', undefined, 'auth'));
    }
  }

  static async completeGuestProfile(input: {
    first_name: string;
    last_name: string;
    phone: string;
    address_line1?: string;
  }): Promise<UserProfile> {
    try {
      return await api
        .post('profile/complete', {
          json: input,
          // CompleteProfilePage renders the failure inline.
          headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
        })
        .json<UserProfile>();
    } catch (error) {
      throw toApiError(error, t('errors.profileCompletionFailed', undefined, 'auth'));
    }
  }

  static async verifyEmail(token: string): Promise<void> {
    try {
      await api.post('auth/verify-email', {
        json: { token },
        // EmailVerificationPage renders the failure as page-level state.
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      });
    } catch (error) {
      throw toApiError(error, t('errors.emailVerificationFailed', undefined, 'auth'));
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
  static async listPasskeys(options?: ApiRequestOptions): Promise<PasskeyInfo[]> {
    return await api.get('profile/passkeys', apiRequestOptions(options)).json<PasskeyInfo[]>();
  }

  static async updatePasskey(
    passkeyId: string,
    data: PasskeyUpdateInput,
    options?: ApiRequestOptions
  ): Promise<void> {
    await api.patch(`profile/passkeys/${passkeyId}`, { json: data, ...apiRequestOptions(options) });
  }

  static async deletePasskey(passkeyId: string, options?: ApiRequestOptions): Promise<void> {
    await api.delete(`profile/passkeys/${passkeyId}`, apiRequestOptions(options));
  }

  static async listSessions(options?: ApiRequestOptions): Promise<UserSessionInfo[]> {
    return await api.get('profile/sessions', apiRequestOptions(options)).json<UserSessionInfo[]>();
  }

  static async revokeSession(sessionId: string, options?: ApiRequestOptions): Promise<void> {
    await api.delete(`profile/sessions/${sessionId}`, apiRequestOptions(options));
  }

  // 2FA Management
  static async setupTwoFactor(options?: ApiRequestOptions): Promise<{
    secret: string;
    qr_code_url: string;
    challenge_code: string;
  }> {
    return await api.post('profile/2fa/setup', { json: {}, ...apiRequestOptions(options) }).json();
  }

  static async enableTwoFactor(
    code: string,
    challengeCode: string,
    options?: ApiRequestOptions
  ): Promise<{ message: string; backup_codes: string[] }> {
    return await api
      .post('profile/2fa/enable', {
        json: { code, challenge_code: challengeCode },
        ...apiRequestOptions(options),
      })
      .json();
  }

  static async disableTwoFactor(code: string, options?: ApiRequestOptions): Promise<void> {
    await api.post('profile/2fa/disable', { json: { code }, ...apiRequestOptions(options) });
  }

  static async getTwoFactorStatus(options?: ApiRequestOptions): Promise<{
    enabled: boolean;
    backup_codes_remaining: number;
    /** When the current set of recovery codes was issued. Null when 2FA is
     *  off, or when the issuing event has aged out of the audit partitions. */
    backup_codes_generated_at?: string | null;
  }> {
    return await api.get('auth/2fa/status', apiRequestOptions(options)).json();
  }

  static async regenerateBackupCodes(
    code: string,
    options?: ApiRequestOptions
  ): Promise<{ backup_codes: string[] }> {
    return await api
      .post('auth/2fa/regenerate-backup-codes', { json: { code }, ...apiRequestOptions(options) })
      .json();
  }
}
