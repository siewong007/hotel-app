import React from 'react';
import {
  CheckCircle as AvailableIcon,
  Block as OccupiedIcon,
  CalendarToday as ReservedIcon,
  CleaningServices as CleaningIcon,
  Report as DirtyIcon,
  Build as MaintenanceIcon,
} from '@mui/icons-material';
import { ChipPropsColorOverrides } from '@mui/material/Chip';
import { OverridableStringUnion } from '@mui/types';

/**
 * Room Status Type Definition
 * All possible room statuses in the system
 *
 * Status Overview:
 * - available (Vacant/Clean): Room ready for booking, can check-in with booking details
 * - occupied: Guest checked in, shows guest details on room card
 * - reserved: Has upcoming booking, can check-in directly (details already entered)
 * - dirty: Needs cleaning; reservations can be made but check-in is blocked
 * - reserved_dirty: Has a reservation and still needs cleaning before check-in
 * - maintenance: Under repair, NO check-in, NO upcoming bookings
 */
export type RoomStatusType =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'reserved_dirty'
  | 'dirty'
  | 'maintenance';

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
  | 'voided';

/**
 * Display Status Type - unified type for display purposes
 * Maps both room and booking statuses to display categories
 */
export type DisplayStatusType =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'reserved_dirty'
  | 'dirty'
  | 'maintenance'
  | 'pending'
  | 'checked_out'
  | 'voided';

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
  // Room-card background fills (saturated surfaces the card's white text sits
  // on). cardFill defaults to bgColor — set it only when bgColor is too light
  // for white text (dirty states). cardFillDark is the dark-mode variant.
  cardFill?: string;
  cardFillDark: string;
  // Accent for status dots/tiles/pills on neutral surfaces (filter chips,
  // header stat tiles, context-menu status pill).
  accentColor: string;

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
    // Visual - success tone (tinted token values; see theme/tokens.ts)
    color: 'success',
    bgColor: 'var(--hotel-success-bg)',
    textColor: 'var(--hotel-success)',
    borderColor: 'var(--hotel-success-border)',
    cardFillDark: 'var(--hotel-success-bg)',
    accentColor: 'var(--hotel-success)',

    // Content
    label: 'Vacant/Clean',
    shortLabel: 'Vacant',
    description: 'Room is clean and ready for booking',
    detailMessage: 'Ready to book',
    icon: AvailableIcon,

    // Behavior
    isAvailableForBooking: true,
    requiresAction: false,
    priority: 1,

    // Classification
    category: 'operational',
    allowedTransitions: ['reserved', 'reserved_dirty', 'occupied', 'dirty', 'maintenance'],
  },

  occupied: {
    // Visual - warning tone (consistent across room management and timeline)
    color: 'warning',
    bgColor: 'var(--hotel-warning-bg)',
    textColor: 'var(--hotel-warning)',
    borderColor: 'var(--hotel-warning-border)',
    cardFillDark: 'var(--hotel-warning-bg)',
    accentColor: 'var(--hotel-warning)',

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
    allowedTransitions: ['dirty', 'available', 'maintenance'],
  },

  reserved: {
    // Visual - info tone (consistent across room management and timeline)
    color: 'info',
    bgColor: 'var(--hotel-info-bg)',
    textColor: 'var(--hotel-info)',
    borderColor: 'var(--hotel-info-border)',
    cardFillDark: 'var(--hotel-info-bg)',
    accentColor: 'var(--hotel-info)',

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
    allowedTransitions: ['occupied', 'available', 'dirty', 'reserved_dirty'],
  },

  reserved_dirty: {
    color: 'warning',
    bgColor: 'var(--hotel-warning-bg)',
    textColor: 'var(--hotel-warning)',
    borderColor: 'var(--hotel-warning-border)',
    cardFill: 'var(--hotel-warning-bg)',
    cardFillDark: 'var(--hotel-warning-bg)',
    accentColor: 'var(--hotel-warning)',

    label: 'Reserved / Dirty',
    shortLabel: 'Res Dirty',
    description: 'Room has a reservation and needs cleaning before check-in',
    detailMessage: 'Clean before check-in',
    icon: DirtyIcon,

    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Mark Clean',
    priority: 4,

    category: 'booking',
    allowedTransitions: ['reserved', 'dirty', 'maintenance'],
  },

  dirty: {
    // Visual - warning tone
    color: 'warning',
    bgColor: 'var(--hotel-warning-bg)',
    textColor: 'var(--hotel-warning)',
    borderColor: 'var(--hotel-warning-border)',
    cardFill: 'var(--hotel-warning-bg)',
    cardFillDark: 'var(--hotel-warning-bg)',
    accentColor: 'var(--hotel-warning)',

    // Content
    label: 'Dirty',
    shortLabel: 'Dirty',
    description: 'Room needs cleaning before check-in',
    detailMessage: 'Needs cleaning',
    icon: DirtyIcon,

    // Behavior
    isAvailableForBooking: false,
    requiresAction: true,
    actionLabel: 'Start Cleaning',
    priority: 5,

    // Classification
    category: 'operational',
    allowedTransitions: ['available', 'reserved_dirty', 'maintenance'],
  },

  maintenance: {
    // Visual - neutral tone
    color: 'default',
    bgColor: 'var(--hotel-neutral-bg)',
    textColor: 'var(--hotel-neutral)',
    borderColor: 'var(--hotel-neutral-border)',
    cardFillDark: 'var(--hotel-neutral-bg)',
    accentColor: 'var(--hotel-neutral)',

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
    allowedTransitions: ['available', 'dirty'],
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

export const getStatusAccentColor = (status: RoomStatusType) => {
  return getStatusConfig(status).accentColor;
};

export const getStatusCardFill = (status: RoomStatusType, isDarkMode: boolean) => {
  const config = getStatusConfig(status);
  return isDarkMode ? config.cardFillDark : (config.cardFill ?? config.bgColor);
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
  maintenance: number;
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
    maintenance: 0,
    availablePercentage: 0,
    occupancyRate: 0,
  };

  rooms.forEach(room => {
    const status = room.computedStatus;
    if (status === 'reserved_dirty') {
      stats.dirty++;
    } else if (status in stats) {
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
  displayAs: RoomStatusType | 'pending' | 'checked_out' | 'voided';
}

export const BOOKING_STATUS_CONFIG: Record<BookingStatusType, BookingStatusConfig> = {
  pending: {
    color: 'var(--hotel-warning)',
    label: 'Pending',
    shortLabel: 'Pend',
    description: 'Booking awaiting confirmation',
    displayAs: 'pending',
  },
  confirmed: {
    color: 'var(--hotel-info)', // same tone as reserved
    label: 'Reserved',
    shortLabel: 'Res',
    description: 'Booking confirmed, awaiting guest arrival',
    displayAs: 'reserved',
  },
  checked_in: {
    color: 'var(--hotel-warning)', // same tone as occupied
    label: 'Occupied',
    shortLabel: 'Occ',
    description: 'Guest has checked in',
    displayAs: 'occupied',
  },
  auto_checked_in: {
    color: 'var(--hotel-warning)', // same tone as occupied
    label: 'Occupied',
    shortLabel: 'Occ',
    description: 'Guest auto checked in',
    displayAs: 'occupied',
  },
  checked_out: {
    color: 'var(--hotel-success)',
    label: 'Checked Out',
    shortLabel: 'Out',
    description: 'Guest has checked out',
    displayAs: 'checked_out',
  },
  voided: {
    color: 'var(--hotel-neutral)',
    label: 'Voided',
    shortLabel: 'Void',
    description: 'Booking was voided',
    displayAs: 'voided',
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
  // Default neutral for unknown statuses
  return 'var(--hotel-neutral)';
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
