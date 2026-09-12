import type { BookingWithDetails } from '../../../../types';
import type { SortField, SortOrder } from './types';

export const getStatusColor = (status: string): 'success' | 'warning' | 'info' | 'default' => {
  switch (status) {
    case 'fully_complimentary':
      return 'success';
    case 'partial_complimentary':
      return 'warning';
    case 'voided':
      return 'info';
    default:
      return 'default';
  }
};

export const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'fully_complimentary':
      return 'Fully Complimentary';
    case 'partial_complimentary':
      return 'Partial';
    case 'voided':
      return 'Voided';
    default:
      return status;
  }
};

export const filterAndSortBookings = (
  bookings: BookingWithDetails[],
  searchQuery: string,
  sortField: SortField,
  sortOrder: SortOrder
): BookingWithDetails[] => {
  let filtered = [...(bookings || [])];

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (b) =>
        b.guest_name?.toLowerCase().includes(query) ||
        b.booking_number?.toLowerCase().includes(query) ||
        b.room_number?.toLowerCase().includes(query)
    );
  }

  filtered.sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;
    switch (sortField) {
      case 'guest_name':
        aVal = a.guest_name || '';
        bVal = b.guest_name || '';
        break;
      case 'room_number':
        aVal = a.room_number || '';
        bVal = b.room_number || '';
        break;
      case 'complimentary_nights':
        aVal = a.complimentary_nights || 0;
        bVal = b.complimentary_nights || 0;
        break;
      case 'status':
        aVal = a.status || '';
        bVal = b.status || '';
        break;
      default:
        aVal = new Date(a.created_at || 0).getTime();
        bVal = new Date(b.created_at || 0).getTime();
    }
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return filtered;
};
