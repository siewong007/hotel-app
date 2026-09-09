import { HOTEL_ADDRESS_ONE_LINE, HOTEL_LEGAL_IDENTITY } from './hotelIdentity';
import type { LegalDocument } from './types';

/**
 * PDPA s.7 "Notice and Choice" notice.
 *
 * Section 7(1) of the Personal Data Protection Act 2010 lists what a written
 * notice must tell a data subject, and every one of those items has a section
 * below:
 *   (a) that data is being processed + a description  -> `what-we-collect`
 *   (b) the purposes of collection                     -> `why-we-use-it`
 *   (c) any information available as to the source     -> `where-it-comes-from`
 *   (d) right of access and correction, and the contact
 *       details for inquiries and complaints           -> `your-rights`
 *   (e) the class of third parties to whom we disclose -> `who-we-share-with`
 *   (f) the choices available to limit processing      -> `your-choices`
 *   (g) whether supply is obligatory or voluntary, and
 *       the consequences of not supplying              -> `is-it-obligatory`
 *
 * Retention, security and the 2024 amendment duties (breach notification, data
 * portability, DPO contact) have their own sections. Section 7(2) requires the
 * notice in both national language and English, which `LocalizedText` enforces.
 */
export const PRIVACY_NOTICE_VERSION = '2026-09-09';

