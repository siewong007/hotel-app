import { useState, useEffect, useRef } from 'react';
import { HotelAPIService } from '../api';

interface RoomAvailabilityResult {
  isAvailable: boolean | null;
  isChecking: boolean;
}

export function useRoomAvailabilityCheck(
  roomId: string | number | null | undefined,
  checkInDate: string,
  checkOutDate: string,
  enabled: boolean
): RoomAvailabilityResult {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !roomId || !checkInDate || !checkOutDate) {
      setIsAvailable(null);
      setIsChecking(false);
      return;
    }

    if (new Date(checkOutDate) <= new Date(checkInDate)) {
      setIsAvailable(null);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    setIsAvailable(null);

    const timer = setTimeout(async () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const available = await HotelAPIService.getAvailableRoomsForDates(checkInDate, checkOutDate);
        if (!abortControllerRef.current.signal.aborted) {
          setIsAvailable(available.some((r) => String(r.id) === String(roomId)));
          setIsChecking(false);
        }
      } catch {
        if (!abortControllerRef.current?.signal.aborted) {
          setIsAvailable(null);
          setIsChecking(false);
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      abortControllerRef.current?.abort();
    };
  }, [roomId, checkInDate, checkOutDate, enabled]);

  return { isAvailable, isChecking };
}
