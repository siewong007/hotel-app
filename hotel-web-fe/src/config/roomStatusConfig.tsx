import React from 'react';
import {
  CheckCircle as AvailableIcon,
  Block as OccupiedIcon,
  CalendarToday as ReservedIcon,
  CleaningServices as CleaningIcon,
  Report as DirtyIcon,
  Build as MaintenanceIcon,
  Cancel as OutOfOrderIcon,
} from '@mui/icons-material';
import { ChipPropsColorOverrides } from '@mui/material/Chip';
import { OverridableStringUnion } from '@mui/types';

/**
 * Room Status Type Definition
 * All possible room statuses in the system
 */
export type RoomStatusType =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'cleaning'
  | 'dirty'
  | 'maintenance'
  | 'out_of_order';

/**
 * Booking Status Type Definition
 * All possible booking statuses in the system
 */
export type BookingStatusType =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'auto_checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show';

/**
 * Display Status Type - unified type for display purposes
 * Maps both room and booking statuses to display categories
 */
export type DisplayStatusType =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'cleaning'
  | 'dirty'
  | 'maintenance'
  | 'out_of_order'
  | 'pending'
  | 'checked_out'
  | 'cancelled';

/**
 * Status Configuration Interface
 * Defines the structure for each status configuration
 */
export interface StatusConfig {
  // Visual Properties
  color: OverridableStringUnion<
    'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning',
    ChipPropsColorOverrides
  >;
  bgColor: string;
  textColor: string;
  borderColor: string;

  // Content
  label: string;
  shortLabel: string;
  description: string;
  detailMessage: string;
  icon: React.ComponentType<any>;

  // Behavior
  isAvailableForBooking: boolean;
  requiresAction: boolean;
  actionLabel?: string;
  priority: number; // 1 = highest priority

  // Classification
  category: 'operational' | 'booking' | 'maintenance';

  // Allowed transitions (for future state machine UI)
  allowedTransitions: RoomStatusType[];
}

/**
 * Centralized Room Status Configuration
 * Single source of truth for all status-related styling and behavior
 */
export const ROOM_STATUS_CONFIG: Record<RoomStatusType, StatusConfig> = {
  available: {
    // Visual - Green (consistent across room management and timeline)
    color: 'success',
    bgColor: '#66BB6A',
    textColor: '#fff',
    borderColor: '#43A047',

    // Content
    label: 'Available',
    shortLabel: 'Avail',
    description: 'Room is clean and ready for booking',
    detailMessage: 'Ready to book',
    icon: AvailableIcon,

    // Behavior
    isAvailableForBooking: true,
    requiresAction: false,
    priority: 1,

    // Classification
    category: 'operational',
    allowedTransitions: ['reserved', 'occupied', 'cleaning', 'dirty', 'maintenance', 'out_of_order'],
  },

  occupied: {
    // Visual - Orange (consistent across room management and timeline)
    color: 'warning',
    bgColor: '#FFA726',
    textColor: '#fff',
    borderColor: '#FB8C00',

    // Content
    label: 'Occupied',
    shortLabel: 'Occ',
    description: 'Guest is currently checked in',
    detailMessage: 'Guest checked in',
    icon: OccupiedIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: false,
    priority: 2,

    // Classification
    category: 'booking',
    allowedTransitions: ['dirty', 'cleaning', 'available', 'maintenance'],
  },

  reserved: {
    // Visual - Blue (consistent across room management and timeline)
    color: 'info',
    bgColor: '#42A5F5',
    textColor: '#fff',
    borderColor: '#1E88E5',

    // Content
    label: 'Reserved',
    shortLabel: 'Res',
    description: 'Room has a future booking',
    detailMessage: 'Awaiting guest arrival',
    icon: ReservedIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: false,
    priority: 3,

    // Classification
    category: 'booking',
    allowedTransitions: ['occupied', 'available', 'dirty'],
  },

  dirty: {
    // Visual - ORANGE COLOR as requested!
    color: 'warning',
    bgColor: '#ff6f00', // Deep orange
    textColor: '#fff',
    borderColor: '#e65100',

    // Content
    label: 'Dirty',
    shortLabel: 'Dirty',
    description: 'Room needs cleaning after checkout',
    detailMessage: 'Needs cleaning',
    icon: DirtyIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Start Cleaning',
    priority: 4,

    // Classification
    category: 'operational',
    allowedTransitions: ['cleaning', 'available', 'maintenance'],
  },

  cleaning: {
    // Visual
    color: 'info',
    bgColor: '#2196f3',
    textColor: '#fff',
    borderColor: '#1976d2',

    // Content
    label: 'Cleaning',
    shortLabel: 'Clean',
    description: 'Housekeeping is actively cleaning',
    detailMessage: 'Being cleaned',
    icon: CleaningIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Mark as Clean',
    priority: 5,

    // Classification
    category: 'operational',
    allowedTransitions: ['available', 'dirty', 'maintenance'],
  },

  maintenance: {
    // Visual
    color: 'default',
    bgColor: '#757575',
    textColor: '#fff',
    borderColor: '#616161',

    // Content
    label: 'Maintenance',
    shortLabel: 'Maint',
    description: 'Room requires repairs or maintenance',
    detailMessage: 'Under repair',
    icon: MaintenanceIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Complete Maintenance',
    priority: 6,

    // Classification
    category: 'maintenance',
    allowedTransitions: ['available', 'cleaning', 'dirty', 'out_of_order'],
  },

  out_of_order: {
    // Visual
    color: 'default',
    bgColor: '#424242',
    textColor: '#fff',
    borderColor: '#212121',

    // Content
    label: 'Out of Order',
    shortLabel: 'OOO',
    description: 'Room is completely out of service',
    detailMessage: 'Out of service',
    icon: OutOfOrderIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Restore to Service',
    priority: 7,

    // Classification
    category: 'maintenance',
    allowedTransitions: ['maintenance', 'available'],
  },
};

