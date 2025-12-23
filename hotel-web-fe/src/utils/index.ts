// Utils Barrel Export
// Re-exports all utility functions for clean imports

// Currency utilities (primary formatCurrency implementation)
export * from './currency';

// Booking utilities (excluding formatCurrency which is in currency.ts)
export {
  validateBookingDates,
  validateBookingRequest,
  calculateNights,
  calculateTotalAmount,
  formatDateForDisplay,
  getBookingStatusColor,
  getBookingStatusText,
  canCancelBooking,
  canModifyBooking,
  isBookingActive,
  enhanceBookingDetails,
  sortBookingsByDate,
  filterActiveBookings,
  filterUpcomingBookings,
  getBookingStatistics,
} from './bookingUtils';
export type { BookingStats } from './bookingUtils';

export * from './hotelSettings';
export * from './retry';
export * from './storage';
export * from './validation';