export const privacyNotice: LegalDocument = {
  id: 'privacy_notice',
  version: PRIVACY_NOTICE_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Privacy Notice (Personal Data Protection Act 2010)',
    ms: 'Notis Privasi (Akta Perlindungan Data Peribadi 2010)',
  },
  summary: {
    en: `${HOTEL_LEGAL_IDENTITY.tradingName} collects personal data so we can take your booking, host your stay, take payment, and meet our legal obligations as a hotel operator in Malaysia. This notice explains what we collect and the control you have over it. It is given to you under section 7 of the Personal Data Protection Act 2010.`,
    ms: `${HOTEL_LEGAL_IDENTITY.tradingName} mengumpul data peribadi supaya kami boleh menerima tempahan anda, menguruskan penginapan anda, menerima bayaran, dan memenuhi kewajipan undang-undang kami sebagai pengendali hotel di Malaysia. Notis ini menerangkan apa yang kami kumpul dan kawalan yang anda miliki ke atasnya. Notis ini diberikan kepada anda di bawah seksyen 7 Akta Perlindungan Data Peribadi 2010.`,
  },
  sections: [
    {
      id: 'controller',
      heading: { en: '1. Who is responsible for your data', ms: '1. Pihak yang bertanggungjawab ke atas data anda' },
      body: [
        {
          en: `The data controller is ${HOTEL_LEGAL_IDENTITY.registeredName}, of ${HOTEL_ADDRESS_ONE_LINE}. Questions about this notice, and requests about your data, go to ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail} or ${HOTEL_LEGAL_IDENTITY.phone}.`,
          ms: `Pengawal data ialah ${HOTEL_LEGAL_IDENTITY.registeredName}, beralamat di ${HOTEL_ADDRESS_ONE_LINE}. Pertanyaan mengenai notis ini, dan permohonan berkenaan data anda, boleh dihantar ke ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail} atau ${HOTEL_LEGAL_IDENTITY.phone}.`,
        },
      ],
    },
    {
      id: 'what-we-collect',
      heading: { en: '2. What personal data we process', ms: '2. Data peribadi yang kami proses' },
      body: [
        {
          en: 'We process the following personal data about you. Not all of it applies to every guest — what we hold depends on how you book and what you use.',
          ms: 'Kami memproses data peribadi berikut mengenai anda. Tidak semuanya terpakai kepada setiap tetamu — apa yang kami simpan bergantung pada cara anda menempah dan perkhidmatan yang anda gunakan.',
        },
      ],
      bullets: [
        {
          en: 'Identity and contact details: your name, email address, telephone number, postal address, nationality, date of birth, and your declared guest type (local or foreign) which determines Tourism Tax.',
          ms: 'Butiran identiti dan hubungan: nama, alamat e-mel, nombor telefon, alamat surat-menyurat, kewarganegaraan, tarikh lahir, dan jenis tetamu yang anda isytiharkan (tempatan atau asing) yang menentukan Cukai Pelancongan.',
        },
        {
          en: 'Booking and stay records: your reservation dates, room and rate, special requests, cleaning preference, arrival and departure, and the history of changes to your booking.',
          ms: 'Rekod tempahan dan penginapan: tarikh tempahan, bilik dan kadar, permintaan khas, pilihan pembersihan, ketibaan dan pelepasan, serta sejarah perubahan pada tempahan anda.',
        },
        {
          en: 'Payment records: the amount, currency, method and status of your payment, the reference of a bank transfer, and any payment receipt you upload. We do not store your full card number — card and PayPal payments are processed by PayPal on their own systems.',
          ms: 'Rekod pembayaran: jumlah, mata wang, kaedah dan status pembayaran anda, rujukan pindahan bank, dan sebarang resit pembayaran yang anda muat naik. Kami tidak menyimpan nombor kad penuh anda — pembayaran kad dan PayPal diproses oleh PayPal pada sistem mereka sendiri.',
        },
        {
          en: 'Identification data, where you complete identity verification: your identity document type and number, its issuing country and expiry, images of that document, a photograph of your face taken for matching, and any proof of address you supply.',
          ms: 'Data pengenalan, sekiranya anda melengkapkan pengesahan identiti: jenis dan nombor dokumen pengenalan anda, negara pengeluaran dan tarikh luput, imej dokumen tersebut, gambar wajah anda yang diambil untuk tujuan padanan, dan sebarang bukti alamat yang anda berikan.',
        },
        {
          en: 'Account and technical data, if you create an account: your username, password (stored only as a cryptographic hash, never in readable form), login times, and the IP address and browser you used when you gave consent or signed in.',
          ms: 'Data akaun dan teknikal, sekiranya anda membuka akaun: nama pengguna, kata laluan (disimpan hanya sebagai cincangan kriptografi, tidak pernah dalam bentuk yang boleh dibaca), waktu log masuk, serta alamat IP dan pelayar yang anda gunakan semasa memberi persetujuan atau log masuk.',
        },
        {
          en: 'Correspondence: messages you send us through the guest portal, support chat, or email.',
          ms: 'Surat-menyurat: mesej yang anda hantar kepada kami melalui portal tetamu, sembang sokongan, atau e-mel.',
        },
      ],
    },
    {
      id: 'sensitive-data',
      heading: { en: '3. Sensitive personal data', ms: '3. Data peribadi sensitif' },
      body: [
        {
          en: 'Where you complete identity verification, the facial image we ask for is biometric data. Biometric data is treated as sensitive personal data under the Personal Data Protection Act, and we process it only with your separate, explicit consent, which you may refuse. Identity verification is not required in order to book or to stay with us.',
          ms: 'Sekiranya anda melengkapkan pengesahan identiti, imej wajah yang kami minta adalah data biometrik. Data biometrik dianggap sebagai data peribadi sensitif di bawah Akta Perlindungan Data Peribadi, dan kami memprosesnya hanya dengan persetujuan nyata anda yang berasingan, yang boleh anda tolak. Pengesahan identiti bukan syarat untuk menempah atau menginap bersama kami.',
        },
        {
          en: 'We use it for one purpose only: to confirm that the person presenting the identity document is the person in it. We do not use it to profile you, and we do not share it for advertising.',
          ms: 'Kami menggunakannya untuk satu tujuan sahaja: mengesahkan bahawa individu yang mengemukakan dokumen pengenalan adalah individu di dalam dokumen tersebut. Kami tidak menggunakannya untuk pemprofilan, dan kami tidak berkongsi ia untuk tujuan pengiklanan.',
        },
      ],
    },
    {
      id: 'where-it-comes-from',
      heading: { en: '4. Where the data comes from', ms: '4. Sumber data' },
      body: [
        {
          en: 'Almost all of the data we hold comes directly from you, when you search, book, pay, check in, or contact us. Where you booked through a travel agent or an online travel platform, your booking and contact details reach us from that platform. Payment confirmations reach us from our payment provider.',
          ms: 'Hampir keseluruhan data yang kami simpan datang terus daripada anda, semasa anda mencari, menempah, membayar, mendaftar masuk, atau menghubungi kami. Sekiranya anda menempah melalui ejen pelancongan atau platform pelancongan dalam talian, butiran tempahan dan hubungan anda sampai kepada kami daripada platform tersebut. Pengesahan pembayaran sampai kepada kami daripada penyedia pembayaran kami.',
        },
      ],
    },
    {
      id: 'why-we-use-it',
      heading: { en: '5. Why we use it', ms: '5. Sebab kami menggunakannya' },
      bullets: [
        {
          en: 'To take, confirm, change and cancel your booking, and to contact you about it.',
          ms: 'Untuk menerima, mengesahkan, mengubah dan membatalkan tempahan anda, serta menghubungi anda mengenainya.',
        },
        {
          en: 'To take payment, issue receipts and invoices, and investigate payment disputes.',
          ms: 'Untuk menerima bayaran, mengeluarkan resit dan invois, serta menyiasat pertikaian pembayaran.',
        },
        {
          en: 'To host your stay: allocate a room, meet your requests, and provide services you ask for.',
          ms: 'Untuk menguruskan penginapan anda: memperuntukkan bilik, memenuhi permintaan anda, dan menyediakan perkhidmatan yang anda minta.',
        },
        {
          en: 'To meet legal obligations: maintaining the guest register required of hotel operators, assessing and remitting Tourism Tax under the Tourism Tax Act 2017, keeping accounting and tax records, and responding to lawful requests from the authorities.',
          ms: 'Untuk memenuhi kewajipan undang-undang: menyelenggara daftar tetamu yang diwajibkan ke atas pengendali hotel, menaksir dan meremitkan Cukai Pelancongan di bawah Akta Cukai Pelancongan 2017, menyimpan rekod perakaunan dan cukai, serta memenuhi permintaan sah pihak berkuasa.',
        },
        {
          en: 'To keep the hotel and our systems secure, prevent fraud, and protect our legal position.',
          ms: 'Untuk memastikan keselamatan hotel dan sistem kami, mencegah penipuan, dan melindungi kedudukan undang-undang kami.',
        },
        {
          en: 'To operate loyalty and rewards, if you choose to join.',
          ms: 'Untuk mengendalikan program kesetiaan dan ganjaran, sekiranya anda memilih untuk menyertainya.',
        },
        {
          en: 'To send you offers and news — only where you have separately opted in, and only until you opt out.',
          ms: 'Untuk menghantar tawaran dan berita kepada anda — hanya sekiranya anda telah bersetuju secara berasingan, dan hanya sehingga anda menarik diri.',
        },
      ],
    },
    {
      id: 'who-we-share-with',
      heading: { en: '6. Who we share it with', ms: '6. Pihak yang kami kongsikan data' },
      body: [
        {
          en: 'We do not sell your personal data. We disclose it only to the following classes of third parties, and only so far as each needs it:',
          ms: 'Kami tidak menjual data peribadi anda. Kami hanya mendedahkannya kepada kelas pihak ketiga berikut, dan hanya setakat yang diperlukan oleh setiap satu:',
        },
      ],
      bullets: [
        {
          en: 'Payment providers, including PayPal, which processes card and PayPal payments on its own systems and under its own privacy terms, and the banks handling transfers.',
          ms: 'Penyedia pembayaran, termasuk PayPal, yang memproses pembayaran kad dan PayPal pada sistem mereka sendiri dan di bawah terma privasi mereka sendiri, serta bank yang mengendalikan pindahan.',
        },
        {
          en: 'Technology suppliers who host, back up and maintain this system on our instructions, and our email delivery provider.',
          ms: 'Pembekal teknologi yang menghos, membuat sandaran dan menyelenggara sistem ini atas arahan kami, serta penyedia penghantaran e-mel kami.',
        },
        {
          en: 'Travel agents and online travel platforms, where your booking was made through them.',
          ms: 'Ejen pelancongan dan platform pelancongan dalam talian, sekiranya tempahan anda dibuat melalui mereka.',
        },
        {
          en: 'Government agencies and regulators where the law requires it, including tax and tourism authorities, the police, and the Personal Data Protection Commissioner.',
          ms: 'Agensi kerajaan dan pengawal selia sekiranya dikehendaki oleh undang-undang, termasuk pihak berkuasa cukai dan pelancongan, polis, dan Pesuruhjaya Perlindungan Data Peribadi.',
        },
        {
          en: 'Our professional advisers — accountants, auditors and lawyers — under a duty of confidence.',
          ms: 'Penasihat profesional kami — akauntan, juruaudit dan peguam — di bawah kewajipan kerahsiaan.',
        },
      ],
    },
    {
      id: 'transfer-abroad',
      heading: { en: '7. Transfers outside Malaysia', ms: '7. Pemindahan ke luar Malaysia' },
      body: [
        {
          en: 'Some of the suppliers above, in particular our payment and email providers, process data on servers outside Malaysia. Where personal data leaves Malaysia we take reasonable steps to satisfy ourselves that it will receive protection substantially similar to that required by the Personal Data Protection Act 2010, and that it will be used only for the purposes described here.',
          ms: 'Sebahagian pembekal di atas, khususnya penyedia pembayaran dan e-mel kami, memproses data pada pelayan di luar Malaysia. Sekiranya data peribadi keluar dari Malaysia, kami mengambil langkah munasabah untuk memastikan ia menerima perlindungan yang secara substansialnya setara dengan yang dikehendaki oleh Akta Perlindungan Data Peribadi 2010, dan bahawa ia digunakan hanya untuk tujuan yang dinyatakan di sini.',
        },
      ],
    },
    {
      id: 'is-it-obligatory',
      heading: { en: '8. Is giving us this data obligatory?', ms: '8. Adakah pemberian data ini diwajibkan?' },
      body: [
        {
          en: 'Some of it is. We cannot accept a booking without a name, a contact email, and your declared guest type, because we cannot confirm the stay, reach you, or assess Tourism Tax without them. On arrival, hotel-keeping and tax rules oblige us to record the identification of the guests staying in the room. If you do not provide these, we will not be able to take the booking or complete check-in.',
          ms: 'Sebahagiannya diwajibkan. Kami tidak dapat menerima tempahan tanpa nama, e-mel hubungan, dan jenis tetamu yang anda isytiharkan, kerana kami tidak dapat mengesahkan penginapan, menghubungi anda, atau menaksir Cukai Pelancongan tanpanya. Semasa ketibaan, peraturan pengurusan hotel dan cukai mewajibkan kami merekodkan pengenalan tetamu yang menginap di dalam bilik. Sekiranya anda tidak memberikannya, kami tidak akan dapat menerima tempahan atau melengkapkan daftar masuk.',
        },
        {
          en: 'The rest is voluntary. Your telephone number, address, date of birth, special requests, loyalty membership, marketing consent, and online identity verification are all optional, and declining them does not affect your booking or the price you pay.',
          ms: 'Selebihnya adalah sukarela. Nombor telefon, alamat, tarikh lahir, permintaan khas, keahlian kesetiaan, persetujuan pemasaran, dan pengesahan identiti dalam talian semuanya adalah pilihan, dan penolakan tidak menjejaskan tempahan anda atau harga yang anda bayar.',
        },
      ],
    },
    {
      id: 'your-choices',
      heading: { en: '9. Choices you can make', ms: '9. Pilihan yang boleh anda buat' },
      bullets: [
        {
          en: 'You may withdraw your consent to marketing at any time, from your account settings, by using the unsubscribe link in any marketing email, or by contacting us. We will stop sending it.',
          ms: 'Anda boleh menarik balik persetujuan pemasaran pada bila-bila masa, melalui tetapan akaun anda, menggunakan pautan berhenti melanggan dalam mana-mana e-mel pemasaran, atau dengan menghubungi kami. Kami akan berhenti menghantarnya.',
        },
        {
          en: 'You may withdraw your consent to identity verification and ask us to delete the images we hold, unless we are required to keep them by law.',
          ms: 'Anda boleh menarik balik persetujuan pengesahan identiti dan meminta kami memadamkan imej yang kami simpan, melainkan kami dikehendaki menyimpannya oleh undang-undang.',
        },
        {
          en: 'Withdrawing consent does not affect processing already carried out, and we may still need to process data to complete a booking you have made or to meet a legal duty.',
          ms: 'Penarikan balik persetujuan tidak menjejaskan pemprosesan yang telah dilakukan, dan kami mungkin masih perlu memproses data untuk melengkapkan tempahan yang telah anda buat atau memenuhi kewajipan undang-undang.',
        },
      ],
    },
    {
      id: 'your-rights',
      heading: { en: '10. Your rights, and how to complain', ms: '10. Hak anda, dan cara membuat aduan' },
      body: [
        {
          en: 'Under the Personal Data Protection Act 2010 you have the right to ask us for a copy of the personal data we hold about you, to have inaccurate data corrected, to limit how we process it, to withdraw consent, and — following the 2024 amendments to the Act — to ask us to transmit your data to another data controller where that is technically feasible.',
          ms: 'Di bawah Akta Perlindungan Data Peribadi 2010, anda berhak meminta salinan data peribadi yang kami simpan mengenai anda, membetulkan data yang tidak tepat, menghadkan cara kami memprosesnya, menarik balik persetujuan, dan — berikutan pindaan 2024 kepada Akta tersebut — meminta kami memindahkan data anda kepada pengawal data lain sekiranya ia boleh dilaksanakan dari segi teknikal.',
        },
        {
          en: `Send any of these requests to ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. We will respond within the period allowed by the Act. A fee prescribed by the Act may apply to a data access request.`,
          ms: `Hantar sebarang permohonan ini ke ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. Kami akan membalas dalam tempoh yang dibenarkan oleh Akta. Fi yang ditetapkan oleh Akta boleh dikenakan bagi permohonan akses data.`,
        },
        {
          en: 'If you are not satisfied with how we have handled your data, you may complain to us first, and you may also complain to the Personal Data Protection Commissioner, Malaysia (Jabatan Perlindungan Data Peribadi).',
          ms: 'Sekiranya anda tidak berpuas hati dengan cara kami mengendalikan data anda, anda boleh membuat aduan kepada kami terlebih dahulu, dan anda juga boleh membuat aduan kepada Pesuruhjaya Perlindungan Data Peribadi, Malaysia (Jabatan Perlindungan Data Peribadi).',
        },
      ],
    },
    {
      id: 'retention',
      heading: { en: '11. How long we keep it', ms: '11. Tempoh penyimpanan' },
      body: [
        {
          en: 'We keep personal data only for as long as the purpose it was collected for requires, and then for as long as the law obliges us to. Booking, payment and accounting records are kept for the period required by Malaysian tax and companies legislation. Identity verification images are kept only for as long as needed to verify you and to meet the guest-register obligation, and are then deleted. Marketing consent records are kept for as long as you remain subscribed, plus a period afterwards to evidence that consent existed.',
          ms: 'Kami menyimpan data peribadi hanya selama yang diperlukan oleh tujuan pengumpulannya, dan selepas itu selama yang diwajibkan oleh undang-undang. Rekod tempahan, pembayaran dan perakaunan disimpan bagi tempoh yang dikehendaki oleh perundangan cukai dan syarikat Malaysia. Imej pengesahan identiti disimpan hanya selama yang diperlukan untuk mengesahkan anda dan memenuhi kewajipan daftar tetamu, dan kemudian dipadamkan. Rekod persetujuan pemasaran disimpan selama anda kekal melanggan, serta suatu tempoh selepas itu bagi membuktikan persetujuan tersebut wujud.',
        },
      ],
    },
    {
      id: 'security',
      heading: { en: '12. How we protect it, and what happens if something goes wrong', ms: '12. Cara kami melindunginya, dan tindakan jika berlaku insiden' },
      body: [
        {
          en: 'We take practical steps to protect your data: encrypted connections, access limited to staff whose role requires it, recorded audit trails of who viewed or changed a record, hashed passwords, and optional two-factor authentication on accounts.',
          ms: 'Kami mengambil langkah praktikal untuk melindungi data anda: sambungan tersulit, akses terhad kepada kakitangan yang memerlukannya mengikut peranan, jejak audit yang merekodkan siapa yang melihat atau mengubah rekod, kata laluan tercincang, dan pengesahan dua faktor sebagai pilihan pada akaun.',
        },
        {
          en: 'If a breach of personal data occurs that causes or is likely to cause significant harm, we will notify the Personal Data Protection Commissioner, and will notify you where the Act requires it.',
          ms: 'Sekiranya berlaku pelanggaran data peribadi yang menyebabkan atau berkemungkinan menyebabkan kemudaratan yang ketara, kami akan memaklumkan Pesuruhjaya Perlindungan Data Peribadi, dan akan memaklumkan anda sekiranya dikehendaki oleh Akta.',
        },
      ],
    },
    {
      id: 'cookies',
      heading: { en: '13. Cookies and local storage', ms: '13. Kuki dan storan setempat' },
      body: [
        {
          en: 'This site stores a small amount of data in your browser so that it works: keeping you signed in, holding your booking session, and remembering interface preferences such as your chosen language. These are necessary for the service you asked for. We do not use advertising or cross-site tracking cookies.',
          ms: 'Laman ini menyimpan sedikit data dalam pelayar anda supaya ia berfungsi: mengekalkan log masuk anda, menyimpan sesi tempahan anda, dan mengingati keutamaan antara muka seperti bahasa pilihan anda. Ini diperlukan untuk perkhidmatan yang anda minta. Kami tidak menggunakan kuki pengiklanan atau penjejakan merentas laman.',
        },
      ],
    },
    {
      id: 'changes',
      heading: { en: '14. Changes to this notice', ms: '14. Perubahan pada notis ini' },
      body: [
        {
          en: 'If we change this notice we will publish the new version here with a new version number and effective date. Where a change materially affects how we use data you have already given us, we will ask for your consent again.',
          ms: 'Sekiranya kami mengubah notis ini, kami akan menerbitkan versi baharu di sini dengan nombor versi dan tarikh berkuat kuasa yang baharu. Sekiranya perubahan tersebut menjejaskan secara material cara kami menggunakan data yang telah anda berikan, kami akan meminta persetujuan anda semula.',
        },
      ],
    },
  ],
};
