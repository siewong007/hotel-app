import { api } from './client';
import { Booking, Guest, PreCheckInUpdateRequest } from '../types';

export class GuestPortalService {
  static async verify(request: {
    booking_number: string;
    email: string;
  }): Promise<{ token: string; expires_at: string; booking_id: string }> {
    return await api.post('guest-portal/verify', { json: request }).json();
  }

  static async getBooking(token: string): Promise<{
    booking: Booking;
    guest: Guest;
  }> {
    return await api.get(`guest-portal/booking/${token}`).json();
  }

  static async submitPreCheckin(
    token: string,
    request: PreCheckInUpdateRequest
  ): Promise<{ booking: Booking; guest: Guest }> {
    return await api.post(`guest-portal/pre-checkin/${token}`, { json: request }).json();
  }
}
