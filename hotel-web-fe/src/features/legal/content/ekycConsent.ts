import { HOTEL_LEGAL_IDENTITY } from './hotelIdentity';
import type { LegalDocument, LocalizedText } from './types';

/**
 * Explicit consent for identity verification.
 *
 * The eKYC flow captures an identity document AND a selfie. A facial image is
 * biometric data, which the Personal Data Protection Act treats as SENSITIVE
 * personal data — s.40 requires the data subject's EXPLICIT consent, which is a
 * higher bar than the ordinary consent that covers a booking. That is why this
 * is a separate document with its own consent record rather than a line inside
 * the general privacy notice, and why the checkbox for it is never pre-ticked
 * and never bundled with the terms-of-service checkbox.
 */
export const EKYC_CONSENT_VERSION = '2026-09-09';

/** Points shown inline above the eKYC consent checkbox. */
export const EKYC_KEY_POINTS: LocalizedText[] = [
  {
    en: 'You are about to upload an identity document and a photograph of your face. Your facial image is biometric data, which the law treats as sensitive.',
    ms: 'Anda akan memuat naik dokumen pengenalan dan gambar wajah anda. Imej wajah anda adalah data biometrik, yang dianggap sensitif di sisi undang-undang.',
  },
  {
    en: 'We use it for one purpose only: to check that you are the person shown on the document. It is not used for advertising or profiling.',
    ms: 'Kami menggunakannya untuk satu tujuan sahaja: menyemak bahawa anda adalah individu yang ditunjukkan pada dokumen tersebut. Ia tidak digunakan untuk pengiklanan atau pemprofilan.',
  },
  {
    en: 'This is optional. You can book and stay with us without it, and you can withdraw this consent and ask us to delete the images at any time.',
    ms: 'Ini adalah pilihan. Anda boleh menempah dan menginap bersama kami tanpanya, dan anda boleh menarik balik persetujuan ini serta meminta kami memadamkan imej tersebut pada bila-bila masa.',
  },
];

