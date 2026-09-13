import { HOTEL_LEGAL_IDENTITY } from './hotelIdentity';
import type { LegalDocument, LocalizedText } from './types';

/**
 * Payment terms shown at the point of payment.
 *
 * Every statement here is a description of what the payment flow actually
 * does, not an aspiration:
 *  - the charged amount is derived server-side from the booking and never
 *    accepted from the client (see the note in GuestCheckInForm and the
 *    guest-portal payment handlers), which is why clause 2 promises the guest
 *    the displayed total is the booking total;
 *  - card and PayPal payments are handed to the PayPal SDK, so the hotel never
 *    receives card numbers (clause 4);
 *  - a bank transfer is a CLAIM that a member of staff verifies afterwards via
 *    the payment-approvals queue, so it is not instantaneous confirmation
 *    (clause 5) — this is the single most misunderstood step in the flow and is
 *    stated plainly for that reason.
 */
export const PAYMENT_TERMS_VERSION = '2026-09-09';

/**
 * A short, scannable summary rendered inline beside the payment control. The
 * full document remains one click away; this is what most guests actually read.
 */
export const PAYMENT_KEY_POINTS: LocalizedText[] = [
  {
    en: 'The amount shown is the full amount for this booking, including any taxes already listed on your quote. We never take an amount from your browser — it is calculated from your booking on our server.',
    ms: 'Jumlah yang dipaparkan adalah amaun penuh bagi tempahan ini, termasuk sebarang cukai yang telah disenaraikan pada sebut harga anda. Kami tidak sekali-kali mengambil amaun daripada pelayar anda — ia dikira daripada tempahan anda pada pelayan kami.',
  },
  {
    en: 'Card and PayPal payments are processed by PayPal. Your card details are entered on PayPal and are never seen or stored by the hotel.',
    ms: 'Pembayaran kad dan PayPal diproses oleh PayPal. Butiran kad anda dimasukkan pada PayPal dan tidak sekali-kali dilihat atau disimpan oleh hotel.',
  },
  {
    en: 'A bank transfer is confirmed by our staff after we can see the funds. Your booking stays unconfirmed until then, so transfer early and upload your receipt to speed this up.',
    ms: 'Pindahan bank disahkan oleh kakitangan kami selepas kami dapat melihat dana tersebut. Tempahan anda kekal belum disahkan sehingga itu, jadi buat pindahan lebih awal dan muat naik resit anda untuk mempercepatkannya.',
  },
  {
    en: 'Cancelling at least three days before arrival may qualify for a refund. Later than that, or if you do not arrive, the first night may be charged.',
    ms: 'Pembatalan sekurang-kurangnya tiga hari sebelum ketibaan mungkin layak untuk bayaran balik. Lewat daripada itu, atau sekiranya anda tidak hadir, malam pertama boleh dikenakan caj.',
  },
];

