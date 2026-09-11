/**
 * Legal identity of the data controller / service provider.
 *
 * These are the details that must appear in a PDPA s.7 notice and in consumer
 * contract terms. With one exception they are deliberately NOT read from
 * `system_settings`: the operational settings a manager can edit in the admin
 * UI must not be able to silently rewrite the identity of the legal entity a
 * guest contracted with, or the address a PDPA access request has to be sent
 * to.
 *
 * The exception is `companyRegistrationNumber`, which `getHotelLegalIdentity()`
 * resolves from the `hotel_business_number` setting. It is the one field an
 * operator has a legitimate reason to correct without a release — an SSM number
 * is reissued when the entity re-registers, and a wrong one is a disclosure
 * breach the hotel cannot fix on its own otherwise. The constant below stays the
 * compiled-in fallback, so a blank or unreachable setting degrades to the real
 * number rather than to nothing.
 */
import { getHotelSettings } from '../../../utils/hotelSettings';

export interface HotelLegalIdentity {
  tradingName: string;
  registeredName: string;
  companyRegistrationNumber: string;
  addressLines: readonly string[];
  email: string;
  phone: string;
  dataProtectionContactEmail: string;
  receptionHours: string;
}

export const HOTEL_LEGAL_IDENTITY: HotelLegalIdentity = {
  tradingName: 'Salim Inn',
  /** REVIEW: confirm the registered entity name exactly as it appears on the SSM certificate. */
  registeredName: 'Salim Inn',
  /**
   * Fallback only. The live value is the `hotel_business_number` setting —
   * read it through `getHotelLegalIdentity()`, never from this constant, so an
   * operator's correction is what a guest actually sees.
   */
  companyRegistrationNumber: 'SA2012724',
  addressLines: [
    'Lot 21-22, Lorong Salim 17',
    'Farley Commercial Centre',
    'Sibu, Sarawak',
    'Malaysia',
  ],
  email: 'saliminnsibu@gmail.com',
  phone: '+60 11-1050 7083',
  /**
   * PDPA (Amendment) Act 2024 obliges a data controller to appoint and publish a
   * data protection officer contact. Until a named DPO exists this routes to the
   * hotel's general mailbox, which satisfies "a contact point" but should be
   * replaced with a dedicated address.
   */
  dataProtectionContactEmail: 'saliminnsibu@gmail.com',
  receptionHours: '24 hours',
} as const;

export const HOTEL_ADDRESS_ONE_LINE = HOTEL_LEGAL_IDENTITY.addressLines.join(', ');

/**
 * The legal identity with the configured business registration number applied.
 *
 * `getHotelSettings()` is a synchronous localStorage read, refreshed at boot by
 * `applyPublicHotelSettings()` from the unauthenticated `settings/public`
 * endpoint — which is why `hotel_business_number` is seeded `is_public`. A
 * browser that has never reached the backend, or a setting saved blank, falls
 * back to the constant above.
 */
export function getHotelLegalIdentity(): HotelLegalIdentity {
  const configured = getHotelSettings().hotel_business_number?.trim();
  if (!configured) return HOTEL_LEGAL_IDENTITY;
  return { ...HOTEL_LEGAL_IDENTITY, companyRegistrationNumber: configured };
}
