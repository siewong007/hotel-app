import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Room, RoomType } from '../../../types';
import { GuestsService, RoomsService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import { GuestWithCredits } from '../components/GuestSelector';

export function useUnifiedBookingData() {
  const queryClient = useQueryClient();
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingAvailableRooms, setLoadingAvailableRooms] = useState(false);
  const [roomTypeConfig, setRoomTypeConfig] = useState<RoomType | null>(null);

  const loadGuestsWithCredits = useCallback(async () => {
    setLoadingGuestsWithCredits(true);
    try {
      const response = await queryClient.ensureQueryData({
        queryKey: queryKeys.guests.mineWithCredits(),
        queryFn: () => GuestsService.getMyGuestsWithCredits(),
        staleTime: 60_000,
      });
      setGuestsWithCredits(response.filter((g: GuestWithCredits) => g.total_complimentary_credits > 0));
    } catch (error) {
      console.error('Failed to load guests with credits:', error);
    } finally {
      setLoadingGuestsWithCredits(false);
    }
  }, [queryClient]);

  const loadAvailableRooms = useCallback(async (
    checkInDate: string,
    checkOutDate: string,
    sortRooms: (rooms: Room[]) => Room[],
    fallbackRooms: Room[]
  ) => {
    setLoadingAvailableRooms(true);
    try {
      const available = await queryClient.ensureQueryData({
        queryKey: queryKeys.rooms.available(checkInDate, checkOutDate),
        queryFn: () => RoomsService.getAvailableRoomsForDates(checkInDate, checkOutDate),
        staleTime: 30_000,
      });
      setAvailableRooms(sortRooms(available));
    } catch (error) {
      console.error('Failed to fetch available rooms:', error);
      setAvailableRooms(sortRooms(fallbackRooms));
    } finally {
      setLoadingAvailableRooms(false);
    }
  }, [queryClient]);

  const loadRoomTypeConfig = useCallback(async (roomTypeName: string | undefined) => {
    if (!roomTypeName) return;
    try {
      const roomTypes = await queryClient.ensureQueryData({
        queryKey: queryKeys.roomTypes.list(),
        queryFn: () => RoomsService.getAllRoomTypes(),
        staleTime: 5 * 60_000,
      });
      const matched = roomTypes.find((rt: RoomType) => rt.name === roomTypeName);
      setRoomTypeConfig(matched || null);
    } catch {
      setRoomTypeConfig(null);
    }
  }, [queryClient]);

  return {
    guestsWithCredits,
    loadingGuestsWithCredits,
    availableRooms,
    setAvailableRooms,
    loadingAvailableRooms,
    roomTypeConfig,
    setRoomTypeConfig,
    loadGuestsWithCredits,
    loadAvailableRooms,
    loadRoomTypeConfig,
  };
}
