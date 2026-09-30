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
 *
 * zh/zh-TW copy: DRAFT — pending native/legal review.
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
      zh: '我已阅读并同意{terms}。',
      'zh-TW': '我已閱讀並同意{terms}。',
    },
  },
  {
    documentId: 'privacy_notice',
    required: true,
    label: {
      en: 'I have read the {privacy} and consent to my personal data being processed as described in it.',
      ms: 'Saya telah membaca {privacy} dan bersetuju data peribadi saya diproses sebagaimana diterangkan di dalamnya.',
      zh: '我已阅读{privacy}，并同意按其中所述处理我的个人资料。',
      'zh-TW': '我已閱讀{privacy}，並同意按其中所述處理我的個人資料。',
    },
    helper: {
      en: 'This notice is given to you under section 7 of the Personal Data Protection Act 2010.',
      ms: 'Notis ini diberikan kepada anda di bawah seksyen 7 Akta Perlindungan Data Peribadi 2010.',
      zh: '本通知依据《2010年个人资料保护法令》第7条向您发出。',
      'zh-TW': '本通知依據《2010年個人資料保護法令》第7條向您發出。',
    },
  },
  {
    documentId: 'marketing',
    required: false,
    label: {
      en: 'Optional: send me offers and news by email.',
      ms: 'Pilihan: hantarkan saya tawaran dan berita melalui e-mel.',
      zh: '可选：通过电子邮件向我发送优惠与消息。',
      'zh-TW': '可選：透過電子郵件向我發送優惠與消息。',
    },
    helper: {
      en: 'You can unsubscribe at any time. Declining does not affect your booking or your price.',
      ms: 'Anda boleh berhenti melanggan pada bila-bila masa. Penolakan tidak menjejaskan tempahan atau harga anda.',
      zh: '您可以随时取消订阅。拒绝不会影响您的预订或房价。',
      'zh-TW': '您可以隨時取消訂閱。拒絕不會影響您的預訂或房價。',
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
      zh: '我已阅读并同意{terms}，包括取消及未入住条款。',
      'zh-TW': '我已閱讀並同意{terms}，包括取消及未入住條款。',
    },
  },
  {
    documentId: 'privacy_notice',
    required: true,
    label: {
      en: 'I have read the {privacy} and consent to my personal data being processed to take and host this booking.',
      ms: 'Saya telah membaca {privacy} dan bersetuju data peribadi saya diproses untuk menerima dan menguruskan tempahan ini.',
      zh: '我已阅读{privacy}，并同意为承接及安排本次预订而处理我的个人资料。',
      'zh-TW': '我已閱讀{privacy}，並同意為承接及安排本次預訂而處理我的個人資料。',
    },
    helper: {
      en: 'Your name, email and guest type are needed to confirm the booking and assess Tourism Tax. Everything else is optional.',
      ms: 'Nama, e-mel dan jenis tetamu anda diperlukan untuk mengesahkan tempahan dan menaksir Cukai Pelancongan. Selain itu adalah pilihan.',
      zh: '确认预订及核算旅游税需要您的姓名、电子邮件与旅客类型，其余均为选填。',
      'zh-TW': '確認預訂及核算旅遊稅需要您的姓名、電子郵件與旅客類型，其餘均為選填。',
    },
  },
  {
    documentId: 'marketing',
    required: false,
    label: {
      en: 'Optional: send me offers and news by email.',
      ms: 'Pilihan: hantarkan saya tawaran dan berita melalui e-mel.',
      zh: '可选：通过电子邮件向我发送优惠与消息。',
      'zh-TW': '可選：透過電子郵件向我發送優惠與消息。',
    },
    helper: {
      en: 'You can unsubscribe at any time. Declining does not affect this booking or its price.',
      ms: 'Anda boleh berhenti melanggan pada bila-bila masa. Penolakan tidak menjejaskan tempahan ini atau harganya.',
      zh: '您可以随时取消订阅。拒绝不会影响本次预订或价格。',
      'zh-TW': '您可以隨時取消訂閱。拒絕不會影響本次預訂或價格。',
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
      zh: '我已阅读并接受{payment}，并授权支付所示金额。',
      'zh-TW': '我已閱讀並接受{payment}，並授權支付所示金額。',
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
      zh: '我明确同意{ekyc}：仅为核实我的身份而处理我的身份证件及面部影像（生物识别资料）。',
      'zh-TW': '我明確同意{ekyc}：僅為核實我的身分而處理我的身分證件及面部影像（生物識別資料）。',
    },
    helper: {
      en: 'Sensitive personal data requires your explicit consent under section 40 of the Personal Data Protection Act 2010. This step is optional — you can verify at reception instead.',
      ms: 'Data peribadi sensitif memerlukan persetujuan nyata anda di bawah seksyen 40 Akta Perlindungan Data Peribadi 2010. Langkah ini adalah pilihan — anda boleh mengesahkan di kaunter penyambut tetamu sebagai gantian.',
      zh: '根据《2010年个人资料保护法令》第40条，敏感个人资料需要您的明确同意。此步骤为可选——您也可以在前台进行验证。',
      'zh-TW': '根據《2010年個人資料保護法令》第40條，敏感個人資料需要您的明確同意。此步驟為可選——您也可以在前台進行驗證。',
    },
  },
];

/** Shown under a consent block so the guest knows the record is kept. */
export const CONSENT_RECORD_NOTE: LocalizedText = {
  en: 'We record the date, time and version of what you agreed to, so that both of us have a reliable record of it.',
  ms: 'Kami merekodkan tarikh, masa dan versi apa yang anda persetujui, supaya kedua-dua pihak mempunyai rekod yang boleh dipercayai.',
  zh: '我们会记录您同意内容的日期、时间与版本，以便双方保有可靠记录。',
  'zh-TW': '我們會記錄您同意內容的日期、時間與版本，以便雙方保有可靠記錄。',
};