/**
 * Helper Functions
 */

export const getStatusConfig = (status: RoomStatusType): StatusConfig => {
  return ROOM_STATUS_CONFIG[status] || ROOM_STATUS_CONFIG.available;
};

export const getStatusColor = (status: RoomStatusType) => {
  return getStatusConfig(status).color;
};

export const getStatusBgColor = (status: RoomStatusType) => {
  return getStatusConfig(status).bgColor;
};

export const getStatusLabel = (status: RoomStatusType) => {
  return getStatusConfig(status).label;
};

export const getStatusIcon = (status: RoomStatusType) => {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;
  return IconComponent;
};

export const isRoomAvailableForBooking = (status: RoomStatusType): boolean => {
  return getStatusConfig(status).isAvailableForBooking;
};

export const getStatusPriority = (status: RoomStatusType): number => {
  return getStatusConfig(status).priority;
};

export const getAllStatuses = (): RoomStatusType[] => {
  return Object.keys(ROOM_STATUS_CONFIG) as RoomStatusType[];
};

export const getStatusesByCategory = (category: 'operational' | 'booking' | 'maintenance'): RoomStatusType[] => {
  return getAllStatuses().filter(status => getStatusConfig(status).category === category);
};

export const canTransitionTo = (fromStatus: RoomStatusType, toStatus: RoomStatusType): boolean => {
  return getStatusConfig(fromStatus).allowedTransitions.includes(toStatus);
};

/**
 * Status Statistics Helper
 */
export interface StatusStatistics {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  dirty: number;
  cleaning: number;
  maintenance: number;
  out_of_order: number;
  availablePercentage: number;
  occupancyRate: number;
}

export const calculateStatusStatistics = (
  rooms: Array<{ computedStatus: RoomStatusType }>
): StatusStatistics => {
  const stats: StatusStatistics = {
    total: rooms.length,
    available: 0,
    occupied: 0,
    reserved: 0,
    dirty: 0,
    cleaning: 0,
    maintenance: 0,
    out_of_order: 0,
    availablePercentage: 0,
    occupancyRate: 0,
  };

  rooms.forEach(room => {
    const status = room.computedStatus;
    if (status in stats) {
      stats[status as keyof Omit<StatusStatistics, 'total' | 'availablePercentage' | 'occupancyRate'>]++;
    }
  });

  stats.availablePercentage = stats.total > 0
    ? Math.round((stats.available / stats.total) * 100)
    : 0;

  stats.occupancyRate = stats.total > 0
    ? Math.round((stats.occupied / stats.total) * 100)
    : 0;

  return stats;
};

/**
 * Status Filter Helper
 */
export const filterRoomsByStatus = <T extends { computedStatus: RoomStatusType }>(
  rooms: T[],
  statuses: RoomStatusType[]
): T[] => {
  return rooms.filter(room => statuses.includes(room.computedStatus));
};

export const filterAvailableRooms = <T extends { computedStatus: RoomStatusType }>(
  rooms: T[]
): T[] => {
  return rooms.filter(room => isRoomAvailableForBooking(room.computedStatus));
};

/**
 * Status Sorting Helper
 */
