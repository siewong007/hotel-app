/**
 * Legal identity of the data controller / service provider.
 *
 * These are the details that must appear in a PDPA s.7 notice and in consumer
 * contract terms. They are deliberately NOT read from `system_settings`: the
 * operational settings a manager can edit in the admin UI must not be able to
 * silently rewrite the identity of the legal entity a guest contracted with, or
 * the address a PDPA access request has to be sent to.
 *
 * REVIEW BEFORE LAUNCH: `companyRegistrationNumber` is a placeholder. Malaysian
 * consumer and e-commerce disclosure (Electronic Commerce Act 2006 s.10 and the
 * Consumer Protection (Electronic Trade Transactions) Regulations 2012 r.3)
 * require the supplier's registered name and registration number to be shown to
 * an online buyer. Replace it with the hotel's SSM number.
 */
export const HOTEL_LEGAL_IDENTITY = {
  tradingName: 'Salim Inn',
  /** REVIEW: confirm the registered entity name exactly as it appears on the SSM certificate. */
  registeredName: 'Salim Inn',
  /** REVIEW: replace with the real SSM company/business registration number. */
  companyRegistrationNumber: 'REGISTRATION-NUMBER-PENDING',
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
