import { useState, useCallback } from 'react';
import { Room, RoomType } from '../../../types';
import { HotelAPIService } from '../../../api';
import { GuestWithCredits } from '../components/GuestSelector';

export function useUnifiedBookingData() {
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingAvailableRooms, setLoadingAvailableRooms] = useState(false);
  const [roomTypeConfig, setRoomTypeConfig] = useState<RoomType | null>(null);

  const loadGuestsWithCredits = useCallback(async () => {
    setLoadingGuestsWithCredits(true);
    try {
      const response = await HotelAPIService.getMyGuestsWithCredits();
      setGuestsWithCredits(response.filter((g: GuestWithCredits) => g.total_complimentary_credits > 0));
    } catch (error) {
      console.error('Failed to load guests with credits:', error);
    } finally {
      setLoadingGuestsWithCredits(false);
    }
  }, []);

  const loadAvailableRooms = useCallback(async (
    checkInDate: string,
    checkOutDate: string,
    sortRooms: (rooms: Room[]) => Room[],
    fallbackRooms: Room[]
  ) => {
    setLoadingAvailableRooms(true);
    try {
      const available = await HotelAPIService.getAvailableRoomsForDates(checkInDate, checkOutDate);
      setAvailableRooms(sortRooms(available));
    } catch (error) {
      console.error('Failed to fetch available rooms:', error);
      setAvailableRooms(sortRooms(fallbackRooms));
    } finally {
      setLoadingAvailableRooms(false);
    }
  }, []);

  const loadRoomTypeConfig = useCallback(async (roomTypeName: string | undefined) => {
    if (!roomTypeName) return;
    try {
      const roomTypes = await HotelAPIService.getAllRoomTypes();
      const matched = roomTypes.find((rt: RoomType) => rt.name === roomTypeName);
      setRoomTypeConfig(matched || null);
    } catch {
      setRoomTypeConfig(null);
    }
  }, []);

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
