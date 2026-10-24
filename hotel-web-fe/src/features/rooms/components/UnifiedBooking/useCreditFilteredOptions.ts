import { useMemo } from 'react';
import type { Room } from '../../../../types';
import type { GuestWithCredits } from '../GuestSelector';
import { canCoverRoomsWithCredits } from '../../utils/roomManagementUtils';

interface CreditFilterInput {
  guestsWithCredits: GuestWithCredits[];
  availableRooms: Room[];
  selectedBookingRooms: Room[];
  selectedGuestWithCredits: GuestWithCredits | null;
  isComplimentaryFlow: boolean;
  loadingGuestsWithCredits: boolean;
  requiredCreditNights: number;
}

/**
 * Complimentary bookings: the guests whose credits can cover the selected
 * rooms, and the rooms that the chosen (or any eligible) guest could still
 * add. Kept in its own hook so its memoization is analysed apart from the
 * booking modal.
 */
export function useCreditFilteredOptions({
  guestsWithCredits,
  availableRooms,
  selectedBookingRooms,
  selectedGuestWithCredits,
  isComplimentaryFlow,
  loadingGuestsWithCredits,
  requiredCreditNights,
}: CreditFilterInput) {
  const creditFilteredGuests = useMemo(() => {
    const candidates = guestsWithCredits.filter((guest) => guest.total_complimentary_credits > 0);
    if (!isComplimentaryFlow || selectedBookingRooms.length === 0) return candidates;

    return candidates.filter((guest) => (
      canCoverRoomsWithCredits(guest, selectedBookingRooms, requiredCreditNights)
    ));
  }, [guestsWithCredits, isComplimentaryFlow, selectedBookingRooms, requiredCreditNights]);

  const creditFilteredAvailableRooms = useMemo(() => {
    if (!isComplimentaryFlow) return availableRooms;

    return availableRooms.filter((availableRoom) => {
      const alreadySelected = selectedBookingRooms.some((selected) => String(selected.id) === String(availableRoom.id));
      const roomsToCover = alreadySelected
        ? selectedBookingRooms
        : [...selectedBookingRooms, availableRoom];

      if (selectedGuestWithCredits) {
        return canCoverRoomsWithCredits(selectedGuestWithCredits, roomsToCover, requiredCreditNights);
      }

      if (loadingGuestsWithCredits) return true;

      return creditFilteredGuests.some((guest) => (
        canCoverRoomsWithCredits(guest, roomsToCover, requiredCreditNights)
      ));
    });
  }, [
    availableRooms,
    isComplimentaryFlow,
    selectedBookingRooms,
    selectedGuestWithCredits,
    loadingGuestsWithCredits,
    creditFilteredGuests,
    requiredCreditNights,
  ]);

  return { creditFilteredGuests, creditFilteredAvailableRooms };
}
