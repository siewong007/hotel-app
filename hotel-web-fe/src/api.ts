import ky, { HTTPError } from 'ky';
import {
  Room,
  Guest,
  Booking,
  GuestCreateRequest,
  BookingCreateRequest,
  BookingUpdateRequest,
  BookingCancellationRequest,
  SearchQuery,
  RoomWithDisplay,
  BookingWithDetails,
  Role,
  Permission,
  RoleInput,
  PermissionInput,
  AssignRoleInput,
  AssignPermissionInput,
  RoleWithPermissions,
  User,
  UserWithRolesAndPermissions,
  LoyaltyProgram,
  LoyaltyMembership,
  PointsTransaction,
  LoyaltyMembershipWithDetails,
  LoyaltyStatistics,
  UserLoyaltyMembership,
  LoyaltyReward,
  RedeemRewardInput,
  UserProfile,
  UserProfileUpdate,
  PasswordUpdate,
  PasskeyInfo,
  PasskeyUpdateInput,
  RewardInput,
  RewardUpdateInput,
  RewardRedemption
} from './types';
import { storage } from './utils/storage';
import { validateBookingRequest, enhanceBookingDetails } from './utils/bookingUtils';

// API Error class for better error handling
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3030';

// Create ky instance with hooks for auth and error handling
const api = ky.create({
  prefixUrl: API_BASE_URL,
  hooks: {
    beforeRequest: [
      request => {
        const token = storage.getItem<string>('accessToken');
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      }
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status === 401) {
          // Check if this is a login or auth endpoint - don't auto-logout for these
          const url = request.url;
          const isAuthEndpoint = url.includes('/auth/login') ||
                                 url.includes('/auth/passkey') ||
                                 url.includes('/auth/register');

          // Only auto-logout for 401s on protected endpoints, not auth endpoints
          if (!isAuthEndpoint) {
            // Token expired or invalid - clear only auth data, preserve language preferences
            storage.removeItem('accessToken');
            storage.removeItem('refreshToken');
            storage.removeItem('user');
            storage.removeItem('roles');
            storage.removeItem('permissions');

            // Use React Router navigation instead of hard redirect
            // Dispatch a custom event that AuthContext can listen to
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        }
        return response;
      }
    ]
  }
});

export class HotelAPIService {
  // Room operations
  static async getAllRooms(): Promise<Room[]> {
    return await api.get('rooms').json<Room[]>();
  }

  static async searchRooms(roomType?: string, maxPrice?: number): Promise<Room[]> {
    const params: SearchQuery = {};
    if (roomType) params.room_type = roomType;
    if (maxPrice) params.max_price = maxPrice;

    return await api.get('rooms/available', { searchParams: params }).json<Room[]>();
  }

  // Guest operations
  static async getAllGuests(): Promise<Guest[]> {
    return await api.get('guests').json<Guest[]>();
  }

  static async createGuest(guestData: GuestCreateRequest): Promise<Guest> {
    return await api.post('guests', { json: guestData }).json<Guest>();
  }

