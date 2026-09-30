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
 *
 * zh/zh-TW copy: DRAFT — pending native/legal review.
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
    zh: '所示金额为本次预订的全额款项，包含报价中已列明的各项税费。我们从不读取浏览器中的金额——款项由我们的服务器根据您的预订计算得出。',
    'zh-TW': '所示金額為本次預訂的全額款項，包含報價中已列明的各項稅費。我們從不讀取瀏覽器中的金額——款項由我們的伺服器根據您的預訂計算得出。',
  },
  {
    en: 'Card and PayPal payments are processed by PayPal. Your card details are entered on PayPal and are never seen or stored by the hotel.',
    ms: 'Pembayaran kad dan PayPal diproses oleh PayPal. Butiran kad anda dimasukkan pada PayPal dan tidak sekali-kali dilihat atau disimpan oleh hotel.',
    zh: '银行卡及PayPal付款均由PayPal处理。您的银行卡资料直接输入PayPal，酒店不会看到也不会存储。',
    'zh-TW': '銀行卡及PayPal付款均由PayPal處理。您的銀行卡資料直接輸入PayPal，酒店不會看到也不會儲存。',
  },
  {
    en: 'A bank transfer is confirmed by our staff after we can see the funds. Your booking stays unconfirmed until then, so transfer early and upload your receipt to speed this up.',
    ms: 'Pindahan bank disahkan oleh kakitangan kami selepas kami dapat melihat dana tersebut. Tempahan anda kekal belum disahkan sehingga itu, jadi buat pindahan lebih awal dan muat naik resit anda untuk mempercepatkannya.',
    zh: '银行转账需在我们确认资金到账后由工作人员核实。在此之前您的预订保持未确认状态，请尽早转账并上传凭证以加快处理。',
    'zh-TW': '銀行轉帳需在我們確認資金到帳後由工作人員核實。在此之前您的預訂保持未確認狀態，請盡早轉帳並上傳憑證以加快處理。',
  },
  {
    en: 'Cancelling at least three days before arrival may qualify for a refund. Later than that, or if you do not arrive, the first night may be charged.',
    ms: 'Pembatalan sekurang-kurangnya tiga hari sebelum ketibaan mungkin layak untuk bayaran balik. Lewat daripada itu, atau sekiranya anda tidak hadir, malam pertama boleh dikenakan caj.',
    zh: '在抵达前至少三天取消，可能符合退款条件。超过该期限或未到店入住，可能收取首晚房费。',
    'zh-TW': '在抵達前至少三天取消，可能符合退款條件。超過該期限或未到店入住，可能收取首晚房費。',
  },
];

