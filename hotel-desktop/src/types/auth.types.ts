// Authentication and User type definitions

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
  refresh_token: string;
  user: User;
  roles: string[];
  permissions: string[];
  is_first_login: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
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

// 2FA Types
export interface TwoFactorSetupRequest {
  username: string;
}

export interface TwoFactorSetupResponse {
  secret: string;
  qr_code_url: string;
  backup_codes: string[];
}

export interface TwoFactorEnableRequest {
  code: string;
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
