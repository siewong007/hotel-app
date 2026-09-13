import { HOTEL_LEGAL_IDENTITY, type HotelLegalIdentity } from './hotelIdentity';
import { getHotelSettings } from '../../../utils/hotelSettings';
import type { LegalDocument } from './types';

/**
 * Booking terms and conditions.
 *
 * The stay rules here (full-day rate after 3:00 pm, cancellation at least
 * three days before arrival, first night kept on late cancellation or
 * no-show, confirmation on full payment) are taken verbatim in substance from
 * the FAQ already published on the public Salim Inn site. They are restated
 * rather than reinvented so a guest cannot be shown two different contracts
 * for the same stay — if the published FAQ changes, this document and its
 * `version` must change with it.
 *
 * Check-in and check-out times are NOT fixed wording: they resolve at call
 * time from the public `check_in_time` / `check_out_time` settings so the
 * contract tracks the times the hotel actually operates rather than a
 * hardcoded copy that silently drifts when an operator edits them.
 */
export const TERMS_OF_SERVICE_VERSION = '2026-09-13';

/**
 * "15:00" → "3:00 pm" / "3:00 petang". A malformed setting is shown verbatim
 * (the operator's typo is still the true value); an absent one falls back to
 * the seeded defaults so the page never renders a blank contract clause.
 */
const formatStayTime = (
  raw: string | undefined,
  fallback: '15:00' | '11:00',
  locale: 'en' | 'ms'
): string => {
  const value = raw?.trim() || fallback;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  const h = match ? parseInt(match[1], 10) : NaN;
  if (!match || h > 23) return value;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (locale === 'ms') {
    const period =
      h === 0 ? 'tengah malam' : h < 12 ? 'pagi' : h === 12 ? 'tengah hari' : h < 19 ? 'petang' : 'malam';
    return `${h12}:${match[2]} ${period}`;
  }
  return `${h12}:${match[2]} ${h < 12 ? 'am' : 'pm'}`;
};

/**
 * Builds the terms against a resolved identity.
 *
 * The business registration number comes from the `hotel_business_number`
 * setting so an operator can correct it without a release, and check-in/out
 * times come from the public operational settings for the reason given above.
 * `version` is not a function of either — a consent record pins the wording
 * generation, not the values that generation happened to disclose.
 */
