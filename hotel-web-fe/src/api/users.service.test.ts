import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { UsersService } from './users.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('UsersService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    patch.mockReset();
    del.mockReset();
  });

  describe('getUserProfile', () => {
    it('calls GET profile', async () => {
      const profile = { id: 1, username: 'admin', email: 'a@b.com', email_configured: true, is_verified: true, created_at: 'x', updated_at: 'x' };
      get.mockReturnValue(mockJsonResponse(profile));

      const result = await UsersService.getUserProfile();

      expect(get).toHaveBeenCalledWith('profile');
      expect(result).toEqual(profile);
    });
  });

  describe('updateUserProfile', () => {
    it('patches profile with the input as json', async () => {
      const input = { full_name: 'New Name' };
      const updated = { id: 1, username: 'admin', email: 'a@b.com', email_configured: true, is_verified: true, full_name: 'New Name', created_at: 'x', updated_at: 'x' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await UsersService.updateUserProfile(input);

      expect(patch).toHaveBeenCalledWith('profile', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('updatePassword', () => {
    it('posts the password payload as json to profile/password', async () => {
      const input = { current_password: 'old', new_password: 'newpass1' };
      post.mockReturnValue(Promise.resolve(undefined));

      await UsersService.updatePassword(input);

      expect(post).toHaveBeenCalledWith('profile/password', { json: input });
    });
  });

  describe('assignRoleToUser', () => {
    it('posts the assignment as json to users/roles', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await UsersService.assignRoleToUser({ user_id: '1', role_id: 2 });

      expect(post).toHaveBeenCalledWith('users/roles', { json: { user_id: '1', role_id: 2 } });
    });
  });

  describe('removeRoleFromUser', () => {
    it('calls DELETE users/<userId>/roles/<roleId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await UsersService.removeRoleFromUser('1', '2');

      expect(del).toHaveBeenCalledWith('users/1/roles/2');
    });
  });

  describe('replaceUserRoles', () => {
    it('puts the role id list as json to users/<userId>/roles', async () => {
      put.mockReturnValue(Promise.resolve(undefined));

      await UsersService.replaceUserRoles('1', { role_ids: [2, 3] });

      expect(put).toHaveBeenCalledWith('users/1/roles', { json: { role_ids: [2, 3] } });
    });
  });

  describe('getAllUsers', () => {
    it('calls GET users', async () => {
      const users = [{ id: '1', username: 'admin', email: 'a@b.com', is_active: true, created_at: 'x', updated_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(users));

      const result = await UsersService.getAllUsers();

      expect(get).toHaveBeenCalledWith('users');
      expect(result).toEqual(users);
    });
  });

  describe('createUser', () => {
    it('posts the user input as json to users', async () => {
      const input = { username: 'newstaff', email: 'staff@example.com', password: 'hunter22' };
      const created = { id: '2', username: 'newstaff', email: 'staff@example.com', is_active: true, created_at: 'x', updated_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await UsersService.createUser(input);

      expect(post).toHaveBeenCalledWith('users', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('getUserRolesAndPermissions', () => {
    it('calls GET users/<userId>', async () => {
      const response = { user: { id: '2', username: 'newstaff', email: 'x', is_active: true, created_at: 'x', updated_at: 'x' }, roles: [], permissions: [] };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await UsersService.getUserRolesAndPermissions('2');

      expect(get).toHaveBeenCalledWith('users/2');
      expect(result).toEqual(response);
    });
  });

  describe('updateUser', () => {
    it('patches users/<userId> with the input as json', async () => {
      const input = { full_name: 'Updated Name' };
      const updated = { id: '2', username: 'newstaff', email: 'x', full_name: 'Updated Name', is_active: true, created_at: 'x', updated_at: 'x' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await UsersService.updateUser('2', input);

      expect(patch).toHaveBeenCalledWith('users/2', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteUser', () => {
    it('calls DELETE users/<userId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await UsersService.deleteUser('2');

      expect(del).toHaveBeenCalledWith('users/2');
    });
  });
});
