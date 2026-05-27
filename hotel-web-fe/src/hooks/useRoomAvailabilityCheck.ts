import { useQuery } from '@tanstack/react-query';
import { HotelAPIService } from '../api';
import { useDebouncedValue } from './useDebouncedValue';

interface RoomAvailabilityResult {
  isAvailable: boolean | null;
  isChecking: boolean;
}

const ROOM_AVAILABILITY_STALE_TIME_MS = 30_000;

export const roomAvailabilityQueryKeys = {
  all: ['rooms', 'availability'] as const,
  byDates: (checkInDate: string, checkOutDate: string) =>
    [...roomAvailabilityQueryKeys.all, checkInDate, checkOutDate] as const,
};

export function useRoomAvailabilityCheck(
  roomId: string | number | null | undefined,
  checkInDate: string,
  checkOutDate: string,
  enabled: boolean
): RoomAvailabilityResult {
  const debouncedRoomId = useDebouncedValue(roomId, 400);
  const debouncedCheckInDate = useDebouncedValue(checkInDate, 400);
  const debouncedCheckOutDate = useDebouncedValue(checkOutDate, 400);
  const hasValidDates =
    Boolean(debouncedCheckInDate && debouncedCheckOutDate) &&
    new Date(debouncedCheckOutDate) > new Date(debouncedCheckInDate);
  const canCheck = enabled && Boolean(debouncedRoomId) && hasValidDates;

  const availabilityQuery = useQuery({
    queryKey: roomAvailabilityQueryKeys.byDates(debouncedCheckInDate, debouncedCheckOutDate),
    queryFn: () => HotelAPIService.getAvailableRoomsForDates(debouncedCheckInDate, debouncedCheckOutDate),
    enabled: canCheck,
    staleTime: ROOM_AVAILABILITY_STALE_TIME_MS,
  });

  const isDebouncing =
    enabled &&
    Boolean(roomId && checkInDate && checkOutDate) &&
    (debouncedRoomId !== roomId ||
      debouncedCheckInDate !== checkInDate ||
      debouncedCheckOutDate !== checkOutDate);

  if (!canCheck || availabilityQuery.isError) {
    return {
      isAvailable: null,
      isChecking: isDebouncing,
    };
  }

  return {
    isAvailable: availabilityQuery.data
      ? availabilityQuery.data.some((room) => String(room.id) === String(debouncedRoomId))
      : null,
    isChecking: availabilityQuery.isLoading || availabilityQuery.isFetching || isDebouncing,
  };
}
