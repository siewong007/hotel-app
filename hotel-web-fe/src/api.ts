import axios from 'axios';
import {
  Room,
  Guest,
  Booking,
  GuestCreateRequest,
  BookingCreateRequest,
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
  UserWithRolesAndPermissions
} from './types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3030';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.removeItem('roles');
      localStorage.removeItem('permissions');
      window.location.href = '/login';
    }
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

export class HotelAPIService {
  // Room operations
  static async getAllRooms(): Promise<Room[]> {
    const response = await api.get('/rooms');
    return response.data;
  }

  static async searchRooms(roomType?: string, maxPrice?: number): Promise<Room[]> {
    const params: SearchQuery = {};
    if (roomType) params.room_type = roomType;
    if (maxPrice) params.max_price = maxPrice;

    const response = await api.get('/rooms/available', { params });
    return response.data;
  }

  // Guest operations
  static async getAllGuests(): Promise<Guest[]> {
    const response = await api.get('/guests');
    return response.data;
  }

  static async createGuest(guestData: GuestCreateRequest): Promise<Guest> {
    const response = await api.post('/guests', guestData);
    return response.data;
  }

  // Booking operations
  static async getAllBookings(): Promise<Booking[]> {
    const response = await api.get('/bookings');
    return response.data;
  }

  static async createBooking(bookingData: BookingCreateRequest): Promise<Booking> {
    const response = await api.post('/bookings', bookingData);
    return response.data;
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
    const bookings = await this.getAllBookings();
    // The backend now returns bookings with details, so we can use them directly
    return bookings as any;
  }

  // RBAC Operations (Admin only)
  static async getAllRoles(): Promise<Role[]> {
    const response = await api.get('/rbac/roles');
    return response.data;
  }

  static async createRole(roleData: RoleInput): Promise<Role> {
    const response = await api.post('/rbac/roles', roleData);
    return response.data;
  }

  static async getAllPermissions(): Promise<Permission[]> {
    const response = await api.get('/rbac/permissions');
    return response.data;
  }

  static async createPermission(permissionData: PermissionInput): Promise<Permission> {
    const response = await api.post('/rbac/permissions', permissionData);
    return response.data;
  }

  static async assignRoleToUser(assignData: AssignRoleInput): Promise<void> {
    await api.post('/rbac/users/roles', assignData);
  }

  static async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await api.delete(`/rbac/users/${userId}/roles/${roleId}`);
  }

  static async assignPermissionToRole(assignData: AssignPermissionInput): Promise<void> {
    await api.post('/rbac/roles/permissions', assignData);
  }

  static async removePermissionFromRole(roleId: string, permissionId: string): Promise<void> {
    await api.delete(`/rbac/roles/${roleId}/permissions/${permissionId}`);
  }

  static async getRolePermissions(roleId: string): Promise<RoleWithPermissions> {
    const response = await api.get(`/rbac/roles/${roleId}/permissions`);
    return response.data;
  }

  static async getAllUsers(): Promise<User[]> {
    const response = await api.get('/rbac/users');
    return response.data;
  }

  static async getUserRolesAndPermissions(userId: string): Promise<UserWithRolesAndPermissions> {
    const response = await api.get(`/rbac/users/${userId}`);
    return response.data;
  }

  // Health and Status
  static async getHealth(): Promise<{ status: string }> {
    const response = await api.get('/health');
    return response.data;
  }

  static async getWebSocketStatus(): Promise<{ status: string; protocol: string; endpoint: string; message: string }> {
    const response = await api.get('/ws/status');
    return response.data;
  }

  // Analytics endpoints (MCP-compatible)
  static async getOccupancyReport(): Promise<any> {
    const response = await api.get('/analytics/occupancy');
    return response.data;
  }

  static async getBookingAnalytics(): Promise<any> {
    const response = await api.get('/analytics/bookings');
    return response.data;
  }

  static async getBenchmarkReport(): Promise<any> {
    const response = await api.get('/analytics/benchmark');
    return response.data;
  }

  static async getPersonalizedReport(period?: string): Promise<any> {
    const params = period ? { period } : {};
    const response = await api.get('/analytics/personalized', { params });
    return response.data;
  }
}

export default api;