export const paymentTerms: LegalDocument = {
  id: 'payment_terms',
  version: PAYMENT_TERMS_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Payment Terms',
    ms: 'Terma Pembayaran',
  },
  summary: {
    en: 'These terms explain what you are paying, how each payment method works, when your booking becomes confirmed, and how refunds are handled. They apply in addition to our Booking Terms and Conditions.',
    ms: 'Terma ini menerangkan apa yang anda bayar, cara setiap kaedah pembayaran berfungsi, bila tempahan anda disahkan, dan cara bayaran balik dikendalikan. Ia terpakai sebagai tambahan kepada Terma dan Syarat Tempahan kami.',
  },
  sections: [
    {
      id: 'what-you-pay',
      heading: { en: '1. What you are paying', ms: '1. Apa yang anda bayar' },
      emphasis: 'requirement',
      body: [
        {
          en: 'The amount presented to you is the total for the booking shown: the room rate for every night of the stay, plus any taxes and levies itemised on your quote. Tourism Tax is included in that total where it applies to you.',
          ms: 'Amaun yang dipaparkan kepada anda adalah jumlah keseluruhan bagi tempahan yang ditunjukkan: kadar bilik bagi setiap malam penginapan, serta sebarang cukai dan levi yang diperincikan pada sebut harga anda. Cukai Pelancongan termasuk dalam jumlah tersebut sekiranya ia terpakai kepada anda.',
        },
        {
          en: 'The amount is calculated by us from your booking at the moment you pay. It is not taken from your browser, so a price cannot be altered on your device. If the amount displayed ever differs from what you expect, stop and contact reception before paying.',
          ms: 'Amaun tersebut dikira oleh kami daripada tempahan anda pada masa anda membayar. Ia tidak diambil daripada pelayar anda, jadi harga tidak boleh diubah pada peranti anda. Sekiranya amaun yang dipaparkan berbeza daripada jangkaan anda, hentikan dan hubungi kaunter penyambut tetamu sebelum membayar.',
        },
        {
          en: 'Charges you incur during the stay, such as late check-out or damage, are separate and are settled with the hotel directly on departure.',
          ms: 'Caj yang ditanggung sepanjang penginapan, seperti daftar keluar lewat atau kerosakan, adalah berasingan dan diselesaikan terus dengan hotel semasa daftar keluar.',
        },
      ],
    },
    {
      id: 'currency',
      heading: { en: '2. Currency and your bank', ms: '2. Mata wang dan bank anda' },
      body: [
        {
          en: 'Payments are taken in the currency shown on your quote. If your card or bank account is held in a different currency, your bank or PayPal sets the exchange rate and may add a conversion or international transaction fee. That fee is charged by them, not by us, and is not part of the amount we receive.',
          ms: 'Pembayaran diterima dalam mata wang yang dipaparkan pada sebut harga anda. Sekiranya kad atau akaun bank anda dalam mata wang berbeza, bank anda atau PayPal menetapkan kadar pertukaran dan mungkin mengenakan fi penukaran atau transaksi antarabangsa. Fi tersebut dikenakan oleh mereka, bukan oleh kami, dan bukan sebahagian daripada amaun yang kami terima.',
        },
      ],
    },
    {
      id: 'when-confirmed',
      heading: { en: '3. When your booking is confirmed', ms: '3. Bila tempahan anda disahkan' },
      emphasis: 'requirement',
      body: [
        {
          en: 'Your booking is confirmed when we have received full payment and matched it to your reservation. Until that happens the room is held but not guaranteed, and an unpaid online booking may be released automatically once its holding period expires.',
          ms: 'Tempahan anda disahkan apabila kami telah menerima bayaran penuh dan memadankannya dengan tempahan anda. Sehingga itu, bilik ditahan tetapi tidak dijamin, dan tempahan dalam talian yang belum dibayar boleh dilepaskan secara automatik sebaik tempoh tahanannya tamat.',
        },
      ],
    },
    {
      id: 'card-and-paypal',
      heading: { en: '4. Paying by card or PayPal', ms: '4. Pembayaran dengan kad atau PayPal' },
      body: [
        {
          en: 'Card and PayPal payments are processed by PayPal. You enter your card or PayPal credentials directly with PayPal; the hotel does not see, receive or store your card number, expiry date or security code. PayPal handles that data under its own user agreement and privacy statement, which apply to that part of the transaction.',
          ms: 'Pembayaran kad dan PayPal diproses oleh PayPal. Anda memasukkan butiran kad atau PayPal anda terus kepada PayPal; hotel tidak melihat, menerima atau menyimpan nombor kad, tarikh luput atau kod keselamatan anda. PayPal mengendalikan data tersebut di bawah perjanjian pengguna dan pernyataan privasi mereka sendiri, yang terpakai bagi bahagian transaksi tersebut.',
        },
        {
          en: 'What we record is the outcome: the amount, the method, the status, and PayPal’s reference for the transaction, so that we can match it to your booking and answer questions about it later.',
          ms: 'Apa yang kami rekodkan adalah hasilnya: amaun, kaedah, status, dan rujukan PayPal bagi transaksi tersebut, supaya kami dapat memadankannya dengan tempahan anda dan menjawab pertanyaan mengenainya kemudian.',
        },
        {
          en: 'Do not close or refresh the page while a payment is being authorised. If a payment appears to fail, check your email or account before trying again, so you do not pay twice.',
          ms: 'Jangan tutup atau muat semula halaman semasa pembayaran sedang disahkan. Sekiranya pembayaran kelihatan gagal, semak e-mel atau akaun anda sebelum mencuba lagi, supaya anda tidak membayar dua kali.',
        },
      ],
    },
    {
      id: 'bank-transfer',
      heading: { en: '5. Paying by bank transfer', ms: '5. Pembayaran melalui pindahan bank' },
      emphasis: 'requirement',
      body: [
        {
          en: 'A bank transfer is not confirmed instantly. When you submit a bank transfer you are telling us that you have made, or will make, a transfer to the account shown. A member of our staff then checks it against our bank records and approves it. Your booking remains unconfirmed until that check is complete.',
          ms: 'Pindahan bank tidak disahkan serta-merta. Apabila anda menghantar pindahan bank, anda memberitahu kami bahawa anda telah membuat, atau akan membuat, pindahan ke akaun yang ditunjukkan. Kakitangan kami kemudian menyemaknya berdasarkan rekod bank kami dan meluluskannya. Tempahan anda kekal belum disahkan sehingga semakan tersebut selesai.',
        },
        {
          en: 'Transfer the exact amount, use the reference we give you, and upload your transfer receipt. An incorrect amount or a missing reference is the most common reason a transfer cannot be matched and a booking lapses.',
          ms: 'Pindahkan amaun yang tepat, gunakan rujukan yang kami berikan, dan muat naik resit pindahan anda. Amaun yang salah atau rujukan yang tiada adalah punca paling lazim pindahan tidak dapat dipadankan dan tempahan terlepas.',
        },
        {
          en: 'A receipt you upload is used only to verify your payment and is stored with your payment record. Please do not upload a document containing more personal information than the transfer itself requires.',
          ms: 'Resit yang anda muat naik digunakan hanya untuk mengesahkan pembayaran anda dan disimpan bersama rekod pembayaran anda. Sila jangan muat naik dokumen yang mengandungi maklumat peribadi melebihi keperluan pindahan tersebut.',
        },
      ],
    },
    {
      id: 'refunds',
      heading: { en: '6. Refunds', ms: '6. Bayaran balik' },
      body: [
        {
          en: 'Where a refund is due under our cancellation terms, we return it to the method you paid with. A card or PayPal refund goes back to the same card or PayPal account; a bank transfer is refunded to the account it came from, and we may need your bank details to do so.',
          ms: 'Sekiranya bayaran balik wajar di bawah terma pembatalan kami, kami akan mengembalikannya melalui kaedah yang anda gunakan untuk membayar. Bayaran balik kad atau PayPal dikembalikan ke kad atau akaun PayPal yang sama; pindahan bank dikembalikan ke akaun asalnya, dan kami mungkin memerlukan butiran bank anda untuk berbuat demikian.',
        },
        {
          en: 'Refunds are processed by us promptly, but the time it takes to appear depends on your bank or card issuer and is outside our control. Any conversion loss where your account is in another currency is not something we can reimburse.',
          ms: 'Bayaran balik diproses oleh kami dengan segera, tetapi tempoh untuk ia muncul bergantung pada bank atau pengeluar kad anda dan berada di luar kawalan kami. Sebarang kerugian penukaran sekiranya akaun anda dalam mata wang lain bukan sesuatu yang boleh kami ganti.',
        },
      ],
    },
    {
      id: 'problems',
      heading: { en: '7. If something goes wrong', ms: '7. Sekiranya berlaku masalah' },
      emphasis: 'info',
      body: [
        {
          en: `If you are charged twice, charged the wrong amount, or your payment does not appear against your booking, contact us as soon as you can at ${HOTEL_LEGAL_IDENTITY.email} or ${HOTEL_LEGAL_IDENTITY.phone}. Reception operates ${HOTEL_LEGAL_IDENTITY.receptionHours}. Please have your booking number and the payment reference to hand.`,
          ms: `Sekiranya anda dikenakan caj dua kali, dikenakan amaun yang salah, atau pembayaran anda tidak muncul pada tempahan anda, hubungi kami secepat mungkin di ${HOTEL_LEGAL_IDENTITY.email} atau ${HOTEL_LEGAL_IDENTITY.phone}. Kaunter penyambut tetamu beroperasi ${HOTEL_LEGAL_IDENTITY.receptionHours}. Sila sediakan nombor tempahan dan rujukan pembayaran anda.`,
        },
        {
          en: 'We keep an audit record of every payment action, which lets us trace what happened. Your rights under the Consumer Protection Act 1999 are not affected by these terms.',
          ms: 'Kami menyimpan rekod audit bagi setiap tindakan pembayaran, yang membolehkan kami mengesan apa yang berlaku. Hak anda di bawah Akta Perlindungan Pengguna 1999 tidak terjejas oleh terma ini.',
        },
      ],
    },
    {
      id: 'security-advice',
      heading: { en: '8. Keeping your payment safe', ms: '8. Memastikan pembayaran anda selamat' },
      body: [
        {
          en: 'We will never telephone, email or message you to ask for your full card number, your card security code, your online banking password, or a one-time passcode. If you receive such a request claiming to be from us, it is not from us — do not act on it, and please tell us.',
          ms: 'Kami tidak sekali-kali akan menelefon, menghantar e-mel atau mesej kepada anda untuk meminta nombor kad penuh, kod keselamatan kad, kata laluan perbankan dalam talian, atau kod laluan sekali guna anda. Sekiranya anda menerima permintaan sedemikian yang mendakwa daripada kami, ia bukan daripada kami — jangan bertindak ke atasnya, dan sila maklumkan kepada kami.',
        },
        {
          en: 'Only pay through the payment page reached from your own booking confirmation, and check the address bar before entering any details.',
          ms: 'Hanya buat pembayaran melalui halaman pembayaran yang dicapai daripada pengesahan tempahan anda sendiri, dan semak bar alamat sebelum memasukkan sebarang butiran.',
        },
      ],
    },
  ],
};
