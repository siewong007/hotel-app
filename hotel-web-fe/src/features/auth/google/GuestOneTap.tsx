/**
 * Mounts Google One Tap for the guest bundle.
 *
 * Lives at the guest root so the prompt survives navigation between guest pages
 * instead of being torn down and re-raised by each one, and so the decision
 * about *where* it may appear is made in a single place
 * (`googleOneTapSurface`) rather than sprinkled through page components.
 *
 * Renders nothing until a first-time Google identity needs the notice, which is
 * the one thing this component draws: the account cannot be created before that
 * sentence has been on screen, and Google's own prompt has nowhere to put it.
 */

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from '../../../i18n';
import { ConsentNotice } from '../../legal/components/ConsentNotice';
import { REGISTRATION_NOTICE } from '../../legal/content';
import { GUEST_BOOKING_REDIRECT } from '../guestRedirect';
import { googleOneTapSurface } from './oneTapSurfaces';
import { useGoogleOneTap } from './useGoogleOneTap';

export interface GuestOneTapProps {
  pathname: string;
  search: string;
}

export function GuestOneTap({ pathname, search }: GuestOneTapProps) {
  const { t } = useTranslation('auth');
  const surface = googleOneTapSurface(pathname, search);
  const { consentPending, confirmConsent, dismissConsent } = useGoogleOneTap({
    enabled: surface !== null,
    // A guest signing in part-way through booking, whose profile turns out to
    // be incomplete, must come back to the booking flow afterwards rather than
    // being dropped on the dashboard with their search abandoned. From the
    // offers page there is nothing to come back to, so the dashboard is right.
    completeProfileRedirect: surface === 'booking' ? GUEST_BOOKING_REDIRECT : null,
  });

  if (!consentPending) return null;

  return (
    <Dialog open onClose={dismissConsent} maxWidth="sm" fullWidth>
      <DialogTitle>{t('login.googleFirstTimeTitle')}</DialogTitle>
      <DialogContent>
        {/* The notice is the consent: pressing Continue below is the act it
            governs, exactly as on the sign-in page. */}
        <ConsentNotice notice={REGISTRATION_NOTICE} />
      </DialogContent>
      <DialogActions>
        <Button onClick={dismissConsent}>{t('login.googleFirstTimeCancel')}</Button>
        <Button onClick={confirmConsent} variant="contained">
          {t('login.googleFirstTimeConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default GuestOneTap;