export const ekycConsent: LegalDocument = {
  id: 'ekyc_biometric',
  version: EKYC_CONSENT_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Identity Verification — Consent to Process Sensitive Personal Data',
    ms: 'Pengesahan Identiti — Persetujuan Memproses Data Peribadi Sensitif',
  },
  summary: {
    en: 'Identity verification asks you for an identity document and a photograph of your face. Because a facial image is biometric data, and biometric data is sensitive personal data under the Personal Data Protection Act 2010, we may only process it with your explicit consent. This notice tells you exactly what you would be agreeing to.',
    ms: 'Pengesahan identiti meminta anda mengemukakan dokumen pengenalan dan gambar wajah anda. Oleh kerana imej wajah adalah data biometrik, dan data biometrik merupakan data peribadi sensitif di bawah Akta Perlindungan Data Peribadi 2010, kami hanya boleh memprosesnya dengan persetujuan nyata anda. Notis ini menerangkan dengan tepat apa yang anda persetujui.',
  },
  sections: [
    {
      id: 'what-we-take',
      heading: { en: '1. What we ask for', ms: '1. Apa yang kami minta' },
      bullets: [
        {
          en: 'Your identity document type, number, issuing country, and issue and expiry dates.',
          ms: 'Jenis dokumen pengenalan, nombor, negara pengeluaran, serta tarikh dikeluarkan dan tarikh luput.',
        },
        {
          en: 'An image of the front of the document, and of the back where the document has one.',
          ms: 'Imej bahagian hadapan dokumen, dan bahagian belakang sekiranya dokumen tersebut mempunyainya.',
        },
        {
          en: 'A photograph of your face (a selfie), used to compare against the photograph on the document.',
          ms: 'Gambar wajah anda (swafoto), digunakan untuk dibandingkan dengan gambar pada dokumen tersebut.',
        },
        {
          en: 'Optionally, a proof of address document if you choose to provide one.',
          ms: 'Sebagai pilihan, dokumen bukti alamat sekiranya anda memilih untuk memberikannya.',
        },
      ],
    },
    {
      id: 'purpose',
      heading: { en: '2. What we do with it', ms: '2. Apa yang kami lakukan dengannya' },
      body: [
        {
          en: 'We use it solely to verify your identity: to confirm the document is valid and that the person presenting it is the person it belongs to. This supports the guest register that hotel operators in Malaysia are required to keep, and helps us prevent booking fraud and identity misuse.',
          ms: 'Kami menggunakannya semata-mata untuk mengesahkan identiti anda: memastikan dokumen tersebut sah dan bahawa individu yang mengemukakannya adalah pemiliknya. Ini menyokong daftar tetamu yang wajib disimpan oleh pengendali hotel di Malaysia, dan membantu kami mencegah penipuan tempahan dan penyalahgunaan identiti.',
        },
        {
          en: 'We do not use your facial image to profile you, to track you between visits for marketing, or to train any automated system, and we do not sell or licence it to anyone.',
          ms: 'Kami tidak menggunakan imej wajah anda untuk memprofil anda, menjejaki anda antara kunjungan bagi tujuan pemasaran, atau melatih mana-mana sistem automatik, dan kami tidak menjual atau melesenkannya kepada sesiapa.',
        },
      ],
    },
    {
      id: 'who-sees-it',
      heading: { en: '3. Who can see it', ms: '3. Siapa yang boleh melihatnya' },
      body: [
        {
          en: 'Only staff whose role requires them to verify guest identity can open these documents, and every access is recorded in an audit trail. We disclose them outside the hotel only where the law compels us to, such as a lawful request from the police or a regulator.',
          ms: 'Hanya kakitangan yang peranannya memerlukan pengesahan identiti tetamu boleh membuka dokumen ini, dan setiap capaian direkodkan dalam jejak audit. Kami mendedahkannya di luar hotel hanya sekiranya undang-undang mewajibkan, seperti permintaan sah daripada polis atau pengawal selia.',
        },
      ],
    },
    {
      id: 'retention',
      heading: { en: '4. How long we keep it', ms: '4. Tempoh penyimpanan' },
      body: [
        {
          en: 'We keep the images only for as long as we need them to verify you and to satisfy the guest-register and tax obligations connected to your stay, and we delete them after that. The verification result — whether the check passed — is kept with your guest record for longer, because that is what we rely on.',
          ms: 'Kami menyimpan imej tersebut hanya selama yang diperlukan untuk mengesahkan anda dan memenuhi kewajipan daftar tetamu serta cukai berkaitan penginapan anda, dan kami memadamkannya selepas itu. Keputusan pengesahan — sama ada semakan berjaya — disimpan bersama rekod tetamu anda untuk tempoh lebih lama, kerana itulah yang kami jadikan sandaran.',
        },
      ],
    },
    {
      id: 'voluntary',
      heading: { en: '5. This is voluntary, and you can change your mind', ms: '5. Ini adalah sukarela, dan anda boleh berubah fikiran' },
      body: [
        {
          en: 'You do not have to verify your identity online. You can book, pay and stay without it, and you will not be charged more or offered less for declining. If you decline, we will simply sight your identification at reception when you arrive, as we do for every guest.',
          ms: 'Anda tidak perlu mengesahkan identiti anda dalam talian. Anda boleh menempah, membayar dan menginap tanpanya, dan anda tidak akan dikenakan caj lebih tinggi atau ditawarkan kurang kerana menolaknya. Sekiranya anda menolak, kami akan menyemak dokumen pengenalan anda di kaunter penyambut tetamu semasa ketibaan, sebagaimana yang kami lakukan bagi setiap tetamu.',
        },
        {
          en: `You may withdraw this consent at any time by contacting ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. We will stop processing the images and delete them, unless a law requires us to keep them. Withdrawal does not undo processing that has already lawfully taken place.`,
          ms: `Anda boleh menarik balik persetujuan ini pada bila-bila masa dengan menghubungi ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. Kami akan berhenti memproses imej tersebut dan memadamkannya, melainkan undang-undang mewajibkan kami menyimpannya. Penarikan balik tidak membatalkan pemprosesan yang telah dilakukan secara sah sebelum itu.`,
        },
      ],
    },
  ],
};