export const sortRoomsByStatusPriority = <T extends { computedStatus: RoomStatusType }>(
  rooms: T[]
): T[] => {
  return [...rooms].sort((a, b) => {
    const priorityA = getStatusPriority(a.computedStatus);
    const priorityB = getStatusPriority(b.computedStatus);
    return priorityA - priorityB;
  });
};

/**
 * Booking Status Configuration
 * Maps booking statuses to display properties for consistent rendering
 */
export interface BookingStatusConfig {
  color: string;
  label: string;
  shortLabel: string;
  description: string;
  // Maps to equivalent room status for unified display
  displayAs: RoomStatusType | 'pending' | 'checked_out' | 'cancelled';
}

export const BOOKING_STATUS_CONFIG: Record<BookingStatusType, BookingStatusConfig> = {
  pending: {
    color: '#FFEB3B', // Yellow
    label: 'Pending',
    shortLabel: 'Pend',
    description: 'Booking awaiting confirmation',
    displayAs: 'pending',
  },
  confirmed: {
    color: '#42A5F5', // Blue - same as reserved
    label: 'Reserved',
    shortLabel: 'Res',
    description: 'Booking confirmed, awaiting guest arrival',
    displayAs: 'reserved',
  },
  checked_in: {
    color: '#FFA726', // Orange - same as occupied
    label: 'Occupied',
    shortLabel: 'Occ',
    description: 'Guest has checked in',
    displayAs: 'occupied',
  },
  auto_checked_in: {
    color: '#FFA726', // Orange - same as occupied
    label: 'Occupied',
    shortLabel: 'Occ',
    description: 'Guest auto checked in',
    displayAs: 'occupied',
  },
  checked_out: {
    color: '#66BB6A', // Green
    label: 'Checked Out',
    shortLabel: 'Out',
    description: 'Guest has checked out',
    displayAs: 'checked_out',
  },
  cancelled: {
    color: '#BDBDBD', // Grey
    label: 'Cancelled',
    shortLabel: 'Can',
    description: 'Booking was cancelled',
    displayAs: 'cancelled',
  },
  no_show: {
    color: '#EF5350', // Red
    label: 'No Show',
    shortLabel: 'N/S',
    description: 'Guest did not arrive',
    displayAs: 'cancelled',
  },
};

/**
 * Get booking status configuration
 */
export const getBookingStatusConfig = (status: BookingStatusType): BookingStatusConfig => {
  return BOOKING_STATUS_CONFIG[status] || BOOKING_STATUS_CONFIG.pending;
};

/**
 * Get booking status color
 */
export const getBookingStatusColor = (status: BookingStatusType): string => {
  return getBookingStatusConfig(status).color;
};

/**
 * Get booking status label
 */
export const getBookingStatusLabel = (status: BookingStatusType): string => {
  return getBookingStatusConfig(status).label;
};

/**
 * Get booking status short label
 */
export const getBookingStatusShortLabel = (status: BookingStatusType): string => {
  return getBookingStatusConfig(status).shortLabel;
};

/**
 * Unified status color getter - works with both room and booking statuses
 * This is the main function to use for consistent colors across components
 */
export function getUnifiedStatusColor(status: string): string {
  // Check if it's a booking status first
  const bookingConfig = BOOKING_STATUS_CONFIG[status as BookingStatusType];
  if (bookingConfig) {
    return bookingConfig.color;
  }
  // Check if it's a room status
  const roomConfig = ROOM_STATUS_CONFIG[status as RoomStatusType];
  if (roomConfig) {
    return roomConfig.bgColor;
  }
  // Default grey for unknown statuses
  return '#BDBDBD';
}

/**
 * Unified status label getter - works with both room and booking statuses
 */
export function getUnifiedStatusLabel(status: string): string {
  // Check if it's a booking status first
  const bookingConfig = BOOKING_STATUS_CONFIG[status as BookingStatusType];
  if (bookingConfig) {
    return bookingConfig.label;
  }
  // Check if it's a room status
  const roomConfig = ROOM_STATUS_CONFIG[status as RoomStatusType];
  if (roomConfig) {
    return roomConfig.label;
  }
  // Return the status as-is for unknown statuses
  return status;
}

/**
 * Unified status short label getter - works with both room and booking statuses
 */
export function getUnifiedStatusShortLabel(status: string): string {
  // Check if it's a booking status first
  const bookingConfig = BOOKING_STATUS_CONFIG[status as BookingStatusType];
  if (bookingConfig) {
    return bookingConfig.shortLabel;
  }
  // Check if it's a room status
  const roomConfig = ROOM_STATUS_CONFIG[status as RoomStatusType];
  if (roomConfig) {
    return roomConfig.shortLabel;
  }
  // Return the status as-is for unknown statuses
  return status;
}