  // Booking operations with enhanced validation and error handling
  static async getAllBookings(): Promise<Booking[]> {
    try {
      return await api.get('bookings').json<Booking[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch bookings');
    }
  }

  static async getMyBookings(): Promise<BookingWithDetails[]> {
    try {
      return await api.get('bookings/my-bookings').json<BookingWithDetails[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch your bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch your bookings');
    }
  }

  static async createBooking(bookingData: BookingCreateRequest): Promise<Booking> {
    // Validate booking data before sending to API
    const validation = validateBookingRequest(bookingData);
    if (!validation.isValid) {
      throw new APIError(
        `Invalid booking data: ${validation.errors.join(', ')}`,
        400,
        { errors: validation.errors }
      );
    }

    try {
      return await api.post('bookings', { json: bookingData }).json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create booking');
    }
  }

  static async updateBooking(
    bookingId: string,
    updateData: BookingUpdateRequest
  ): Promise<Booking> {
    try {
      return await api
        .patch(`bookings/${bookingId}`, { json: updateData })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update booking');
    }
  }

  static async cancelBooking(
    cancellationData: BookingCancellationRequest
  ): Promise<Booking> {
    try {
      return await api
        .post('bookings/cancel', { json: cancellationData })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to cancel booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to cancel booking');
    }
  }

  static async getBookingById(bookingId: string): Promise<Booking> {
    try {
      return await api.get(`bookings/${bookingId}`).json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch booking');
    }
  }

  // Utility functions for UI display
  static formatRoomForDisplay(room: Room): RoomWithDisplay {
    return {
      ...room,
      displayPrice: `$${typeof room.price_per_night === 'number' ? room.price_per_night.toFixed(0) : room.price_per_night}/night`,
      availabilityText: room.available ? 'Available' : 'Booked',
    };
  }

  static async getBookingsWithDetails(): Promise<BookingWithDetails[]> {
    try {
      const bookings = await this.getAllBookings();
      // The backend now returns bookings with details, so we can use them directly
      const bookingsWithDetails = bookings as any as BookingWithDetails[];

      // Enhance each booking with computed fields
      return bookingsWithDetails.map(booking => enhanceBookingDetails(booking));
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError('Failed to fetch booking details');
    }
  }

  // RBAC Operations (Admin only)
  static async getAllRoles(): Promise<Role[]> {
    return await api.get('rbac/roles').json<Role[]>();
  }

  static async createRole(roleData: RoleInput): Promise<Role> {
    return await api.post('rbac/roles', { json: roleData }).json<Role>();
  }

  static async getAllPermissions(): Promise<Permission[]> {
    return await api.get('rbac/permissions').json<Permission[]>();
  }

  static async createPermission(permissionData: PermissionInput): Promise<Permission> {
    return await api.post('rbac/permissions', { json: permissionData }).json<Permission>();
  }

  static async assignRoleToUser(assignData: AssignRoleInput): Promise<void> {
    await api.post('rbac/users/roles', { json: assignData });
  }

  static async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await api.delete(`rbac/users/${userId}/roles/${roleId}`);
  }

  static async assignPermissionToRole(assignData: AssignPermissionInput): Promise<void> {
    await api.post('rbac/roles/permissions', { json: assignData });
  }

  static async removePermissionFromRole(roleId: string, permissionId: string): Promise<void> {
    await api.delete(`rbac/roles/${roleId}/permissions/${permissionId}`);
  }

  static async getRolePermissions(roleId: string): Promise<RoleWithPermissions> {
    return await api.get(`rbac/roles/${roleId}/permissions`).json<RoleWithPermissions>();
  }

  static async getAllUsers(): Promise<User[]> {
    return await api.get('rbac/users').json<User[]>();
  }

  static async createUser(userData: { username: string; email: string; password: string; full_name?: string; phone?: string; role_ids?: number[] }): Promise<User> {
    return await api.post('rbac/users', { json: userData }).json<User>();
  }

  static async getUserRolesAndPermissions(userId: string): Promise<UserWithRolesAndPermissions> {
    return await api.get(`rbac/users/${userId}`).json<UserWithRolesAndPermissions>();
  }

  // Health and Status
  static async getHealth(): Promise<{ status: string }> {
    return await api.get('health').json<{ status: string }>();
  }

  static async getWebSocketStatus(): Promise<{ status: string; protocol: string; endpoint: string; message: string }> {
    return await api.get('ws/status').json<{ status: string; protocol: string; endpoint: string; message: string }>();
  }

  // Analytics endpoints (MCP-compatible)
  static async getOccupancyReport(): Promise<any> {
    return await api.get('analytics/occupancy').json();
  }

  static async getBookingAnalytics(): Promise<any> {
    return await api.get('analytics/bookings').json();
  }

  static async getBenchmarkReport(): Promise<any> {
    return await api.get('analytics/benchmark').json();
  }

  static async getPersonalizedReport(period?: string): Promise<any> {
    const searchParams = period ? { period } : {};
    return await api.get('analytics/personalized', { searchParams }).json();
  }

  // Loyalty Program Operations
  static async getAllLoyaltyPrograms(): Promise<LoyaltyProgram[]> {
    return await api.get('loyalty/programs').json<LoyaltyProgram[]>();
  }

  static async getAllLoyaltyMemberships(): Promise<LoyaltyMembershipWithDetails[]> {
    return await api.get('loyalty/memberships').json<LoyaltyMembershipWithDetails[]>();
  }

  static async getLoyaltyMembershipsByGuest(guestId: string): Promise<LoyaltyMembership[]> {
    return await api.get(`loyalty/guests/${guestId}/memberships`).json<LoyaltyMembership[]>();
  }

  static async getPointsTransactions(membershipId: number): Promise<PointsTransaction[]> {
    return await api.get(`loyalty/memberships/${membershipId}/transactions`).json<PointsTransaction[]>();
  }

  static async getLoyaltyStatistics(): Promise<LoyaltyStatistics> {
    return await api.get('loyalty/statistics').json<LoyaltyStatistics>();
  }

  static async addPointsToMembership(membershipId: number, points: number, description?: string): Promise<PointsTransaction> {
    return await api.post(`loyalty/memberships/${membershipId}/points/add`, {
      json: { points, description }
    }).json<PointsTransaction>();
  }

  static async redeemPoints(membershipId: number, points: number, description?: string): Promise<PointsTransaction> {
    return await api.post(`loyalty/memberships/${membershipId}/points/redeem`, {
      json: { points, description }
    }).json<PointsTransaction>();
  }

  // User Loyalty Operations (for logged-in users)
  static async getUserLoyaltyMembership(): Promise<UserLoyaltyMembership> {
    return await api.get('loyalty/my-membership').json<UserLoyaltyMembership>();
  }

  static async getLoyaltyRewards(): Promise<LoyaltyReward[]> {
    return await api.get('loyalty/rewards').json<LoyaltyReward[]>();
  }

  static async redeemReward(input: RedeemRewardInput): Promise<any> {
    return await api.post('loyalty/rewards/redeem', {
      json: input
    }).json();
  }

  // User Profile Operations
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

  // Room Reviews
  static async getRoomReviews(roomType: string): Promise<any[]> {
    return await api.get(`rooms/${encodeURIComponent(roomType)}/reviews`).json<any[]>();
  }

  // Rewards Management Operations (Admin only)
  static async getRewards(category?: string): Promise<LoyaltyReward[]> {
    const searchParams = category ? { category } : {};
    return await api.get('rewards', { searchParams }).json<LoyaltyReward[]>();
  }

  static async getReward(id: number): Promise<LoyaltyReward> {
    return await api.get(`rewards/${id}`).json<LoyaltyReward>();
  }

  static async createReward(data: RewardInput): Promise<LoyaltyReward> {
    try {
      return await api.post('rewards', { json: data }).json<LoyaltyReward>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create reward',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create reward');
    }
  }

  static async updateReward(id: number, data: RewardUpdateInput): Promise<LoyaltyReward> {
    try {
      return await api.patch(`rewards/${id}`, { json: data }).json<LoyaltyReward>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update reward',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update reward');
    }
  }

  static async deleteReward(id: number): Promise<void> {
    try {
      await api.delete(`rewards/${id}`);
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to delete reward',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to delete reward');
    }
  }

  static async getRewardRedemptions(): Promise<RewardRedemption[]> {
    try {
      return await api.get('rewards/redemptions').json<RewardRedemption[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch redemption history',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch redemption history');
    }
  }
}

export default api;
