import { HOTEL_LEGAL_IDENTITY, type HotelLegalIdentity } from './hotelIdentity';
import { getHotelSettings } from '../../../utils/hotelSettings';
import type { LegalDocument, LegalLocale } from './types';

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
 *
 * zh/zh-TW copy: DRAFT — pending native/legal review.
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
  locale: LegalLocale
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
  if (locale === 'zh' || locale === 'zh-TW') {
    return `${h < 12 ? '上午' : '下午'} ${h12}:${match[2]}`;
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
  const checkIn = (locale: LegalLocale) => formatStayTime(settings.check_in_time, '15:00', locale);
  const checkOut = (locale: LegalLocale) => formatStayTime(settings.check_out_time, '11:00', locale);
  return {
    id: 'terms_of_service',
    version: TERMS_OF_SERVICE_VERSION,
    effectiveDate: '2026-09-13',
    title: {
      en: 'Booking Terms and Conditions',
      ms: 'Terma dan Syarat Tempahan',
      zh: '预订条款与条件',
      'zh-TW': '預訂條款與條件',
    },
    summary: {
      en: `These terms govern a reservation you make online with ${identity.tradingName}. They cover how a booking becomes confirmed, what you pay, how cancellation works, and the house rules that apply during your stay. Please read them before you confirm a booking.`,
      ms: `Terma ini mentadbir tempahan yang anda buat dalam talian dengan ${identity.tradingName}. Ia merangkumi cara tempahan disahkan, jumlah yang perlu dibayar, cara pembatalan berfungsi, dan peraturan penginapan yang terpakai sepanjang penginapan anda. Sila baca sebelum anda mengesahkan tempahan.`,
      zh: `本条款约束您通过${identity.tradingName}在线作出的预订，涵盖预订的确认方式、应付款项、取消规则及入住期间须遵守的住宿规定。请在确认预订前仔细阅读。`,
      'zh-TW': `本條款約束您透過${identity.tradingName}線上作出的預訂，涵蓋預訂的確認方式、應付款項、取消規則及入住期間須遵守的住宿規定。請在確認預訂前仔細閱讀。`,
    },
    sections: [
      {
        id: 'parties',
        heading: {
          en: '1. Who these terms are between',
          ms: '1. Pihak yang terikat dengan terma ini',
          zh: '1. 本条款的缔约方',
          'zh-TW': '1. 本條款的締約方',
        },
        body: [
          {
            en: `These terms form an agreement between you (the guest making the booking) and ${identity.registeredName} (business registration number ${identity.companyRegistrationNumber}), of ${addressOneLine} ("the Hotel", "we", "us").`,
            ms: `Terma ini membentuk perjanjian antara anda (tetamu yang membuat tempahan) dengan ${identity.registeredName} (nombor pendaftaran perniagaan ${identity.companyRegistrationNumber}), beralamat di ${addressOneLine} ("Hotel", "kami").`,
            zh: `本条款构成您（预订的宾客）与${identity.registeredName}（商业登记号码${identity.companyRegistrationNumber}，地址：${addressOneLine}，下称“酒店”或“我们”）之间的协议。`,
            'zh-TW': `本條款構成您（預訂的賓客）與${identity.registeredName}（商業登記號碼${identity.companyRegistrationNumber}，地址：${addressOneLine}，下稱「酒店」或「我們」）之間的協議。`,
          },
          {
            en: 'They apply to bookings you make online through our website, the guest portal, or a booking link we send you, whether or not you hold a guest account. Bookings made at reception follow the same stay rules.',
            ms: 'Terma ini terpakai kepada tempahan yang anda buat dalam talian melalui laman web kami, portal tetamu, atau pautan tempahan yang kami hantar, sama ada anda mempunyai akaun tetamu atau tidak. Tempahan yang dibuat di kaunter penyambut tetamu mengikut peraturan penginapan yang sama.',
            zh: '本条款适用于您通过我们的网站、宾客门户或我们发送的预订链接在线作出的预订，无论您是否持有宾客账户。在前台作出的预订适用相同的住宿规则。',
            'zh-TW': '本條款適用於您透過我們的網站、賓客門戶或我們發送的預訂連結線上作出的預訂，無論您是否持有賓客帳戶。在前台作出的預訂適用相同的住宿規則。',
          },
          {
            en: 'By confirming a booking you confirm that you are at least 18 years old and legally able to enter into this agreement, and that the information you have given us is true and complete.',
            ms: 'Dengan mengesahkan tempahan, anda mengesahkan bahawa anda berumur sekurang-kurangnya 18 tahun dan berkelayakan di sisi undang-undang untuk memasuki perjanjian ini, serta bahawa maklumat yang anda berikan adalah benar dan lengkap.',
            zh: '确认预订即表示您确认自己年满18岁且具有签订本协议的民事行为能力，且您向我们提供的资料真实完整。',
            'zh-TW': '確認預訂即表示您確認自己年滿18歲且具有簽訂本協議的民事行為能力，且您向我們提供的資料真實完整。',
          },
        ],
      },
      {
        id: 'booking-confirmation',
        heading: {
          en: '2. How a booking is confirmed',
          ms: '2. Cara tempahan disahkan',
          zh: '2. 预订的确认方式',
          'zh-TW': '2. 預訂的確認方式',
        },
        emphasis: 'requirement',
        body: [
          {
            en: 'A reservation is a request until we confirm it. A booking is confirmed only after full payment has been received and matched to your reservation. Until then the room is held but not guaranteed, and the rate may change if the hold lapses.',
            ms: 'Tempahan adalah permohonan sehingga kami mengesahkannya. Tempahan hanya disahkan selepas bayaran penuh diterima dan dipadankan dengan tempahan anda. Sehingga itu, bilik ditahan tetapi tidak dijamin, dan kadar boleh berubah sekiranya tempoh tahanan tamat.',
            zh: '预订在我们确认之前仅为申请。只有在收到全额房款并与您的预订对应后，预订方获确认。在此之前客房仅作保留而非保证，保留期满后房价可能变动。',
            'zh-TW': '預訂在我們確認之前僅為申請。只有在收到全額房款並與您的預訂對應後，預訂方獲確認。在此之前客房僅作保留而非保證，保留期滿後房價可能變動。',
          },
          {
            en: 'An unpaid online booking may be released automatically after the holding period shown to you at the time of booking, returning the room to sale. We will send your confirmation and booking number to the email address you provide, so please make sure it is correct.',
            ms: 'Tempahan dalam talian yang belum dibayar boleh dilepaskan secara automatik selepas tempoh tahanan yang ditunjukkan kepada anda semasa menempah, dan bilik akan dijual semula. Kami akan menghantar pengesahan dan nombor tempahan anda ke alamat e-mel yang anda berikan, jadi sila pastikan ia betul.',
            zh: '未付款的在线预订可能在预订时向您展示的保留期届满后自动释放，客房将恢复发售。我们会将确认信息与预订编号发送至您提供的电子邮箱，请确保其正确无误。',
            'zh-TW': '未付款的線上預訂可能在預訂時向您展示的保留期屆滿後自動釋出，客房將恢復發售。我們會將確認資訊與預訂編號發送至您提供的電子郵箱，請確保其正確無誤。',
          },
        ],
      },
      {
        id: 'rates-and-taxes',
        heading: {
          en: '3. Rates, taxes and charges',
          ms: '3. Kadar, cukai dan caj',
          zh: '3. 房价、税费与杂费',
          'zh-TW': '3. 房價、稅費與雜費',
        },
        body: [
          {
            en: 'The total shown at checkout is the amount payable for the stay described. Any applicable taxes and levies are shown separately before you confirm.',
            ms: 'Jumlah yang dipaparkan semasa pembayaran adalah amaun yang perlu dibayar bagi penginapan yang dinyatakan. Sebarang cukai dan levi yang terpakai dipaparkan secara berasingan sebelum anda mengesahkan.',
            zh: '结账时显示的总额即为所述住宿应付的金额。任何适用的税费与征费会在您确认前单独列示。',
            'zh-TW': '結帳時顯示的總額即為所述住宿應付的金額。任何適用的稅費與徵費會在您確認前單獨列示。',
          },
        ],
        bullets: [
          {
            en: 'Tourism Tax is charged per room per night to guests who are not Malaysian citizens or permanent residents, as required by the Tourism Tax Act 2017. You are asked to declare your guest type during booking, and we may verify it against your identification at check-in.',
            ms: 'Cukai Pelancongan dikenakan bagi setiap bilik setiap malam kepada tetamu yang bukan warganegara atau pemastautin tetap Malaysia, sebagaimana dikehendaki oleh Akta Cukai Pelancongan 2017. Anda diminta mengisytiharkan jenis tetamu semasa menempah, dan kami boleh mengesahkannya berdasarkan dokumen pengenalan anda semasa daftar masuk.',
            zh: '根据《2017年旅游税法令》，非马来西亚公民或永久居民的宾客须按每房每晚缴纳旅游税。预订时请您申报旅客类型，我们可能在办理入住时依据您的身份证明文件核实。',
            'zh-TW': '根據《2017年旅遊稅法令》，非馬來西亞公民或永久居民的賓客須按每房每晚繳納旅遊稅。預訂時請您申報旅客類型，我們可能在辦理入住時依據您的身分證明文件核實。',
          },
          {
            en: 'If the guest type you declared is found to be incorrect at check-in, the correct tax will be applied and the difference collected or refunded.',
            ms: 'Sekiranya jenis tetamu yang anda isytiharkan didapati tidak tepat semasa daftar masuk, cukai yang betul akan dikenakan dan perbezaannya akan dikutip atau dikembalikan.',
            zh: '若入住时发现您申报的旅客类型有误，将按正确税种计征，差额将予以补收或退还。',
            'zh-TW': '若入住時發現您申報的旅客類型有誤，將按正確稅種計徵，差額將予以補收或退還。',
          },
          {
            en: 'A refundable keycard deposit may be collected at check-in. It is returned at check-out once the room card has been returned and the room left in reasonable order.',
            ms: 'Deposit kad kunci yang boleh dikembalikan mungkin dikutip semasa daftar masuk. Ia dipulangkan semasa daftar keluar setelah kad bilik diserahkan semula dan bilik ditinggalkan dalam keadaan yang munasabah.',
            zh: '入住时可能收取可退还的房卡押金。退房时归还房卡且客房保持合理整洁后，押金将予退还。',
            'zh-TW': '入住時可能收取可退還的房卡押金。退房時歸還房卡且客房保持合理整潔後，押金將予退還。',
          },
          {
            en: 'Incidental charges incurred during your stay, and any damage beyond fair wear and tear, are payable on departure.',
            ms: 'Caj sampingan yang ditanggung sepanjang penginapan, dan sebarang kerosakan melebihi haus dan lusuh yang munasabah, perlu dibayar semasa daftar keluar.',
            zh: '住宿期间产生的杂项费用，以及超出合理使用损耗的任何损坏，须于退房时付清。',
            'zh-TW': '住宿期間產生的雜項費用，以及超出合理使用損耗的任何損壞，須於退房時付清。',
          },
        ],
      },
      {
        id: 'cancellation',
        heading: {
          en: '4. Cancellation, changes and no-shows',
          ms: '4. Pembatalan, perubahan dan ketidakhadiran',
          zh: '4. 取消、更改与未入住',
          'zh-TW': '4. 取消、更改與未入住',
        },
        emphasis: 'requirement',
        body: [
          {
            en: 'You can cancel a booking you have not yet paid for at any time through the guest portal, and it takes effect immediately. Online cancellation may be suspended from time to time; if it is, the portal will say so and you can contact us instead.',
            ms: 'Anda boleh membatalkan tempahan yang belum dibayar pada bila-bila masa melalui portal tetamu, dan pembatalan berkuat kuasa serta-merta. Pembatalan dalam talian mungkin digantung dari semasa ke semasa; jika digantung, portal akan memaklumkannya dan anda boleh menghubungi kami.',
            zh: '您可随时通过宾客门户取消尚未付款的预订，取消即时生效。在线取消功能可能不定期暂停；如暂停，门户会予以说明，您亦可联系我们办理。',
            'zh-TW': '您可隨時透過賓客門戶取消尚未付款的預訂，取消即時生效。線上取消功能可能不定期暫停；如暫停，門戶會予以說明，您亦可聯絡我們辦理。',
          },
          {
            en: 'A booking you have already paid for cannot be cancelled directly online. You can send us a cancellation request through the guest portal or by contacting us — your booking stays in place while our team reviews the request, and we will email you the outcome.',
            ms: 'Tempahan yang telah dibayar tidak boleh dibatalkan secara langsung dalam talian. Anda boleh menghantar permohonan pembatalan melalui portal tetamu atau dengan menghubungi kami — tempahan anda kekal aktif semasa pasukan kami menyemak permohonan itu, dan kami akan menghantar keputusannya melalui e-mel.',
            zh: '已付款的预订无法直接在线取消。您可通过宾客门户或直接联系我们提交取消申请——我们的团队审核期间您的预订仍然有效，审核结果将通过电子邮件通知您。',
            'zh-TW': '已付款的預訂無法直接線上取消。您可透過賓客門戶或直接聯絡我們提交取消申請——我們的團隊審核期間您的預訂仍然有效，審核結果將透過電子郵件通知您。',
          },
          {
            en: 'Where you cancel at least three (3) days before your arrival date we will refund you in full. Where less notice is given, or where you do not arrive (a no-show), we may keep the first night of the stay as a charge.',
            ms: 'Sekiranya anda membatalkan sekurang-kurangnya tiga (3) hari sebelum tarikh ketibaan, kami akan mengembalikan bayaran anda sepenuhnya. Sekiranya notis diberikan kurang daripada tempoh tersebut, atau anda tidak hadir (no-show), kami boleh mengekalkan caj malam pertama penginapan.',
            zh: '如您于抵达日期至少三（3）天前取消，我们将全额退款。如通知时间不足，或您未入住（no-show），我们可能收取首晚房费。',
            'zh-TW': '如您於抵達日期至少三（3）天前取消，我們將全額退款。如通知時間不足，或您未入住（no-show），我們可能收取首晚房費。',
          },
          {
            en: 'A booking made with a voucher that was shown as non-cancellable when you applied it cannot be cancelled. Requests to change dates are subject to availability and to the rate applicable on the new dates.',
            ms: 'Tempahan yang dibuat dengan baucar yang ditandakan sebagai tidak boleh dibatalkan semasa anda menggunakannya tidak boleh dibatalkan. Permohonan menukar tarikh tertakluk kepada kekosongan dan kadar yang terpakai pada tarikh baharu.',
            zh: '使用在您使用时标明为不可取消的礼券所作的预订不可取消。更改日期的申请须视乎空房情况，并按新日期适用的房价执行。',
            'zh-TW': '使用在您使用時標明為不可取消的禮券所作的預訂不可取消。更改日期的申請須視乎空房情況，並按新日期適用的房價執行。',
          },
          {
            en: 'Nothing in this clause limits any right you may have under the Consumer Protection Act 1999 where a service is not supplied as agreed.',
            ms: 'Tiada apa-apa dalam fasal ini menghadkan hak anda di bawah Akta Perlindungan Pengguna 1999 sekiranya perkhidmatan tidak diberikan seperti yang dipersetujui.',
            zh: '本条不限制您在服务未按约定提供时依《1999年消费者保护法令》可能享有的任何权利。',
            'zh-TW': '本條不限制您在服務未按約定提供時依《1999年消費者保護法令》可能享有的任何權利。',
          },
        ],
      },
      {
        id: 'stay-rules',
        heading: {
          en: '5. Check-in, check-out and house rules',
          ms: '5. Daftar masuk, daftar keluar dan peraturan penginapan',
          zh: '5. 入住、退房与住宿规定',
          'zh-TW': '5. 入住、退房與住宿規定',
        },
        bullets: [
          {
            en: `Check-in begins at ${checkIn('en')}. Check-out is by ${checkOut('en')}. These times are set by the hotel and are also shown on your booking confirmation.`,
            ms: `Daftar masuk bermula pada ${checkIn('ms')}. Daftar keluar sebelum ${checkOut('ms')}. Masa ini ditetapkan oleh hotel dan turut ditunjukkan pada pengesahan tempahan anda.`,
            zh: `入住自${checkIn('zh')}开始，退房截止时间为${checkOut('zh')}。上述时间由酒店设定，并载于您的预订确认信息中。`,
            'zh-TW': `入住自${checkIn('zh-TW')}開始，退房截止時間為${checkOut('zh-TW')}。上述時間由酒店設定，並載於您的預訂確認資訊中。`,
          },
          {
            en: 'Late check-out is subject to availability and additional charges. A full-day rate may apply after 3:00 pm.',
            ms: 'Daftar keluar lewat tertakluk kepada kekosongan dan caj tambahan. Kadar sehari penuh boleh dikenakan selepas 3:00 petang.',
            zh: '延迟退房视空房情况而定并可能收取额外费用。下午3:00后可能按全日房价计费。',
            'zh-TW': '延遲退房視空房情況而定並可能收取額外費用。下午3:00後可能按全日房價計費。',
          },
          {
            en: 'All guests staying in the room must be registered at reception. Malaysian hotel-keeping requirements oblige us to keep a register of guests and to sight identification on arrival.',
            ms: 'Semua tetamu yang menginap di dalam bilik mesti didaftarkan di kaunter penyambut tetamu. Keperluan pengurusan hotel di Malaysia mewajibkan kami menyimpan daftar tetamu dan menyemak dokumen pengenalan semasa ketibaan.',
            zh: '所有入住客房的宾客均须在前台登记。马来西亚酒店业管理规定要求我们在宾客抵达时登记住客名册并查验身份证明。',
            'zh-TW': '所有入住客房的賓客均須在前台登記。馬來西亞酒店業管理規定要求我們在賓客抵達時登記住客名冊並查驗身分證明。',
          },
          {
            en: 'The room may not be used for any unlawful purpose. We may end a stay without refund where a guest endangers others, causes serious nuisance, or breaches these rules.',
            ms: 'Bilik tidak boleh digunakan untuk sebarang tujuan yang menyalahi undang-undang. Kami boleh menamatkan penginapan tanpa bayaran balik sekiranya tetamu membahayakan orang lain, menimbulkan gangguan serius, atau melanggar peraturan ini.',
            zh: '客房不得用于任何非法用途。如宾客危及他人、造成严重滋扰或违反本规定，我们可终止其住宿且不予退款。',
            'zh-TW': '客房不得用於任何非法用途。如賓客危及他人、造成嚴重滋擾或違反本規定，我們可終止其住宿且不予退款。',
          },
        ],
      },
      {
        id: 'liability',
        heading: {
          en: '6. Our responsibility to you',
          ms: '6. Tanggungjawab kami terhadap anda',
          zh: '6. 我们对您的责任',
          'zh-TW': '6. 我們對您的責任',
        },
        body: [
          {
            en: 'We are responsible for providing the accommodation you booked with reasonable care and skill. We are not responsible for loss or damage that was not reasonably foreseeable, or that was caused by events outside our reasonable control.',
            ms: 'Kami bertanggungjawab menyediakan penginapan yang anda tempah dengan penjagaan dan kemahiran yang munasabah. Kami tidak bertanggungjawab atas kehilangan atau kerosakan yang tidak dapat dijangka secara munasabah, atau yang disebabkan oleh kejadian di luar kawalan munasabah kami.',
            zh: '我们负责以合理的谨慎与技能提供您所预订的住宿。对于无法合理预见的损失或损害，或因超出我们合理控制范围的事件所致者，我们不承担责任。',
            'zh-TW': '我們負責以合理的謹慎與技能提供您所預訂的住宿。對於無法合理預見的損失或損害，或因超出我們合理控制範圍的事件所致者，我們不承擔責任。',
          },
          {
            en: 'Nothing in these terms excludes or limits our liability for death or personal injury caused by our negligence, for fraud, or for any liability that cannot lawfully be excluded under Malaysian law, including the Consumer Protection Act 1999.',
            ms: 'Tiada apa-apa dalam terma ini mengecualikan atau menghadkan liabiliti kami bagi kematian atau kecederaan diri akibat kecuaian kami, bagi penipuan, atau bagi mana-mana liabiliti yang tidak boleh dikecualikan di sisi undang-undang Malaysia, termasuk Akta Perlindungan Pengguna 1999.',
            zh: '本条款不排除或限制我们因疏忽导致的死亡或人身伤害、欺诈行为，或依马来西亚法律（包括《1999年消费者保护法令》）不得合法排除的任何责任。',
            'zh-TW': '本條款不排除或限制我們因疏忽導致的死亡或人身傷害、欺詐行為，或依馬來西亞法律（包括《1999年消費者保護法令》）不得合法排除的任何責任。',
          },
          {
            en: 'Valuables should be kept secure. We ask that you report any loss to reception immediately so we can assist.',
            ms: 'Barangan berharga hendaklah disimpan dengan selamat. Kami memohon agar sebarang kehilangan dilaporkan kepada kaunter penyambut tetamu dengan segera supaya kami dapat membantu.',
            zh: '贵重物品请妥善保管。如有遗失，请立即告知前台以便我们协助处理。',
            'zh-TW': '貴重物品請妥善保管。如有遺失，請立即告知前台以便我們協助處理。',
          },
        ],
      },
      {
        id: 'personal-data',
        heading: {
          en: '7. Your personal data',
          ms: '7. Data peribadi anda',
          zh: '7. 您的个人资料',
          'zh-TW': '7. 您的個人資料',
        },
        body: [
          {
            en: 'We handle the personal data you give us in accordance with our Privacy Notice, which explains what we collect, why, who we share it with, how long we keep it, and how you can access or correct it. The Privacy Notice forms part of these terms.',
            ms: 'Kami mengendalikan data peribadi yang anda berikan mengikut Notis Privasi kami, yang menerangkan apa yang kami kumpul, sebabnya, dengan siapa ia dikongsi, tempoh penyimpanan, dan cara anda boleh mengakses atau membetulkannya. Notis Privasi merupakan sebahagian daripada terma ini.',
            zh: '我们依照《隐私通知》处理您提供的个人资料，其中说明我们收集的内容、原因、共享对象、保留期限，以及您查阅或更正的方式。《隐私通知》构成本条款的一部分。',
            'zh-TW': '我們依照《隱私通知》處理您提供的個人資料，其中說明我們收集的內容、原因、共享對象、保留期限，以及您查閱或更正的方式。《隱私通知》構成本條款的一部分。',
          },
        ],
      },
      {
        id: 'law',
        heading: {
          en: '8. Governing law and contact',
          ms: '8. Undang-undang yang mentadbir dan hubungan',
          zh: '8. 管辖法律与联系方式',
          'zh-TW': '8. 管轄法律與聯絡方式',
        },
        emphasis: 'info',
        body: [
          {
            en: 'These terms are governed by the laws of Malaysia and are subject to the jurisdiction of the Malaysian courts.',
            ms: 'Terma ini ditadbir oleh undang-undang Malaysia dan tertakluk kepada bidang kuasa mahkamah Malaysia.',
            zh: '本条款受马来西亚法律管辖，并受马来西亚法院管辖权约束。',
            'zh-TW': '本條款受馬來西亞法律管轄，並受馬來西亞法院管轄權約束。',
          },
          {
            en: `Reception operates ${identity.receptionHours}. For any question about a booking, or to request a cancellation, contact us at ${identity.email} or ${identity.phone}.`,
            ms: `Kaunter penyambut tetamu beroperasi ${identity.receptionHours}. Untuk sebarang pertanyaan mengenai tempahan, atau untuk memohon pembatalan, hubungi kami di ${identity.email} atau ${identity.phone}.`,
            zh: `前台服务时间：${identity.receptionHours}。如对预订有任何疑问或需申请取消，请通过${identity.email}或${identity.phone}联系我们。`,
            'zh-TW': `前台服務時間：${identity.receptionHours}。如對預訂有任何疑問或需申請取消，請透過${identity.email}或${identity.phone}聯絡我們。`,
          },
        ],
      },
    ],
  };
};
