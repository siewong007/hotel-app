import type { LegalDocumentId, LocalizedText } from './types';

/**
 * The wording next to each consent checkbox.
 *
 * Two rules hold across all of them, both PDPA requirements rather than style
 * choices: consent must be a positive act (so no box is ever pre-ticked), and
 * consent for a distinct purpose must be sought separately (so marketing is
 * never bundled into the terms checkbox — bundling is what makes consent
 * invalid, not merely impolite).
 *
 * `{terms}`, `{privacy}`, `{payment}` and `{ekyc}` are placeholders the
 * renderer replaces with links to the corresponding document.
 */
export interface ConsentPrompt {
  documentId: LegalDocumentId;
  /** A required consent blocks submission; an optional one never does. */
  required: boolean;
  label: LocalizedText;
  helper?: LocalizedText;
}

export const REGISTRATION_CONSENTS: ConsentPrompt[] = [
  {
    documentId: 'terms_of_service',
    required: true,
    label: {
      en: 'I have read and agree to the {terms}.',
      ms: 'Saya telah membaca dan bersetuju dengan {terms}.',
    },
  },
  {
    documentId: 'privacy_notice',
    required: true,
    label: {
      en: 'I have read the {privacy} and consent to my personal data being processed as described in it.',
      ms: 'Saya telah membaca {privacy} dan bersetuju data peribadi saya diproses sebagaimana diterangkan di dalamnya.',
    },
    helper: {
      en: 'This notice is given to you under section 7 of the Personal Data Protection Act 2010.',
      ms: 'Notis ini diberikan kepada anda di bawah seksyen 7 Akta Perlindungan Data Peribadi 2010.',
    },
  },
  {
    documentId: 'marketing',
    required: false,
    label: {
      en: 'Optional: send me offers, news and birthday rewards by email.',
      ms: 'Pilihan: hantarkan saya tawaran, berita dan ganjaran hari lahir melalui e-mel.',
    },
    helper: {
      en: 'You can unsubscribe at any time. Declining does not affect your booking or your price.',
      ms: 'Anda boleh berhenti melanggan pada bila-bila masa. Penolakan tidak menjejaskan tempahan atau harga anda.',
    },
  },
];

export const BOOKING_CONSENTS: ConsentPrompt[] = [
  {
    documentId: 'terms_of_service',
    required: true,
    label: {
      en: 'I have read and agree to the {terms}, including the cancellation and no-show terms.',
      ms: 'Saya telah membaca dan bersetuju dengan {terms}, termasuk terma pembatalan dan ketidakhadiran.',
    },
  },
  {
    documentId: 'privacy_notice',
    required: true,
    label: {
      en: 'I have read the {privacy} and consent to my personal data being processed to take and host this booking.',
      ms: 'Saya telah membaca {privacy} dan bersetuju data peribadi saya diproses untuk menerima dan menguruskan tempahan ini.',
    },
    helper: {
      en: 'Your name, email and guest type are needed to confirm the booking and assess Tourism Tax. Everything else is optional.',
      ms: 'Nama, e-mel dan jenis tetamu anda diperlukan untuk mengesahkan tempahan dan menaksir Cukai Pelancongan. Selain itu adalah pilihan.',
    },
  },
  {
    documentId: 'marketing',
    required: false,
    label: {
      en: 'Optional: send me offers and news by email.',
      ms: 'Pilihan: hantarkan saya tawaran dan berita melalui e-mel.',
    },
    helper: {
      en: 'You can unsubscribe at any time. Declining does not affect this booking or its price.',
      ms: 'Anda boleh berhenti melanggan pada bila-bila masa. Penolakan tidak menjejaskan tempahan ini atau harganya.',
    },
  },
];

export const PAYMENT_CONSENTS: ConsentPrompt[] = [
  {
    documentId: 'payment_terms',
    required: true,
    label: {
      en: 'I have read and accept the {payment}, and I authorise this payment for the amount shown.',
      ms: 'Saya telah membaca dan menerima {payment}, dan saya membenarkan pembayaran ini bagi amaun yang dipaparkan.',
    },
  },
];

export const EKYC_CONSENTS: ConsentPrompt[] = [
  {
    documentId: 'ekyc_biometric',
    required: true,
    label: {
      en: 'I explicitly consent to {ekyc}: the processing of my identity document and my facial image (biometric data) for the sole purpose of verifying my identity.',
      ms: 'Saya dengan nyata bersetuju dengan {ekyc}: pemprosesan dokumen pengenalan dan imej wajah saya (data biometrik) semata-mata bagi tujuan mengesahkan identiti saya.',
    },
    helper: {
      en: 'Sensitive personal data requires your explicit consent under section 40 of the Personal Data Protection Act 2010. This step is optional — you can verify at reception instead.',
      ms: 'Data peribadi sensitif memerlukan persetujuan nyata anda di bawah seksyen 40 Akta Perlindungan Data Peribadi 2010. Langkah ini adalah pilihan — anda boleh mengesahkan di kaunter penyambut tetamu sebagai gantian.',
    },
  },
];

/** Shown under a consent block so the guest knows the record is kept. */
export const CONSENT_RECORD_NOTE: LocalizedText = {
  en: 'We record the date, time and version of what you agreed to, so that both of us have a reliable record of it.',
  ms: 'Kami merekodkan tarikh, masa dan versi apa yang anda persetujui, supaya kedua-dua pihak mempunyai rekod yang boleh dipercayai.',
};
