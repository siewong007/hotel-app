// Authentication and User type definitions
import type { RouteAccessPolicy } from './rbac.types';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  // refresh_token is intentionally omitted: it is delivered via an HttpOnly
  // cookie, not the JSON body, and is never readable by JS.
  user: User;
  roles: string[];
  permissions: string[];
  route_policies: RouteAccessPolicy[];
  is_first_login: boolean;
  // Present only when the login consumed a 2FA recovery code: how many remain
  // afterwards, so the client can prompt the user to regenerate them.
  recovery_codes_remaining?: number;
}

export interface AccessSnapshot {
  roles: string[];
  permissions: string[];
  route_policies: RouteAccessPolicy[];
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  email_configured: boolean;
  is_verified: boolean;
  user_type?: 'staff' | 'guest';
  full_name?: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface UserProfileUpdate {
  full_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
}

export interface PasswordUpdate {
  current_password: string;
  new_password: string;
}

export interface PasskeyInfo {
  id: string;
  credential_id: string;
  device_name?: string;
  created_at: string;
  last_used_at?: string;
}

export interface PasskeyUpdateInput {
  device_name: string;
}

export interface UserSessionInfo {
  id: string;
  user_agent?: string;
  ip_address?: string;
  created_at: string;
  last_used_at?: string;
  expires_at: string;
  is_current: boolean;
}

// 2FA Types
export interface TwoFactorSetupRequest {
  username: string;
}

export interface TwoFactorSetupResponse {
  secret: string;
  qr_code_url: string;
  challenge_code: string;
}

// Backup codes exist only in the enable response: setup does not persist any,
// so surfacing codes before enable would hand the user a dead set.
export interface TwoFactorEnableResponse {
  message: string;
  backup_codes: string[];
}

export interface TwoFactorEnableRequest {
  code: string;
  // Single-use challenge from TwoFactorSetupResponse; expires 10 minutes after setup.
  challenge_code: string;
}

export interface TwoFactorDisableRequest {
  code: string;
}

export interface TwoFactorVerifyRequest {
  code: string;
}

export interface TwoFactorStatusResponse {
  enabled: boolean;
  backup_codes_remaining: number;
}

export interface LoginWithTwoFactorRequest {
  username: string;
  password: string;
  code: string;
}

export interface RegenerateBackupCodesRequest {
  code: string;
}
