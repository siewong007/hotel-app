import type { Room } from '../../../../types';
import type { RoomStatusType } from '../../config';
import {
  getStatusCardFill,
  getUnifiedStatusColor,
  getUnifiedStatusShortLabel,
} from '../../config';

export const getRoomStatusColor = (room: Room): string => getUnifiedStatusColor(room.status || 'available');

export const getRoomStatusLabel = (room: Room): string =>
  getUnifiedStatusShortLabel(room.status || 'available').toUpperCase();

export const getRoomCardFill = (status: string): string =>
  getStatusCardFill(status as RoomStatusType);