export const buildTermsOfService = (
  identity: HotelLegalIdentity = HOTEL_LEGAL_IDENTITY
): LegalDocument => {
  const addressOneLine = identity.addressLines.join(', ');
  const settings = getHotelSettings();
  const checkIn = (locale: 'en' | 'ms') => formatStayTime(settings.check_in_time, '15:00', locale);
  const checkOut = (locale: 'en' | 'ms') => formatStayTime(settings.check_out_time, '11:00', locale);
  return {
    id: 'terms_of_service',
    version: TERMS_OF_SERVICE_VERSION,
    effectiveDate: '2026-09-13',
    title: {
      en: 'Booking Terms and Conditions',
      ms: 'Terma dan Syarat Tempahan',
    },
    summary: {
      en: `These terms govern a reservation you make online with ${identity.tradingName}. They cover how a booking becomes confirmed, what you pay, how cancellation works, and the house rules that apply during your stay. Please read them before you confirm a booking.`,
      ms: `Terma ini mentadbir tempahan yang anda buat dalam talian dengan ${identity.tradingName}. Ia merangkumi cara tempahan disahkan, jumlah yang perlu dibayar, cara pembatalan berfungsi, dan peraturan penginapan yang terpakai sepanjang penginapan anda. Sila baca sebelum anda mengesahkan tempahan.`,
    },
    sections: [
      {
        id: 'parties',
        heading: { en: '1. Who these terms are between', ms: '1. Pihak yang terikat dengan terma ini' },
        body: [
          {
            en: `These terms form an agreement between you (the guest making the booking) and ${identity.registeredName} (business registration number ${identity.companyRegistrationNumber}), of ${addressOneLine} ("the Hotel", "we", "us").`,
            ms: `Terma ini membentuk perjanjian antara anda (tetamu yang membuat tempahan) dengan ${identity.registeredName} (nombor pendaftaran perniagaan ${identity.companyRegistrationNumber}), beralamat di ${addressOneLine} ("Hotel", "kami").`,
          },
          {
            en: 'They apply to bookings you make online through our website, the guest portal, or a booking link we send you, whether or not you hold a guest account. Bookings made at reception follow the same stay rules.',
            ms: 'Terma ini terpakai kepada tempahan yang anda buat dalam talian melalui laman web kami, portal tetamu, atau pautan tempahan yang kami hantar, sama ada anda mempunyai akaun tetamu atau tidak. Tempahan yang dibuat di kaunter penyambut tetamu mengikut peraturan penginapan yang sama.',
          },
          {
            en: 'By confirming a booking you confirm that you are at least 18 years old and legally able to enter into this agreement, and that the information you have given us is true and complete.',
            ms: 'Dengan mengesahkan tempahan, anda mengesahkan bahawa anda berumur sekurang-kurangnya 18 tahun dan berkelayakan di sisi undang-undang untuk memasuki perjanjian ini, serta bahawa maklumat yang anda berikan adalah benar dan lengkap.',
          },
        ],
      },
      {
        id: 'booking-confirmation',
        heading: { en: '2. How a booking is confirmed', ms: '2. Cara tempahan disahkan' },
        emphasis: 'requirement',
        body: [
          {
            en: 'A reservation is a request until we confirm it. A booking is confirmed only after full payment has been received and matched to your reservation. Until then the room is held but not guaranteed, and the rate may change if the hold lapses.',
            ms: 'Tempahan adalah permohonan sehingga kami mengesahkannya. Tempahan hanya disahkan selepas bayaran penuh diterima dan dipadankan dengan tempahan anda. Sehingga itu, bilik ditahan tetapi tidak dijamin, dan kadar boleh berubah sekiranya tempoh tahanan tamat.',
          },
          {
            en: 'An unpaid online booking may be released automatically after the holding period shown to you at the time of booking, returning the room to sale. We will send your confirmation and booking number to the email address you provide, so please make sure it is correct.',
            ms: 'Tempahan dalam talian yang belum dibayar boleh dilepaskan secara automatik selepas tempoh tahanan yang ditunjukkan kepada anda semasa menempah, dan bilik akan dijual semula. Kami akan menghantar pengesahan dan nombor tempahan anda ke alamat e-mel yang anda berikan, jadi sila pastikan ia betul.',
          },
        ],
      },
      {
        id: 'rates-and-taxes',
        heading: { en: '3. Rates, taxes and charges', ms: '3. Kadar, cukai dan caj' },
        body: [
          {
            en: 'The total shown at checkout is the amount payable for the stay described. Any applicable taxes and levies are shown separately before you confirm.',
            ms: 'Jumlah yang dipaparkan semasa pembayaran adalah amaun yang perlu dibayar bagi penginapan yang dinyatakan. Sebarang cukai dan levi yang terpakai dipaparkan secara berasingan sebelum anda mengesahkan.',
          },
        ],
        bullets: [
          {
            en: 'Tourism Tax is charged per room per night to guests who are not Malaysian citizens or permanent residents, as required by the Tourism Tax Act 2017. You are asked to declare your guest type during booking, and we may verify it against your identification at check-in.',
            ms: 'Cukai Pelancongan dikenakan bagi setiap bilik setiap malam kepada tetamu yang bukan warganegara atau pemastautin tetap Malaysia, sebagaimana dikehendaki oleh Akta Cukai Pelancongan 2017. Anda diminta mengisytiharkan jenis tetamu semasa menempah, dan kami boleh mengesahkannya berdasarkan dokumen pengenalan anda semasa daftar masuk.',
          },
          {
            en: 'If the guest type you declared is found to be incorrect at check-in, the correct tax will be applied and the difference collected or refunded.',
            ms: 'Sekiranya jenis tetamu yang anda isytiharkan didapati tidak tepat semasa daftar masuk, cukai yang betul akan dikenakan dan perbezaannya akan dikutip atau dikembalikan.',
          },
          {
            en: 'A refundable keycard deposit may be collected at check-in. It is returned at check-out once the room card has been returned and the room left in reasonable order.',
            ms: 'Deposit kad kunci yang boleh dikembalikan mungkin dikutip semasa daftar masuk. Ia dipulangkan semasa daftar keluar setelah kad bilik diserahkan semula dan bilik ditinggalkan dalam keadaan yang munasabah.',
          },
          {
            en: 'Incidental charges incurred during your stay, and any damage beyond fair wear and tear, are payable on departure.',
            ms: 'Caj sampingan yang ditanggung sepanjang penginapan, dan sebarang kerosakan melebihi haus dan lusuh yang munasabah, perlu dibayar semasa daftar keluar.',
          },
        ],
      },
      {
        id: 'cancellation',
        heading: { en: '4. Cancellation, changes and no-shows', ms: '4. Pembatalan, perubahan dan ketidakhadiran' },
        emphasis: 'requirement',
        body: [
          {
            en: 'You can cancel a booking you have not yet paid for at any time through the guest portal, and it takes effect immediately. Online cancellation may be suspended from time to time; if it is, the portal will say so and you can contact us instead.',
            ms: 'Anda boleh membatalkan tempahan yang belum dibayar pada bila-bila masa melalui portal tetamu, dan pembatalan berkuat kuasa serta-merta. Pembatalan dalam talian mungkin digantung dari semasa ke semasa; jika digantung, portal akan memaklumkannya dan anda boleh menghubungi kami.',
          },
          {
            en: 'A booking you have already paid for cannot be cancelled directly online. You can send us a cancellation request through the guest portal or by contacting us — your booking stays in place while our team reviews the request, and we will email you the outcome.',
            ms: 'Tempahan yang telah dibayar tidak boleh dibatalkan secara langsung dalam talian. Anda boleh menghantar permohonan pembatalan melalui portal tetamu atau dengan menghubungi kami — tempahan anda kekal aktif semasa pasukan kami menyemak permohonan itu, dan kami akan menghantar keputusannya melalui e-mel.',
          },
          {
            en: 'Where you cancel at least three (3) days before your arrival date we will refund you in full. Where less notice is given, or where you do not arrive (a no-show), we may keep the first night of the stay as a charge.',
            ms: 'Sekiranya anda membatalkan sekurang-kurangnya tiga (3) hari sebelum tarikh ketibaan, kami akan mengembalikan bayaran anda sepenuhnya. Sekiranya notis diberikan kurang daripada tempoh tersebut, atau anda tidak hadir (no-show), kami boleh mengekalkan caj malam pertama penginapan.',
          },
          {
            en: 'A booking made with a voucher that was shown as non-cancellable when you applied it cannot be cancelled. Requests to change dates are subject to availability and to the rate applicable on the new dates.',
            ms: 'Tempahan yang dibuat dengan baucar yang ditandakan sebagai tidak boleh dibatalkan semasa anda menggunakannya tidak boleh dibatalkan. Permohonan menukar tarikh tertakluk kepada kekosongan dan kadar yang terpakai pada tarikh baharu.',
          },
          {
            en: 'Nothing in this clause limits any right you may have under the Consumer Protection Act 1999 where a service is not supplied as agreed.',
            ms: 'Tiada apa-apa dalam fasal ini menghadkan hak anda di bawah Akta Perlindungan Pengguna 1999 sekiranya perkhidmatan tidak diberikan seperti yang dipersetujui.',
          },
        ],
      },
      {
        id: 'stay-rules',
        heading: { en: '5. Check-in, check-out and house rules', ms: '5. Daftar masuk, daftar keluar dan peraturan penginapan' },
        bullets: [
          {
            en: `Check-in begins at ${checkIn('en')}. Check-out is by ${checkOut('en')}. These times are set by the hotel and are also shown on your booking confirmation.`,
            ms: `Daftar masuk bermula pada ${checkIn('ms')}. Daftar keluar sebelum ${checkOut('ms')}. Masa ini ditetapkan oleh hotel dan turut ditunjukkan pada pengesahan tempahan anda.`,
          },
          {
            en: 'Late check-out is subject to availability and additional charges. A full-day rate may apply after 3:00 pm.',
            ms: 'Daftar keluar lewat tertakluk kepada kekosongan dan caj tambahan. Kadar sehari penuh boleh dikenakan selepas 3:00 petang.',
          },
          {
            en: 'All guests staying in the room must be registered at reception. Malaysian hotel-keeping requirements oblige us to keep a register of guests and to sight identification on arrival.',
            ms: 'Semua tetamu yang menginap di dalam bilik mesti didaftarkan di kaunter penyambut tetamu. Keperluan pengurusan hotel di Malaysia mewajibkan kami menyimpan daftar tetamu dan menyemak dokumen pengenalan semasa ketibaan.',
          },
          {
            en: 'The room may not be used for any unlawful purpose. We may end a stay without refund where a guest endangers others, causes serious nuisance, or breaches these rules.',
            ms: 'Bilik tidak boleh digunakan untuk sebarang tujuan yang menyalahi undang-undang. Kami boleh menamatkan penginapan tanpa bayaran balik sekiranya tetamu membahayakan orang lain, menimbulkan gangguan serius, atau melanggar peraturan ini.',
          },
        ],
      },
      {
        id: 'liability',
        heading: { en: '6. Our responsibility to you', ms: '6. Tanggungjawab kami terhadap anda' },
        body: [
          {
            en: 'We are responsible for providing the accommodation you booked with reasonable care and skill. We are not responsible for loss or damage that was not reasonably foreseeable, or that was caused by events outside our reasonable control.',
            ms: 'Kami bertanggungjawab menyediakan penginapan yang anda tempah dengan penjagaan dan kemahiran yang munasabah. Kami tidak bertanggungjawab atas kehilangan atau kerosakan yang tidak dapat dijangka secara munasabah, atau yang disebabkan oleh kejadian di luar kawalan munasabah kami.',
          },
          {
            en: 'Nothing in these terms excludes or limits our liability for death or personal injury caused by our negligence, for fraud, or for any liability that cannot lawfully be excluded under Malaysian law, including the Consumer Protection Act 1999.',
            ms: 'Tiada apa-apa dalam terma ini mengecualikan atau menghadkan liabiliti kami bagi kematian atau kecederaan diri akibat kecuaian kami, bagi penipuan, atau bagi mana-mana liabiliti yang tidak boleh dikecualikan di sisi undang-undang Malaysia, termasuk Akta Perlindungan Pengguna 1999.',
          },
          {
            en: 'Valuables should be kept secure. We ask that you report any loss to reception immediately so we can assist.',
            ms: 'Barangan berharga hendaklah disimpan dengan selamat. Kami memohon agar sebarang kehilangan dilaporkan kepada kaunter penyambut tetamu dengan segera supaya kami dapat membantu.',
          },
        ],
      },
      {
        id: 'personal-data',
        heading: { en: '7. Your personal data', ms: '7. Data peribadi anda' },
        body: [
          {
            en: 'We handle the personal data you give us in accordance with our Privacy Notice, which explains what we collect, why, who we share it with, how long we keep it, and how you can access or correct it. The Privacy Notice forms part of these terms.',
            ms: 'Kami mengendalikan data peribadi yang anda berikan mengikut Notis Privasi kami, yang menerangkan apa yang kami kumpul, sebabnya, dengan siapa ia dikongsi, tempoh penyimpanan, dan cara anda boleh mengakses atau membetulkannya. Notis Privasi merupakan sebahagian daripada terma ini.',
          },
        ],
      },
      {
        id: 'law',
        heading: { en: '8. Governing law and contact', ms: '8. Undang-undang yang mentadbir dan hubungan' },
        emphasis: 'info',
        body: [
          {
            en: 'These terms are governed by the laws of Malaysia and are subject to the jurisdiction of the Malaysian courts.',
            ms: 'Terma ini ditadbir oleh undang-undang Malaysia dan tertakluk kepada bidang kuasa mahkamah Malaysia.',
          },
          {
            en: `Reception operates ${identity.receptionHours}. For any question about a booking, or to request a cancellation, contact us at ${identity.email} or ${identity.phone}.`,
            ms: `Kaunter penyambut tetamu beroperasi ${identity.receptionHours}. Untuk sebarang pertanyaan mengenai tempahan, atau untuk memohon pembatalan, hubungi kami di ${identity.email} atau ${identity.phone}.`,
          },
        ],
      },
    ],
  };
};