export const paymentTerms: LegalDocument = {
  id: 'payment_terms',
  version: PAYMENT_TERMS_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Payment Terms',
    ms: 'Terma Pembayaran',
    zh: '付款条款',
    'zh-TW': '付款條款',
  },
  summary: {
    en: 'These terms explain what you are paying, how each payment method works, when your booking becomes confirmed, and how refunds are handled. They apply in addition to our Booking Terms and Conditions.',
    ms: 'Terma ini menerangkan apa yang anda bayar, cara setiap kaedah pembayaran berfungsi, bila tempahan anda disahkan, dan cara bayaran balik dikendalikan. Ia terpakai sebagai tambahan kepada Terma dan Syarat Tempahan kami.',
    zh: '本条款说明您所支付的款项、各付款方式的运作方式、预订何时获得确认以及退款的处理方式。本条款与我们的《预订条款与细则》一并适用。',
    'zh-TW': '本條款說明您所支付的款項、各付款方式的運作方式、預訂何時獲得確認以及退款的處理方式。本條款與我們的《預訂條款與細則》一併適用。',
  },
  sections: [
    {
      id: 'what-you-pay',
      heading: {
        en: '1. What you are paying',
        ms: '1. Apa yang anda bayar',
        zh: '1. 您所支付的款项',
        'zh-TW': '1. 您所支付的款項',
      },
      emphasis: 'requirement',
      body: [
        {
          en: 'The amount presented to you is the total for the booking shown: the room rate for every night of the stay, plus any taxes and levies itemised on your quote. Tourism Tax is included in that total where it applies to you.',
          ms: 'Amaun yang dipaparkan kepada anda adalah jumlah keseluruhan bagi tempahan yang ditunjukkan: kadar bilik bagi setiap malam penginapan, serta sebarang cukai dan levi yang diperincikan pada sebut harga anda. Cukai Pelancongan termasuk dalam jumlah tersebut sekiranya ia terpakai kepada anda.',
          zh: '向您展示的金额为所示预订的总额：包括住宿每一晚的房费，以及报价中列明的各项税费。旅游税（如适用于您）已包含在该总额内。',
          'zh-TW': '向您展示的金額為所示預訂的總額：包括住宿每一晚的房費，以及報價中列明的各項稅費。旅遊稅（如適用於您）已包含在該總額內。',
        },
        {
          en: 'The amount is calculated by us from your booking at the moment you pay. It is not taken from your browser, so a price cannot be altered on your device. If the amount displayed ever differs from what you expect, stop and contact reception before paying.',
          ms: 'Amaun tersebut dikira oleh kami daripada tempahan anda pada masa anda membayar. Ia tidak diambil daripada pelayar anda, jadi harga tidak boleh diubah pada peranti anda. Sekiranya amaun yang dipaparkan berbeza daripada jangkaan anda, hentikan dan hubungi kaunter penyambut tetamu sebelum membayar.',
          zh: '金额由我们在您付款时根据您的预订计算得出，并非取自您的浏览器，因此价格无法在您的设备上被篡改。如所示金额与您预期不符，请停止操作并在付款前联系前台。',
          'zh-TW': '金額由我們在您付款時根據您的預訂計算得出，並非取自您的瀏覽器，因此價格無法在您的裝置上被篡改。如所示金額與您預期不符，請停止操作並在付款前聯絡前台。',
        },
        {
          en: 'Charges you incur during the stay, such as late check-out or damage, are separate and are settled with the hotel directly on departure.',
          ms: 'Caj yang ditanggung sepanjang penginapan, seperti daftar keluar lewat atau kerosakan, adalah berasingan dan diselesaikan terus dengan hotel semasa daftar keluar.',
          zh: '住宿期间产生的费用（如延迟退房或物品损坏）另行计算，于退房时直接与本酒店结清。',
          'zh-TW': '住宿期間產生的費用（如延遲退房或物品損壞）另行計算，於退房時直接與本酒店結清。',
        },
      ],
    },
    {
      id: 'currency',
      heading: {
        en: '2. Currency and your bank',
        ms: '2. Mata wang dan bank anda',
        zh: '2. 币种与您的银行',
        'zh-TW': '2. 幣種與您的銀行',
      },
      body: [
        {
          en: 'Payments are taken in the currency shown on your quote. If your card or bank account is held in a different currency, your bank or PayPal sets the exchange rate and may add a conversion or international transaction fee. That fee is charged by them, not by us, and is not part of the amount we receive.',
          ms: 'Pembayaran diterima dalam mata wang yang dipaparkan pada sebut harga anda. Sekiranya kad atau akaun bank anda dalam mata wang berbeza, bank anda atau PayPal menetapkan kadar pertukaran dan mungkin mengenakan fi penukaran atau transaksi antarabangsa. Fi tersebut dikenakan oleh mereka, bukan oleh kami, dan bukan sebahagian daripada amaun yang kami terima.',
          zh: '款项以您报价所示币种收取。若您的银行卡或银行账户使用其他币种，汇率由您的银行或PayPal决定，并可能加收兑换费或国际交易费。该费用由他们而非我们收取，不属于我们实收金额的一部分。',
          'zh-TW': '款項以您報價所示幣種收取。若您的銀行卡或銀行帳戶使用其他幣種，匯率由您的銀行或PayPal決定，並可能加收兌換費或國際交易費。該費用由他們而非我們收取，不屬於我們實收金額的一部分。',
        },
      ],
    },
    {
      id: 'when-confirmed',
      heading: {
        en: '3. When your booking is confirmed',
        ms: '3. Bila tempahan anda disahkan',
        zh: '3. 预订何时确认',
        'zh-TW': '3. 預訂何時確認',
      },
      emphasis: 'requirement',
      body: [
        {
          en: 'Your booking is confirmed when we have received full payment and matched it to your reservation. Until that happens the room is held but not guaranteed, and an unpaid online booking may be released automatically once its holding period expires.',
          ms: 'Tempahan anda disahkan apabila kami telah menerima bayaran penuh dan memadankannya dengan tempahan anda. Sehingga itu, bilik ditahan tetapi tidak dijamin, dan tempahan dalam talian yang belum dibayar boleh dilepaskan secara automatik sebaik tempoh tahanannya tamat.',
          zh: '我们收到全额款项并将其与您的预订对应后，预订方为确认。在此之前客房仅作保留而非保证；未付款的在线预订在保留期限届满后可能被自动释放。',
          'zh-TW': '我們收到全額款項並將其與您的預訂對應後，預訂方為確認。在此之前客房僅作保留而非保證；未付款的線上預訂在保留期限屆滿後可能被自動釋放。',
        },
      ],
    },
    {
      id: 'card-and-paypal',
      heading: {
        en: '4. Paying by card or PayPal',
        ms: '4. Pembayaran dengan kad atau PayPal',
        zh: '4. 以银行卡或PayPal付款',
        'zh-TW': '4. 以銀行卡或PayPal付款',
      },
      body: [
        {
          en: 'Card and PayPal payments are processed by PayPal. You enter your card or PayPal credentials directly with PayPal; the hotel does not see, receive or store your card number, expiry date or security code. PayPal handles that data under its own user agreement and privacy statement, which apply to that part of the transaction.',
          ms: 'Pembayaran kad dan PayPal diproses oleh PayPal. Anda memasukkan butiran kad atau PayPal anda terus kepada PayPal; hotel tidak melihat, menerima atau menyimpan nombor kad, tarikh luput atau kod keselamatan anda. PayPal mengendalikan data tersebut di bawah perjanjian pengguna dan pernyataan privasi mereka sendiri, yang terpakai bagi bahagian transaksi tersebut.',
          zh: '银行卡及PayPal付款均由PayPal处理。您的银行卡或PayPal账户信息直接输入PayPal；酒店不会看到、接收或存储您的卡号、有效期或安全码。该部分交易资料由PayPal依其自身的用户协议与隐私声明处理。',
          'zh-TW': '銀行卡及PayPal付款均由PayPal處理。您的銀行卡或PayPal帳戶資訊直接輸入PayPal；酒店不會看到、接收或儲存您的卡號、有效期或安全碼。該部分交易資料由PayPal依其自身的用戶協議與隱私聲明處理。',
        },
        {
          en: 'What we record is the outcome: the amount, the method, the status, and PayPal’s reference for the transaction, so that we can match it to your booking and answer questions about it later.',
          ms: 'Apa yang kami rekodkan adalah hasilnya: amaun, kaedah, status, dan rujukan PayPal bagi transaksi tersebut, supaya kami dapat memadankannya dengan tempahan anda dan menjawab pertanyaan mengenainya kemudian.',
          zh: '我们仅记录交易结果：金额、方式、状态及PayPal的交易参考号，以便将其与您的预订对应并在日后解答查询。',
          'zh-TW': '我們僅記錄交易結果：金額、方式、狀態及PayPal的交易參考號，以便將其與您的預訂對應並在日後解答查詢。',
        },
        {
          en: 'Do not close or refresh the page while a payment is being authorised. If a payment appears to fail, check your email or account before trying again, so you do not pay twice.',
          ms: 'Jangan tutup atau muat semula halaman semasa pembayaran sedang disahkan. Sekiranya pembayaran kelihatan gagal, semak e-mel atau akaun anda sebelum mencuba lagi, supaya anda tidak membayar dua kali.',
          zh: '付款授权过程中请勿关闭或刷新页面。如付款看似失败，请先查看您的电子邮件或账户再重试，以免重复付款。',
          'zh-TW': '付款授權過程中請勿關閉或刷新頁面。如付款看似失敗，請先查看您的電子郵件或帳戶再重試，以免重複付款。',
        },
      ],
    },
    {
      id: 'bank-transfer',
      heading: {
        en: '5. Paying by bank transfer',
        ms: '5. Pembayaran melalui pindahan bank',
        zh: '5. 以银行转账付款',
        'zh-TW': '5. 以銀行轉帳付款',
      },
      emphasis: 'requirement',
      body: [
        {
          en: 'A bank transfer is not confirmed instantly. When you submit a bank transfer you are telling us that you have made, or will make, a transfer to the account shown. A member of our staff then checks it against our bank records and approves it. Your booking remains unconfirmed until that check is complete.',
          ms: 'Pindahan bank tidak disahkan serta-merta. Apabila anda menghantar pindahan bank, anda memberitahu kami bahawa anda telah membuat, atau akan membuat, pindahan ke akaun yang ditunjukkan. Kakitangan kami kemudian menyemaknya berdasarkan rekod bank kami dan meluluskannya. Tempahan anda kekal belum disahkan sehingga semakan tersebut selesai.',
          zh: '银行转账并非即时确认。您提交银行转账即表示您已经或将向所示账户转账。随后我们的工作人员会与银行记录核对并批准。在该核对完成前，您的预订保持未确认状态。',
          'zh-TW': '銀行轉帳並非即時確認。您提交銀行轉帳即表示您已經或將向所示帳戶轉帳。隨後我們的工作人員會與銀行記錄核對並批准。在該核對完成前，您的預訂保持未確認狀態。',
        },
        {
          en: 'Transfer the exact amount, use the reference we give you, and upload your transfer receipt. An incorrect amount or a missing reference is the most common reason a transfer cannot be matched and a booking lapses.',
          ms: 'Pindahkan amaun yang tepat, gunakan rujukan yang kami berikan, dan muat naik resit pindahan anda. Amaun yang salah atau rujukan yang tiada adalah punca paling lazim pindahan tidak dapat dipadankan dan tempahan terlepas.',
          zh: '请转账准确金额、使用我们提供的参考编号，并上传转账凭证。金额错误或缺少参考编号是转账无法对应、预订失效的最常见原因。',
          'zh-TW': '請轉帳準確金額、使用我們提供的參考編號，並上傳轉帳憑證。金額錯誤或缺少參考編號是轉帳無法對應、預訂失效的最常見原因。',
        },
        {
          en: 'A receipt you upload is used only to verify your payment and is stored with your payment record. Please do not upload a document containing more personal information than the transfer itself requires.',
          ms: 'Resit yang anda muat naik digunakan hanya untuk mengesahkan pembayaran anda dan disimpan bersama rekod pembayaran anda. Sila jangan muat naik dokumen yang mengandungi maklumat peribadi melebihi keperluan pindahan tersebut.',
          zh: '您上传的凭证仅用于核实付款，并与您的付款记录一并保存。请勿上传含有超出转账所需个人信息的文件。',
          'zh-TW': '您上傳的憑證僅用於核實付款，並與您的付款記錄一併保存。請勿上傳含有超出轉帳所需個人資訊的文件。',
        },
      ],
    },
    {
      id: 'refunds',
      heading: {
        en: '6. Refunds',
        ms: '6. Bayaran balik',
        zh: '6. 退款',
        'zh-TW': '6. 退款',
      },
      body: [
        {
          en: 'Where a refund is due under our cancellation terms, we return it to the method you paid with. A card or PayPal refund goes back to the same card or PayPal account; a bank transfer is refunded to the account it came from, and we may need your bank details to do so.',
          ms: 'Sekiranya bayaran balik wajar di bawah terma pembatalan kami, kami akan mengembalikannya melalui kaedah yang anda gunakan untuk membayar. Bayaran balik kad atau PayPal dikembalikan ke kad atau akaun PayPal yang sama; pindahan bank dikembalikan ke akaun asalnya, dan kami mungkin memerlukan butiran bank anda untuk berbuat demikian.',
          zh: '凡符合取消条款的退款，均退回至您付款时所用的方式：银行卡或PayPal付款退回原卡或原PayPal账户；银行转账退回原转出账户，为此我们可能需要您提供银行账户信息。',
          'zh-TW': '凡符合取消條款的退款，均退回至您付款時所用的方式：銀行卡或PayPal付款退回原卡或原PayPal帳戶；銀行轉帳退回原轉出帳戶，為此我們可能需要您提供銀行帳戶資訊。',
        },
        {
          en: 'Refunds are processed by us promptly, but the time it takes to appear depends on your bank or card issuer and is outside our control. Any conversion loss where your account is in another currency is not something we can reimburse.',
          ms: 'Bayaran balik diproses oleh kami dengan segera, tetapi tempoh untuk ia muncul bergantung pada bank atau pengeluar kad anda dan berada di luar kawalan kami. Sebarang kerugian penukaran sekiranya akaun anda dalam mata wang lain bukan sesuatu yang boleh kami ganti.',
          zh: '我们会及时处理退款，但到账时间取决于您的银行或发卡机构，非我们所能控制。若您的账户使用其他币种，由此产生的兑换损失我们无法补偿。',
          'zh-TW': '我們會及時處理退款，但到帳時間取決於您的銀行或發卡機構，非我們所能控制。若您的帳戶使用其他幣種，由此產生的兌換損失我們無法補償。',
        },
      ],
    },
    {
      id: 'problems',
      heading: {
        en: '7. If something goes wrong',
        ms: '7. Sekiranya berlaku masalah',
        zh: '7. 出现问题时',
        'zh-TW': '7. 出現問題時',
      },
      emphasis: 'info',
      body: [
        {
          en: `If you are charged twice, charged the wrong amount, or your payment does not appear against your booking, contact us as soon as you can at ${HOTEL_LEGAL_IDENTITY.email} or ${HOTEL_LEGAL_IDENTITY.phone}. Reception operates ${HOTEL_LEGAL_IDENTITY.receptionHours}. Please have your booking number and the payment reference to hand.`,
          ms: `Sekiranya anda dikenakan caj dua kali, dikenakan amaun yang salah, atau pembayaran anda tidak muncul pada tempahan anda, hubungi kami secepat mungkin di ${HOTEL_LEGAL_IDENTITY.email} atau ${HOTEL_LEGAL_IDENTITY.phone}. Kaunter penyambut tetamu beroperasi ${HOTEL_LEGAL_IDENTITY.receptionHours}. Sila sediakan nombor tempahan dan rujukan pembayaran anda.`,
          zh: `如发生重复扣款、金额错误，或付款未显示在您的预订名下，请尽快通过${HOTEL_LEGAL_IDENTITY.email}或${HOTEL_LEGAL_IDENTITY.phone}联系我们。前台工作时间：${HOTEL_LEGAL_IDENTITY.receptionHours}。请备好您的预订编号与付款参考号。`,
          'zh-TW': `如發生重複扣款、金額錯誤，或付款未顯示在您的預訂名下，請盡快透過${HOTEL_LEGAL_IDENTITY.email}或${HOTEL_LEGAL_IDENTITY.phone}聯絡我們。前台工作時間：${HOTEL_LEGAL_IDENTITY.receptionHours}。請備好您的預訂編號與付款參考號。`,
        },
        {
          en: 'We keep an audit record of every payment action, which lets us trace what happened. Your rights under the Consumer Protection Act 1999 are not affected by these terms.',
          ms: 'Kami menyimpan rekod audit bagi setiap tindakan pembayaran, yang membolehkan kami mengesan apa yang berlaku. Hak anda di bawah Akta Perlindungan Pengguna 1999 tidak terjejas oleh terma ini.',
          zh: '我们对每笔付款操作均保留审计记录，可据此追溯事件经过。您在《1999年消费者保护法令》下的权利不受本条款影响。',
          'zh-TW': '我們對每筆付款操作均保留審計記錄，可據此追溯事件經過。您在《1999年消費者保護法令》下的權利不受本條款影響。',
        },
      ],
    },
    {
      id: 'security-advice',
      heading: {
        en: '8. Keeping your payment safe',
        ms: '8. Memastikan pembayaran anda selamat',
        zh: '8. 保障您的付款安全',
        'zh-TW': '8. 保障您的付款安全',
      },
      body: [
        {
          en: 'We will never telephone, email or message you to ask for your full card number, your card security code, your online banking password, or a one-time passcode. If you receive such a request claiming to be from us, it is not from us — do not act on it, and please tell us.',
          ms: 'Kami tidak sekali-kali akan menelefon, menghantar e-mel atau mesej kepada anda untuk meminta nombor kad penuh, kod keselamatan kad, kata laluan perbankan dalam talian, atau kod laluan sekali guna anda. Sekiranya anda menerima permintaan sedemikian yang mendakwa daripada kami, ia bukan daripada kami — jangan bertindak ke atasnya, dan sila maklumkan kepada kami.',
          zh: '我们绝不会通过电话、电子邮件或短信向您索取完整卡号、卡安全码、网银密码或一次性验证码。如您收到自称是我们的此类请求，那并非来自我们——请勿理会，并请通知我们。',
          'zh-TW': '我們絕不會透過電話、電子郵件或訊息向您索取完整卡號、卡安全碼、網銀密碼或一次性驗證碼。如您收到自稱是我們的此類請求，那並非來自我們——請勿理會，並請通知我們。',
        },
        {
          en: 'Only pay through the payment page reached from your own booking confirmation, and check the address bar before entering any details.',
          ms: 'Hanya buat pembayaran melalui halaman pembayaran yang dicapai daripada pengesahan tempahan anda sendiri, dan semak bar alamat sebelum memasukkan sebarang butiran.',
          zh: '请仅通过您自己的预订确认信息进入的付款页面付款，并在输入任何资料前核对浏览器地址栏。',
          'zh-TW': '請僅透過您自己的預訂確認資訊進入的付款頁面付款，並在輸入任何資料前核對瀏覽器網址列。',
        },
      ],
    },
  ],
};
