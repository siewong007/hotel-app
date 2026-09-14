import type { Room } from '../../../../types';
import type { UseTranslationResult } from '../../../../i18n/useTranslation';
import type { RoomStatusType } from '../../config';
import {
  getLocalizedStatusShortLabel,
  getStatusCardFill,
  getUnifiedStatusColor,
} from '../../config';

export const getRoomStatusColor = (room: Room): string => getUnifiedStatusColor(room.status || 'available');

export const getRoomStatusLabel = (t: UseTranslationResult['t'], room: Room): string =>
  getLocalizedStatusShortLabel(t, room.status || 'available').toUpperCase();

export const getRoomCardFill = (status: string): string =>
  getStatusCardFill(status as RoomStatusType);
