import type { Room } from '../../../../types';
import { getUnifiedStatusColor, getUnifiedStatusShortLabel } from '../../config';

const ROOM_FILL_DARK: Record<string, string> = {
  available: '#2E7D4F',
  occupied: '#B25E18',
  reserved: '#1E5A8A',
  dirty: '#8A6E1D',
  maintenance: '#4D5358',
};

export const getRoomStatusColor = (room: Room): string => getUnifiedStatusColor(room.status || 'available');

export const getRoomStatusLabel = (room: Room): string =>
  getUnifiedStatusShortLabel(room.status || 'available').toUpperCase();

export const getRoomCardFill = (
  status: string,
  statusColor: string,
  isDarkMode: boolean,
): string => {
  if (isDarkMode) return ROOM_FILL_DARK[status] || ROOM_FILL_DARK.available;
  return status === 'dirty' ? '#a89436' : statusColor;
};
