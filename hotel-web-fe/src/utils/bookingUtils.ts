/**
 * Booking Utilities for Production
 * Includes validation, formatting, and business logic
 */

import {
  Booking,
  BookingCreateRequest,
  BookingValidation,
  BookingStatus,
  BookingWithDetails,
} from '../types';

/**
 * Validate booking dates
 */
export const validateBookingDates = (
  checkIn: string,
  checkOut: string
): BookingValidation => {
  const errors: string[] = [];
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if dates are valid
  if (isNaN(checkInDate.getTime())) {
    errors.push('Check-in date is invalid');
  }

  if (isNaN(checkOutDate.getTime())) {
    errors.push('Check-out date is invalid');
  }

  // Check-in cannot be in the past
  if (checkInDate < today) {
    errors.push('Check-in date cannot be in the past');
  }

  // Check-out must be after check-in
  if (checkOutDate <= checkInDate) {
    errors.push('Check-out date must be after check-in date');
  }

  // Maximum stay validation (e.g., 30 days)
  const daysDiff = Math.ceil(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff > 30) {
    errors.push('Maximum stay duration is 30 days');
  }

  if (daysDiff < 1) {
    errors.push('Minimum stay duration is 1 day');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validate booking creation request
 */
export const validateBookingRequest = (
  request: BookingCreateRequest
): BookingValidation => {
  const errors: string[] = [];

  // Validate guest_id
  if (!request.guest_id || request.guest_id.trim() === '') {
    errors.push('Guest ID is required');
  }

  // Validate room_id
  if (!request.room_id || request.room_id.trim() === '') {
    errors.push('Room ID is required');
  }

  // Validate dates
  const dateValidation = validateBookingDates(
    request.check_in_date,
    request.check_out_date
  );

  if (!dateValidation.isValid) {
    errors.push(...dateValidation.errors);
  }

  // Validate number of guests if provided
  if (
    request.number_of_guests !== undefined &&
    (request.number_of_guests < 1 || request.number_of_guests > 10)
  ) {
    errors.push('Number of guests must be between 1 and 10');
  }

  // Validate special requests length
  if (request.special_requests && request.special_requests.length > 500) {
    errors.push('Special requests cannot exceed 500 characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Calculate number of nights between dates
 */
export const calculateNights = (checkIn: string, checkOut: string): number => {
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

  const diffTime = checkOutDate.getTime() - checkInDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

/**
 * Calculate total booking amount
 */
export const calculateTotalAmount = (
  pricePerNight: number,
  checkIn: string,
  checkOut: string
): number => {
  const nights = calculateNights(checkIn, checkOut);
  return pricePerNight * nights;
};

/**
 * Format date for display
 */
export const formatDateForDisplay = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Format currency for display
 */
export const formatCurrency = (amount: number | string): string => {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(numAmount);
};

/**
 * Get booking status color
 */
export const getBookingStatusColor = (
  status: BookingStatus | string
): 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' => {
  switch (status) {
    case BookingStatus.CONFIRMED:
      return 'success';
    case BookingStatus.PENDING:
      return 'warning';
    case BookingStatus.CHECKED_IN:
      return 'primary';
    case BookingStatus.CHECKED_OUT:
      return 'info';
    case BookingStatus.CANCELLED:
      return 'error';
    case BookingStatus.NO_SHOW:
      return 'error';
    default:
      return 'default';
  }
};

/**
 * Get booking status display text
 */
export const getBookingStatusText = (status: BookingStatus | string): string => {
  switch (status) {
    case BookingStatus.CONFIRMED:
      return 'Confirmed';
    case BookingStatus.PENDING:
      return 'Pending';
    case BookingStatus.CHECKED_IN:
      return 'Checked In';
    case BookingStatus.CHECKED_OUT:
      return 'Checked Out';
    case BookingStatus.CANCELLED:
      return 'Cancelled';
    case BookingStatus.NO_SHOW:
      return 'No Show';
    default:
      return status;
  }
};

/**
 * Check if booking can be cancelled
 */
export const canCancelBooking = (booking: Booking): boolean => {
  const checkInDate = new Date(booking.check_in_date);
  const now = new Date();
  const hoursDiff = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Can cancel if:
  // 1. Status is confirmed or pending
  // 2. Check-in is more than 24 hours away
  const validStatuses = [BookingStatus.CONFIRMED, BookingStatus.PENDING, 'confirmed', 'pending'];
  return validStatuses.includes(booking.status) && hoursDiff > 24;
};

/**
 * Check if booking can be modified
 */
export const canModifyBooking = (booking: Booking): boolean => {
  const checkInDate = new Date(booking.check_in_date);
  const now = new Date();
  const hoursDiff = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Can modify if:
  // 1. Status is confirmed or pending
  // 2. Check-in is more than 48 hours away
  const validStatuses = [BookingStatus.CONFIRMED, BookingStatus.PENDING, 'confirmed', 'pending'];
  return validStatuses.includes(booking.status) && hoursDiff > 48;
};

/**
 * Check if booking is active (checked in but not checked out)
 */
export const isBookingActive = (booking: Booking): boolean => {
  return booking.status === BookingStatus.CHECKED_IN || booking.status === 'checked_in';
};

/**
 * Enhance booking with computed fields
 */
export const enhanceBookingDetails = (
  booking: BookingWithDetails
): BookingWithDetails => {
  const checkInDate = booking.check_in_date;
  const checkOutDate = booking.check_out_date;
  const pricePerNight =
    typeof booking.price_per_night === 'string'
      ? parseFloat(booking.price_per_night)
      : booking.price_per_night;

  const nights = calculateNights(checkInDate, checkOutDate);
  const totalAmount =
    typeof booking.total_amount === 'string'
      ? parseFloat(booking.total_amount)
      : booking.total_amount;

  return {
    ...booking,
    number_of_nights: nights,
    formatted_check_in: formatDateForDisplay(checkInDate),
    formatted_check_out: formatDateForDisplay(checkOutDate),
    formatted_total: formatCurrency(totalAmount),
    is_active: isBookingActive(booking),
    can_cancel: canCancelBooking(booking),
    can_modify: canModifyBooking(booking),
  };
};

/**
 * Sort bookings by check-in date (newest first)
 */
export const sortBookingsByDate = (
  bookings: BookingWithDetails[]
): BookingWithDetails[] => {
  return [...bookings].sort((a, b) => {
    const dateA = new Date(a.check_in_date);
    const dateB = new Date(b.check_in_date);
    return dateB.getTime() - dateA.getTime();
  });
};

/**
 * Filter active bookings
 */
export const filterActiveBookings = (
  bookings: BookingWithDetails[]
): BookingWithDetails[] => {
  return bookings.filter((booking) => isBookingActive(booking));
};

/**
 * Filter upcoming bookings
 */
export const filterUpcomingBookings = (
  bookings: BookingWithDetails[]
): BookingWithDetails[] => {
  const now = new Date();
  return bookings.filter((booking) => {
    const checkInDate = new Date(booking.check_in_date);
    const validStatuses = [BookingStatus.CONFIRMED, BookingStatus.PENDING, 'confirmed', 'pending'];
    return checkInDate > now && validStatuses.includes(booking.status);
  });
};

/**
 * Get booking statistics
 */
export interface BookingStats {
  total: number;
  active: number;
  upcoming: number;
  completed: number;
  cancelled: number;
  totalRevenue: number;
}

export const getBookingStatistics = (
  bookings: BookingWithDetails[]
): BookingStats => {
  const active = filterActiveBookings(bookings).length;
  const upcoming = filterUpcomingBookings(bookings).length;
  const completed = bookings.filter(
    (b) => b.status === BookingStatus.CHECKED_OUT || b.status === 'checked_out'
  ).length;
  const cancelled = bookings.filter(
    (b) => b.status === BookingStatus.CANCELLED || b.status === 'cancelled'
  ).length;

  const totalRevenue = bookings
    .filter((b) => b.status !== BookingStatus.CANCELLED && b.status !== 'cancelled')
    .reduce((sum, booking) => {
      const amount =
        typeof booking.total_amount === 'string'
          ? parseFloat(booking.total_amount)
          : booking.total_amount;
      return sum + amount;
    }, 0);

  return {
    total: bookings.length,
    active,
    upcoming,
    completed,
    cancelled,
    totalRevenue,
  };
};
