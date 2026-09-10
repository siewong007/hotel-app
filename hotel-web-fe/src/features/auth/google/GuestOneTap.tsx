/**
 * Mounts Google One Tap for the guest bundle. Renders nothing.
 *
 * Lives at the guest root so the prompt survives navigation between guest pages
 * instead of being torn down and re-raised by each one, and so the decision
 * about *where* it may appear is made in a single place
 * (`googleOneTapSurface`) rather than sprinkled through page components.
 */

import { GUEST_BOOKING_REDIRECT } from '../guestRedirect';
import { googleOneTapSurface } from './oneTapSurfaces';
import { useGoogleOneTap } from './useGoogleOneTap';

export interface GuestOneTapProps {
  pathname: string;
  search: string;
}

export function GuestOneTap({ pathname, search }: GuestOneTapProps) {
  const surface = googleOneTapSurface(pathname, search);
  useGoogleOneTap({
    enabled: surface !== null,
    // A guest signing in part-way through booking, whose profile turns out to
    // be incomplete, must come back to the booking flow afterwards rather than
    // being dropped on the dashboard with their search abandoned. From the
    // offers page there is nothing to come back to, so the dashboard is right.
    completeProfileRedirect: surface === 'booking' ? GUEST_BOOKING_REDIRECT : null,
  });
  return null;
}

export default GuestOneTap;
