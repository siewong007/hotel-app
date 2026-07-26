import { api } from './client';
import {
  AssignRoleInput,
  PasswordUpdate,
  User,
  UserProfile,
  UserProfileUpdate,
  UserRoleIdsInput,
  UserWithRolesAndPermissions,
} from '../types';
import { withRetry } from '../utils/retry';

export interface CreateRbacUserInput {
  username: string;
  email: string;
  password: string;
  full_name?: string;
  phone?: string;
  role_ids?: number[];
}

export interface UpdateRbacUserInput {
  username?: string;
  email?: string;
  full_name?: string;
  phone?: string;
  is_active?: boolean;
  password?: string;
}

/**
 * The user domain: the signed-in user's own profile, plus administration of
 * other users and their role membership.
 *
 * Passkeys, sessions and 2FA remain in `AuthService` — they are credentials,
 * not user records.
 */
export class UsersService {
  // Current user's profile
  static async getUserProfile(): Promise<UserProfile> {
    return await api.get('profile').json<UserProfile>();
  }

  static async updateUserProfile(data: UserProfileUpdate): Promise<UserProfile> {
    return await api.patch('profile', { json: data }).json<UserProfile>();
  }

  static async updatePassword(data: PasswordUpdate): Promise<void> {
    await api.post('profile/password', { json: data });
  }

  // User administration
  static async getAllUsers(): Promise<User[]> {
    return await withRetry(
      () => api.get('users').json<User[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async createUser(userData: CreateRbacUserInput): Promise<User> {
    return await withRetry(
      () => api.post('users', { json: userData }).json<User>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async getUserRolesAndPermissions(userId: string): Promise<UserWithRolesAndPermissions> {
    return await withRetry(
      () => api.get(`users/${userId}`).json<UserWithRolesAndPermissions>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async updateUser(userId: string, userData: UpdateRbacUserInput): Promise<User> {
    return await withRetry(
      () => api.patch(`users/${userId}`, { json: userData }).json<User>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async deleteUser(userId: string): Promise<void> {
    await api.delete(`users/${userId}`);
  }

  // Role membership
  static async assignRoleToUser(assignData: AssignRoleInput): Promise<void> {
    await api.post('users/roles', { json: assignData });
  }

  static async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await api.delete(`users/${userId}/roles/${roleId}`);
  }

  static async replaceUserRoles(userId: string, input: UserRoleIdsInput): Promise<void> {
    await api.put(`users/${userId}/roles`, { json: input });
  }
}
