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
 *
 * zh/zh-TW copy: DRAFT — pending native/legal review.
 */
export const PRIVACY_NOTICE_VERSION = '2026-09-09';

export const privacyNotice: LegalDocument = {
  id: 'privacy_notice',
  version: PRIVACY_NOTICE_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Privacy Notice (Personal Data Protection Act 2010)',
    ms: 'Notis Privasi (Akta Perlindungan Data Peribadi 2010)',
    zh: '隐私通知（2010年个人资料保护法令）',
    'zh-TW': '隱私通知（2010年個人資料保護法令）',
  },
  summary: {
    en: `${HOTEL_LEGAL_IDENTITY.tradingName} collects personal data so we can take your booking, host your stay, take payment, and meet our legal obligations as a hotel operator in Malaysia. This notice explains what we collect and the control you have over it. It is given to you under section 7 of the Personal Data Protection Act 2010.`,
    ms: `${HOTEL_LEGAL_IDENTITY.tradingName} mengumpul data peribadi supaya kami boleh menerima tempahan anda, menguruskan penginapan anda, menerima bayaran, dan memenuhi kewajipan undang-undang kami sebagai pengendali hotel di Malaysia. Notis ini menerangkan apa yang kami kumpul dan kawalan yang anda miliki ke atasnya. Notis ini diberikan kepada anda di bawah seksyen 7 Akta Perlindungan Data Peribadi 2010.`,
    zh: `${HOTEL_LEGAL_IDENTITY.tradingName}收集个人资料，以便承接您的预订、安排您的住宿、收取款项，并履行我们作为马来西亚酒店经营者的法定义务。本通知说明我们收集的内容以及您对其享有的控制权。本通知依据《2010年个人资料保护法令》第7条向您发出。`,
    'zh-TW': `${HOTEL_LEGAL_IDENTITY.tradingName}收集個人資料，以便承接您的預訂、安排您的住宿、收取款項，並履行我們作為馬來西亞酒店經營者的法定義務。本通知說明我們收集的內容以及您對其享有的控制權。本通知依據《2010年個人資料保護法令》第7條向您發出。`,
  },
  sections: [
    {
      id: 'controller',
      heading: {
        en: '1. Who is responsible for your data',
        ms: '1. Pihak yang bertanggungjawab ke atas data anda',
        zh: '1. 您的个人资料由谁负责',
        'zh-TW': '1. 您的個人資料由誰負責',
      },
      emphasis: 'info',
      body: [
        {
          en: `The data controller is ${HOTEL_LEGAL_IDENTITY.registeredName}, of ${HOTEL_ADDRESS_ONE_LINE}. Questions about this notice, and requests about your data, go to ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail} or ${HOTEL_LEGAL_IDENTITY.phone}.`,
          ms: `Pengawal data ialah ${HOTEL_LEGAL_IDENTITY.registeredName}, beralamat di ${HOTEL_ADDRESS_ONE_LINE}. Pertanyaan mengenai notis ini, dan permohonan berkenaan data anda, boleh dihantar ke ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail} atau ${HOTEL_LEGAL_IDENTITY.phone}.`,
          zh: `个人资料处理者为${HOTEL_LEGAL_IDENTITY.registeredName}，地址：${HOTEL_ADDRESS_ONE_LINE}。有关本通知的查询及涉及您资料的请求，请联系${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}或${HOTEL_LEGAL_IDENTITY.phone}。`,
          'zh-TW': `個人資料處理者為${HOTEL_LEGAL_IDENTITY.registeredName}，地址：${HOTEL_ADDRESS_ONE_LINE}。有關本通知的查詢及涉及您資料的請求，請聯絡${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}或${HOTEL_LEGAL_IDENTITY.phone}。`,
        },
      ],
    },
    {
      id: 'what-we-collect',
      heading: {
        en: '2. What personal data we process',
        ms: '2. Data peribadi yang kami proses',
        zh: '2. 我们处理的个人资料',
        'zh-TW': '2. 我們處理的個人資料',
      },
      body: [
        {
          en: 'We process the following personal data about you. Not all of it applies to every guest — what we hold depends on how you book and what you use.',
          ms: 'Kami memproses data peribadi berikut mengenai anda. Tidak semuanya terpakai kepada setiap tetamu — apa yang kami simpan bergantung pada cara anda menempah dan perkhidmatan yang anda gunakan.',
          zh: '我们处理下列与您相关的个人资料。并非所有项目均适用于每位宾客——我们持有的内容取决于您的预订方式及使用的服务。',
          'zh-TW': '我們處理下列與您相關的個人資料。並非所有項目均適用於每位賓客——我們持有的內容取決於您的預訂方式及使用的服務。',
        },
      ],
      bullets: [
        {
          en: 'Identity and contact details: your name, email address, telephone number, postal address, nationality, date of birth, and your declared guest type (local or foreign) which determines Tourism Tax.',
          ms: 'Butiran identiti dan hubungan: nama, alamat e-mel, nombor telefon, alamat surat-menyurat, kewarganegaraan, tarikh lahir, dan jenis tetamu yang anda isytiharkan (tempatan atau asing) yang menentukan Cukai Pelancongan.',
          zh: '身份及联络资料：姓名、电子邮箱、电话号码、通讯地址、国籍、出生日期，以及您申报的旅客类型（本地或外国），该类型决定旅游税的适用。',
          'zh-TW': '身分及聯絡資料：姓名、電子郵箱、電話號碼、通訊地址、國籍、出生日期，以及您申報的旅客類型（本地或外國），該類型決定旅遊稅的適用。',
        },
        {
          en: 'Booking and stay records: your reservation dates, room and rate, special requests, cleaning preference, arrival and departure, and the history of changes to your booking.',
          ms: 'Rekod tempahan dan penginapan: tarikh tempahan, bilik dan kadar, permintaan khas, pilihan pembersihan, ketibaan dan pelepasan, serta sejarah perubahan pada tempahan anda.',
          zh: '预订及住宿记录：预订日期、客房与房价、特殊要求、清洁偏好、抵达与退房时间，以及您预订的变更历史。',
          'zh-TW': '預訂及住宿記錄：預訂日期、客房與房價、特殊要求、清潔偏好、抵達與退房時間，以及您預訂的變更歷史。',
        },
        {
          en: 'Payment records: the amount, currency, method and status of your payment, the reference of a bank transfer, and any payment receipt you upload. We do not store your full card number — card and PayPal payments are processed by PayPal on their own systems.',
          ms: 'Rekod pembayaran: jumlah, mata wang, kaedah dan status pembayaran anda, rujukan pindahan bank, dan sebarang resit pembayaran yang anda muat naik. Kami tidak menyimpan nombor kad penuh anda — pembayaran kad dan PayPal diproses oleh PayPal pada sistem mereka sendiri.',
          zh: '付款记录：付款金额、币种、方式与状态、银行转账的参考编号，以及您上传的任何付款凭证。我们不存储您的完整卡号——银行卡及PayPal付款均由PayPal在其自有系统中处理。',
          'zh-TW': '付款記錄：付款金額、幣種、方式與狀態、銀行轉帳的參考編號，以及您上傳的任何付款憑證。我們不儲存您的完整卡號——銀行卡及PayPal付款均由PayPal在其自有系統中處理。',
        },
        {
          en: 'Identification data, where you complete identity verification: your identity document type and number, its issuing country and expiry, images of that document, a photograph of your face taken for matching, and any proof of address you supply.',
          ms: 'Data pengenalan, sekiranya anda melengkapkan pengesahan identiti: jenis dan nombor dokumen pengenalan anda, negara pengeluaran dan tarikh luput, imej dokumen tersebut, gambar wajah anda yang diambil untuk tujuan padanan, dan sebarang bukti alamat yang anda berikan.',
          zh: '身份识别资料（在您完成身份验证的情况下）：身份证件类型与号码、签发国家及有效期、该证件的影像、为比对而拍摄的面部照片，以及您提供的任何住址证明。',
          'zh-TW': '身分識別資料（在您完成身分驗證的情況下）：身分證件類型與號碼、簽發國家及有效期、該證件的影像、為比對而拍攝的面部照片，以及您提供的任何住址證明。',
        },
        {
          en: 'Account and technical data, if you create an account: your username, password (stored only as a cryptographic hash, never in readable form), login times, and the IP address and browser you used when you gave consent or signed in.',
          ms: 'Data akaun dan teknikal, sekiranya anda membuka akaun: nama pengguna, kata laluan (disimpan hanya sebagai cincangan kriptografi, tidak pernah dalam bentuk yang boleh dibaca), waktu log masuk, serta alamat IP dan pelayar yang anda gunakan semasa memberi persetujuan atau log masuk.',
          zh: '账户及技术资料（如您注册账户）：用户名、密码（仅以加密散列形式存储，绝不以可读形式保存）、登录时间，以及您同意条款或登录时所用的IP地址与浏览器。',
          'zh-TW': '帳戶及技術資料（如您註冊帳戶）：用戶名、密碼（僅以加密散列形式儲存，絕不以可讀形式保存）、登入時間，以及您同意條款或登入時所用的IP位址與瀏覽器。',
        },
        {
          en: 'Correspondence: messages you send us through the guest portal, support chat, or email.',
          ms: 'Surat-menyurat: mesej yang anda hantar kepada kami melalui portal tetamu, sembang sokongan, atau e-mel.',
          zh: '往来通信：您通过宾客门户、客服对话或电子邮件发送给我们的信息。',
          'zh-TW': '往來通信：您透過賓客門戶、客服對話或電子郵件發送給我們的訊息。',
        },
      ],
    },
    {
      id: 'sensitive-data',
      heading: {
        en: '3. Sensitive personal data',
        ms: '3. Data peribadi sensitif',
        zh: '3. 敏感个人资料',
        'zh-TW': '3. 敏感個人資料',
      },
      body: [
        {
          en: 'Where you complete identity verification, the facial image we ask for is biometric data. Biometric data is treated as sensitive personal data under the Personal Data Protection Act, and we process it only with your separate, explicit consent, which you may refuse. Identity verification is not required in order to book or to stay with us.',
          ms: 'Sekiranya anda melengkapkan pengesahan identiti, imej wajah yang kami minta adalah data biometrik. Data biometrik dianggap sebagai data peribadi sensitif di bawah Akta Perlindungan Data Peribadi, dan kami memprosesnya hanya dengan persetujuan nyata anda yang berasingan, yang boleh anda tolak. Pengesahan identiti bukan syarat untuk menempah atau menginap bersama kami.',
          zh: '在您完成身份验证的情况下，我们要求提供的面部影像属于生物识别资料。生物识别资料依《个人资料保护法令》被视为敏感个人资料，我们仅在取得您单独的明确同意后方予处理，您可以拒绝。预订或入住本酒店不以身份验证为条件。',
          'zh-TW': '在您完成身分驗證的情況下，我們要求提供的面部影像屬於生物識別資料。生物識別資料依《個人資料保護法令》被視為敏感個人資料，我們僅在取得您單獨的明確同意後方予處理，您可以拒絕。預訂或入住本酒店不以身分驗證為條件。',
        },
        {
          en: 'We use it for one purpose only: to confirm that the person presenting the identity document is the person in it. We do not use it to profile you, and we do not share it for advertising.',
          ms: 'Kami menggunakannya untuk satu tujuan sahaja: mengesahkan bahawa individu yang mengemukakan dokumen pengenalan adalah individu di dalam dokumen tersebut. Kami tidak menggunakannya untuk pemprofilan, dan kami tidak berkongsi ia untuk tujuan pengiklanan.',
          zh: '我们仅将其用于一个目的：确认出示身份证件者即证件上的人。我们不会用其进行画像分析，也不会为广告宣传而共享。',
          'zh-TW': '我們僅將其用於一個目的：確認出示身分證件者即證件上的人。我們不會用其進行畫像分析，也不會為廣告宣傳而共享。',
        },
      ],
    },
    {
      id: 'where-it-comes-from',
      heading: {
        en: '4. Where the data comes from',
        ms: '4. Sumber data',
        zh: '4. 资料来源',
        'zh-TW': '4. 資料來源',
      },
      body: [
        {
          en: 'Almost all of the data we hold comes directly from you, when you search, book, pay, check in, or contact us. Where you booked through a travel agent or an online travel platform, your booking and contact details reach us from that platform. Payment confirmations reach us from our payment provider.',
          ms: 'Hampir keseluruhan data yang kami simpan datang terus daripada anda, semasa anda mencari, menempah, membayar, mendaftar masuk, atau menghubungi kami. Sekiranya anda menempah melalui ejen pelancongan atau platform pelancongan dalam talian, butiran tempahan dan hubungan anda sampai kepada kami daripada platform tersebut. Pengesahan pembayaran sampai kepada kami daripada penyedia pembayaran kami.',
          zh: '我们持有的资料几乎全部直接来自您——在您查询、预订、付款、办理入住或联系我们时。如您通过旅行社或在线旅游平台预订，您的预订及联络资料由该平台转交给我们。付款确认信息则来自我们的支付服务提供商。',
          'zh-TW': '我們持有的資料幾乎全部直接來自您——在您查詢、預訂、付款、辦理入住或聯絡我們時。如您透過旅行社或線上旅遊平台預訂，您的預訂及聯絡資料由該平台轉交給我們。付款確認資訊則來自我們的支付服務提供商。',
        },
      ],
    },
    {
      id: 'why-we-use-it',
      heading: {
        en: '5. Why we use it',
        ms: '5. Sebab kami menggunakannya',
        zh: '5. 使用目的',
        'zh-TW': '5. 使用目的',
      },
      bullets: [
        {
          en: 'To take, confirm, change and cancel your booking, and to contact you about it.',
          ms: 'Untuk menerima, mengesahkan, mengubah dan membatalkan tempahan anda, serta menghubungi anda mengenainya.',
          zh: '承接、确认、更改及取消您的预订，并就相关事宜与您联系。',
          'zh-TW': '承接、確認、更改及取消您的預訂，並就相關事宜與您聯絡。',
        },
        {
          en: 'To take payment, issue receipts and invoices, and investigate payment disputes.',
          ms: 'Untuk menerima bayaran, mengeluarkan resit dan invois, serta menyiasat pertikaian pembayaran.',
          zh: '收取款项、开具收据与发票，以及调查付款争议。',
          'zh-TW': '收取款項、開具收據與發票，以及調查付款爭議。',
        },
        {
          en: 'To host your stay: allocate a room, meet your requests, and provide services you ask for.',
          ms: 'Untuk menguruskan penginapan anda: memperuntukkan bilik, memenuhi permintaan anda, dan menyediakan perkhidmatan yang anda minta.',
          zh: '安排您的住宿：分配客房、满足您的要求并提供您所请求的服务。',
          'zh-TW': '安排您的住宿：分配客房、滿足您的要求並提供您所請求的服務。',
        },
        {
          en: 'To meet legal obligations: maintaining the guest register required of hotel operators, assessing and remitting Tourism Tax under the Tourism Tax Act 2017, keeping accounting and tax records, and responding to lawful requests from the authorities.',
          ms: 'Untuk memenuhi kewajipan undang-undang: menyelenggara daftar tetamu yang diwajibkan ke atas pengendali hotel, menaksir dan meremitkan Cukai Pelancongan di bawah Akta Cukai Pelancongan 2017, menyimpan rekod perakaunan dan cukai, serta memenuhi permintaan sah pihak berkuasa.',
          zh: '履行法定义务：依法保存酒店经营者须备置的住客登记册、依《2017年旅游税法令》核算并缴纳旅游税、保存会计及税务记录，以及回应执法机关的合法要求。',
          'zh-TW': '履行法定義務：依法保存酒店經營者須備置的住客登記冊、依《2017年旅遊稅法令》核算並繳納旅遊稅、保存會計及稅務記錄，以及回應執法機關的合法要求。',
        },
        {
          en: 'To keep the hotel and our systems secure, prevent fraud, and protect our legal position.',
          ms: 'Untuk memastikan keselamatan hotel dan sistem kami, mencegah penipuan, dan melindungi kedudukan undang-undang kami.',
          zh: '保障酒店及我们系统的安全、防范欺诈，并维护我们的合法权益。',
          'zh-TW': '保障酒店及我們系統的安全、防範欺詐，並維護我們的合法權益。',
        },
        {
          en: 'To operate loyalty and rewards, if you choose to join.',
          ms: 'Untuk mengendalikan program kesetiaan dan ganjaran, sekiranya anda memilih untuk menyertainya.',
          zh: '在您选择加入时运营忠诚计划与奖励。',
          'zh-TW': '在您選擇加入時營運忠誠計劃與獎勵。',
        },
        {
          en: 'To send you offers and news — only where you have separately opted in, and only until you opt out.',
          ms: 'Untuk menghantar tawaran dan berita kepada anda — hanya sekiranya anda telah bersetuju secara berasingan, dan hanya sehingga anda menarik diri.',
          zh: '向您发送优惠与消息——仅在您单独同意订阅的前提下，且直至您退订为止。',
          'zh-TW': '向您發送優惠與消息——僅在您單獨同意訂閱的前提下，且直至您退訂為止。',
        },
      ],
    },
    {
      id: 'who-we-share-with',
      heading: {
        en: '6. Who we share it with',
        ms: '6. Pihak yang kami kongsikan data',
        zh: '6. 资料共享对象',
        'zh-TW': '6. 資料共享對象',
      },
      body: [
        {
          en: 'We do not sell your personal data. We disclose it only to the following classes of third parties, and only so far as each needs it:',
          ms: 'Kami tidak menjual data peribadi anda. Kami hanya mendedahkannya kepada kelas pihak ketiga berikut, dan hanya setakat yang diperlukan oleh setiap satu:',
          zh: '我们不出售您的个人资料。我们仅向下列类别的第三方披露，且仅限于其各自所需的范围：',
          'zh-TW': '我們不出售您的個人資料。我們僅向下列類別的第三方披露，且僅限於其各自所需的範圍：',
        },
      ],
      bullets: [
        {
          en: 'Payment providers, including PayPal, which processes card and PayPal payments on its own systems and under its own privacy terms, and the banks handling transfers.',
          ms: 'Penyedia pembayaran, termasuk PayPal, yang memproses pembayaran kad dan PayPal pada sistem mereka sendiri dan di bawah terma privasi mereka sendiri, serta bank yang mengendalikan pindahan.',
          zh: '支付服务提供商，包括PayPal（在其自有系统中并依其自身隐私条款处理银行卡及PayPal付款），以及办理转账的银行。',
          'zh-TW': '支付服務提供商，包括PayPal（在其自有系統中並依其自身隱私條款處理銀行卡及PayPal付款），以及辦理轉帳的銀行。',
        },
        {
          en: 'Technology suppliers who host, back up and maintain this system on our instructions, and our email delivery provider.',
          ms: 'Pembekal teknologi yang menghos, membuat sandaran dan menyelenggara sistem ini atas arahan kami, serta penyedia penghantaran e-mel kami.',
          zh: '按我们指示托管、备份及维护本系统的技术供应商，以及我们的电子邮件发送服务商。',
          'zh-TW': '按我們指示託管、備份及維護本系統的技術供應商，以及我們的電子郵件發送服務商。',
        },
        {
          en: 'Travel agents and online travel platforms, where your booking was made through them.',
          ms: 'Ejen pelancongan dan platform pelancongan dalam talian, sekiranya tempahan anda dibuat melalui mereka.',
          zh: '旅行社及在线旅游平台（如您的预订经由其完成）。',
          'zh-TW': '旅行社及線上旅遊平台（如您的預訂經由其完成）。',
        },
        {
          en: 'Government agencies and regulators where the law requires it, including tax and tourism authorities, the police, and the Personal Data Protection Commissioner.',
          ms: 'Agensi kerajaan dan pengawal selia sekiranya dikehendaki oleh undang-undang, termasuk pihak berkuasa cukai dan pelancongan, polis, dan Pesuruhjaya Perlindungan Data Peribadi.',
          zh: '法律要求时向政府机构及监管机关披露，包括税务与旅游主管机关、警方及个人资料保护专员。',
          'zh-TW': '法律要求時向政府機構及監管機關披露，包括稅務與旅遊主管機關、警方及個人資料保護專員。',
        },
        {
          en: 'Our professional advisers — accountants, auditors and lawyers — under a duty of confidence.',
          ms: 'Penasihat profesional kami — akauntan, juruaudit dan peguam — di bawah kewajipan kerahsiaan.',
          zh: '我们的专业顾问——会计师、审计师及律师——在保密义务约束下。',
          'zh-TW': '我們的專業顧問——會計師、審計師及律師——在保密義務約束下。',
        },
      ],
    },
    {
      id: 'transfer-abroad',
      heading: {
        en: '7. Transfers outside Malaysia',
        ms: '7. Pemindahan ke luar Malaysia',
        zh: '7. 向马来西亚境外传输',
        'zh-TW': '7. 向馬來西亞境外傳輸',
      },
      body: [
        {
          en: 'Some of the suppliers above, in particular our payment and email providers, process data on servers outside Malaysia. Where personal data leaves Malaysia we take reasonable steps to satisfy ourselves that it will receive protection substantially similar to that required by the Personal Data Protection Act 2010, and that it will be used only for the purposes described here.',
          ms: 'Sebahagian pembekal di atas, khususnya penyedia pembayaran dan e-mel kami, memproses data pada pelayan di luar Malaysia. Sekiranya data peribadi keluar dari Malaysia, kami mengambil langkah munasabah untuk memastikan ia menerima perlindungan yang secara substansialnya setara dengan yang dikehendaki oleh Akta Perlindungan Data Peribadi 2010, dan bahawa ia digunakan hanya untuk tujuan yang dinyatakan di sini.',
          zh: '上述部分供应商（尤其是我们的支付与电子邮件服务商）在马来西亚境外的服务器上处理资料。当个人资料传出马来西亚时，我们会采取合理措施确信其获得与《2010年个人资料保护法令》所要求实质上相当的保护，且仅用于本通知所述目的。',
          'zh-TW': '上述部分供應商（尤其是我們的支付與電子郵件服務商）在馬來西亞境外的伺服器上處理資料。當個人資料傳出馬來西亞時，我們會採取合理措施確信其獲得與《2010年個人資料保護法令》所要求實質上相當的保護，且僅用於本通知所述目的。',
        },
      ],
    },
    {
      id: 'is-it-obligatory',
      heading: {
        en: '8. Is giving us this data obligatory?',
        ms: '8. Adakah pemberian data ini diwajibkan?',
        zh: '8. 提供资料是否为义务？',
        'zh-TW': '8. 提供資料是否為義務？',
      },
      emphasis: 'requirement',
      body: [
        {
          en: 'Some of it is. We cannot accept a booking without a name, a contact email, and your declared guest type, because we cannot confirm the stay, reach you, or assess Tourism Tax without them. On arrival, hotel-keeping and tax rules oblige us to record the identification of the guests staying in the room. If you do not provide these, we will not be able to take the booking or complete check-in.',
          ms: 'Sebahagiannya diwajibkan. Kami tidak dapat menerima tempahan tanpa nama, e-mel hubungan, dan jenis tetamu yang anda isytiharkan, kerana kami tidak dapat mengesahkan penginapan, menghubungi anda, atau menaksir Cukai Pelancongan tanpanya. Semasa ketibaan, peraturan pengurusan hotel dan cukai mewajibkan kami merekodkan pengenalan tetamu yang menginap di dalam bilik. Sekiranya anda tidak memberikannya, kami tidak akan dapat menerima tempahan atau melengkapkan daftar masuk.',
          zh: '部分资料是必须的。没有姓名、联络邮箱及您申报的旅客类型，我们无法接受预订，因为无法确认住宿、与您联络或核算旅游税。抵达时，酒店管理规则与税务规定要求我们登记入住客房宾客的身份信息。如您不提供上述资料，我们将无法接受预订或办理入住。',
          'zh-TW': '部分資料是必須的。沒有姓名、聯絡郵箱及您申報的旅客類型，我們無法接受預訂，因為無法確認住宿、與您聯絡或核算旅遊稅。抵達時，酒店管理規則與稅務規定要求我們登記入住客房賓客的身分資訊。如您不提供上述資料，我們將無法接受預訂或辦理入住。',
        },
        {
          en: 'The rest is voluntary. Your telephone number, address, date of birth, special requests, loyalty membership, marketing consent, and online identity verification are all optional, and declining them does not affect your booking or the price you pay.',
          ms: 'Selebihnya adalah sukarela. Nombor telefon, alamat, tarikh lahir, permintaan khas, keahlian kesetiaan, persetujuan pemasaran, dan pengesahan identiti dalam talian semuanya adalah pilihan, dan penolakan tidak menjejaskan tempahan anda atau harga yang anda bayar.',
          zh: '其余均属自愿。电话号码、住址、出生日期、特殊要求、忠诚会员资格、营销同意及在线身份验证均为可选，拒绝提供不会影响您的预订或所付价格。',
          'zh-TW': '其餘均屬自願。電話號碼、住址、出生日期、特殊要求、忠誠會員資格、行銷同意及線上身分驗證均為可選，拒絕提供不會影響您的預訂或所付價格。',
        },
      ],
    },
    {
      id: 'your-choices',
      heading: {
        en: '9. Choices you can make',
        ms: '9. Pilihan yang boleh anda buat',
        zh: '9. 您可以作出的选择',
        'zh-TW': '9. 您可以作出的選擇',
      },
      bullets: [
        {
          en: 'You may withdraw your consent to marketing at any time, from your account settings, by using the unsubscribe link in any marketing email, or by contacting us. We will stop sending it.',
          ms: 'Anda boleh menarik balik persetujuan pemasaran pada bila-bila masa, melalui tetapan akaun anda, menggunakan pautan berhenti melanggan dalam mana-mana e-mel pemasaran, atau dengan menghubungi kami. Kami akan berhenti menghantarnya.',
          zh: '您可随时撤回营销同意：在账户设置中操作、使用任一营销邮件中的退订链接，或直接联系我们。我们将停止发送。',
          'zh-TW': '您可隨時撤回行銷同意：在帳戶設定中操作、使用任一行銷郵件中的退訂連結，或直接聯絡我們。我們將停止發送。',
        },
        {
          en: 'You may withdraw your consent to identity verification and ask us to delete the images we hold, unless we are required to keep them by law.',
          ms: 'Anda boleh menarik balik persetujuan pengesahan identiti dan meminta kami memadamkan imej yang kami simpan, melainkan kami dikehendaki menyimpannya oleh undang-undang.',
          zh: '您可撤回对身份验证的同意，并要求我们删除所持有的影像，但法律规定必须留存的情形除外。',
          'zh-TW': '您可撤回對身分驗證的同意，並要求我們刪除所持有的影像，但法律規定必須留存的情形除外。',
        },
        {
          en: 'Withdrawing consent does not affect processing already carried out, and we may still need to process data to complete a booking you have made or to meet a legal duty.',
          ms: 'Penarikan balik persetujuan tidak menjejaskan pemprosesan yang telah dilakukan, dan kami mungkin masih perlu memproses data untuk melengkapkan tempahan yang telah anda buat atau memenuhi kewajipan undang-undang.',
          zh: '撤回同意不影响已进行的处理；为完成您已作出的预订或履行法定义务，我们可能仍需处理相关资料。',
          'zh-TW': '撤回同意不影響已進行的處理；為完成您已作出的預訂或履行法定義務，我們可能仍需處理相關資料。',
        },
      ],
    },
    {
      id: 'your-rights',
      heading: {
        en: '10. Your rights, and how to complain',
        ms: '10. Hak anda, dan cara membuat aduan',
        zh: '10. 您的权利与投诉方式',
        'zh-TW': '10. 您的權利與投訴方式',
      },
      emphasis: 'info',
      body: [
        {
          en: 'Under the Personal Data Protection Act 2010 you have the right to ask us for a copy of the personal data we hold about you, to have inaccurate data corrected, to limit how we process it, to withdraw consent, and — following the 2024 amendments to the Act — to ask us to transmit your data to another data controller where that is technically feasible.',
          ms: 'Di bawah Akta Perlindungan Data Peribadi 2010, anda berhak meminta salinan data peribadi yang kami simpan mengenai anda, membetulkan data yang tidak tepat, menghadkan cara kami memprosesnya, menarik balik persetujuan, dan — berikutan pindaan 2024 kepada Akta tersebut — meminta kami memindahkan data anda kepada pengawal data lain sekiranya ia boleh dilaksanakan dari segi teknikal.',
          zh: '依《2010年个人资料保护法令》，您有权要求我们提供所持有的您的个人资料副本、更正不准确的资料、限制我们的处理方式、撤回同意，并且——依该法令2024年修正案——在技术可行的情况下要求我们将您的资料传输给另一资料处理者。',
          'zh-TW': '依《2010年個人資料保護法令》，您有權要求我們提供所持有的您的個人資料副本、更正不準確的資料、限制我們的處理方式、撤回同意，並且——依該法令2024年修正案——在技術可行的情況下要求我們將您的資料傳輸給另一資料處理者。',
        },
        {
          en: `Send any of these requests to ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. We will respond within the period allowed by the Act. A fee prescribed by the Act may apply to a data access request.`,
          ms: `Hantar sebarang permohonan ini ke ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. Kami akan membalas dalam tempoh yang dibenarkan oleh Akta. Fi yang ditetapkan oleh Akta boleh dikenakan bagi permohonan akses data.`,
          zh: `请将上述任何请求发送至${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}。我们将在法令允许的期限内回复。查阅资料请求可能需缴付法令规定的费用。`,
          'zh-TW': `請將上述任何請求發送至${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}。我們將在法令允許的期限內回覆。查閱資料請求可能需繳付法令規定的費用。`,
        },
        {
          en: 'If you are not satisfied with how we have handled your data, you may complain to us first, and you may also complain to the Personal Data Protection Commissioner, Malaysia (Jabatan Perlindungan Data Peribadi).',
          ms: 'Sekiranya anda tidak berpuas hati dengan cara kami mengendalikan data anda, anda boleh membuat aduan kepada kami terlebih dahulu, dan anda juga boleh membuat aduan kepada Pesuruhjaya Perlindungan Data Peribadi, Malaysia (Jabatan Perlindungan Data Peribadi).',
          zh: '如您对我们处理您资料的方式不满意，可先向我们投诉，亦可向马来西亚个人资料保护专员（Jabatan Perlindungan Data Peribadi）投诉。',
          'zh-TW': '如您對我們處理您資料的方式不滿意，可先向我們投訴，亦可向馬來西亞個人資料保護專員（Jabatan Perlindungan Data Peribadi）投訴。',
        },
      ],
    },
    {
      id: 'retention',
      heading: {
        en: '11. How long we keep it',
        ms: '11. Tempoh penyimpanan',
        zh: '11. 保留期限',
        'zh-TW': '11. 保留期限',
      },
      body: [
        {
          en: 'We keep personal data only for as long as the purpose it was collected for requires, and then for as long as the law obliges us to. Booking, payment and accounting records are kept for the period required by Malaysian tax and companies legislation. Identity verification images are kept only for as long as needed to verify you and to meet the guest-register obligation, and are then deleted. Marketing consent records are kept for as long as you remain subscribed, plus a period afterwards to evidence that consent existed.',
          ms: 'Kami menyimpan data peribadi hanya selama yang diperlukan oleh tujuan pengumpulannya, dan selepas itu selama yang diwajibkan oleh undang-undang. Rekod tempahan, pembayaran dan perakaunan disimpan bagi tempoh yang dikehendaki oleh perundangan cukai dan syarikat Malaysia. Imej pengesahan identiti disimpan hanya selama yang diperlukan untuk mengesahkan anda dan memenuhi kewajipan daftar tetamu, dan kemudian dipadamkan. Rekod persetujuan pemasaran disimpan selama anda kekal melanggan, serta suatu tempoh selepas itu bagi membuktikan persetujuan tersebut wujud.',
          zh: '我们仅在收集目的所需期限内及法律义务要求的期限内保存个人资料。预订、付款及会计记录按马来西亚税务及公司法规要求的期限保存。身份验证影像仅在核实您的身份及履行住客登记义务所需期间保存，随后删除。营销同意记录在您的订阅存续期间及其后一段时间内保存，以证明该同意曾经存在。',
          'zh-TW': '我們僅在收集目的所需期限內及法律義務要求的期限內保存個人資料。預訂、付款及會計記錄按馬來西亞稅務及公司法規要求的期限保存。身分驗證影像僅在核實您的身分及履行住客登記義務所需期間保存，隨後刪除。行銷同意記錄在您的訂閱存續期間及其後一段時間內保存，以證明該同意曾經存在。',
        },
      ],
    },
    {
      id: 'security',
      heading: {
        en: '12. How we protect it, and what happens if something goes wrong',
        ms: '12. Cara kami melindunginya, dan tindakan jika berlaku insiden',
        zh: '12. 保护措施与事故应对',
        'zh-TW': '12. 保護措施與事故應對',
      },
      body: [
        {
          en: 'We take practical steps to protect your data: encrypted connections, access limited to staff whose role requires it, recorded audit trails of who viewed or changed a record, hashed passwords, and optional two-factor authentication on accounts.',
          ms: 'Kami mengambil langkah praktikal untuk melindungi data anda: sambungan tersulit, akses terhad kepada kakitangan yang memerlukannya mengikut peranan, jejak audit yang merekodkan siapa yang melihat atau mengubah rekod, kata laluan tercincang, dan pengesahan dua faktor sebagai pilihan pada akaun.',
          zh: '我们采取切实可行的措施保护您的资料：加密连接、仅限岗位职责所需的员工访问、记录谁在何时查阅或修改了资料的审计轨迹、散列存储密码，以及可选的账户双重验证。',
          'zh-TW': '我們採取切實可行的措施保護您的資料：加密連接、僅限崗位職責所需的員工存取、記錄誰在何時查閱或修改了資料的審計軌跡、散列儲存密碼，以及可選的帳戶雙重驗證。',
        },
        {
          en: 'If a breach of personal data occurs that causes or is likely to cause significant harm, we will notify the Personal Data Protection Commissioner, and will notify you where the Act requires it.',
          ms: 'Sekiranya berlaku pelanggaran data peribadi yang menyebabkan atau berkemungkinan menyebabkan kemudaratan yang ketara, kami akan memaklumkan Pesuruhjaya Perlindungan Data Peribadi, dan akan memaklumkan anda sekiranya dikehendaki oleh Akta.',
          zh: '如发生造成或可能造成重大损害的个人资料泄露事件，我们将通知个人资料保护专员，并在法令要求时通知您本人。',
          'zh-TW': '如發生造成或可能造成重大損害的個人資料洩露事件，我們將通知個人資料保護專員，並在法令要求時通知您本人。',
        },
      ],
    },
    {
      id: 'cookies',
      heading: {
        en: '13. Cookies and local storage',
        ms: '13. Kuki dan storan setempat',
        zh: '13. Cookies与本地存储',
        'zh-TW': '13. Cookies與本地儲存',
      },
      body: [
        {
          en: 'This site stores a small amount of data in your browser so that it works: keeping you signed in, holding your booking session, and remembering interface preferences such as your chosen language. These are necessary for the service you asked for. We do not use advertising or cross-site tracking cookies.',
          ms: 'Laman ini menyimpan sedikit data dalam pelayar anda supaya ia berfungsi: mengekalkan log masuk anda, menyimpan sesi tempahan anda, dan mengingati keutamaan antara muka seperti bahasa pilihan anda. Ini diperlukan untuk perkhidmatan yang anda minta. Kami tidak menggunakan kuki pengiklanan atau penjejakan merentas laman.',
          zh: '本网站在您的浏览器中存储少量数据以维持正常运作：保持您的登录状态、保留您的预订会话，以及记住界面偏好（如您选择的语言）。这些是您所请求服务的必要组成。我们不使用广告或跨站追踪Cookie。',
          'zh-TW': '本網站在您的瀏覽器中儲存少量資料以維持正常運作：保持您的登入狀態、保留您的預訂工作階段，以及記住介面偏好（如您選擇的語言）。這些是您所請求服務的必要組成。我們不使用廣告或跨站追蹤Cookie。',
        },
      ],
    },
    {
      id: 'changes',
      heading: {
        en: '14. Changes to this notice',
        ms: '14. Perubahan pada notis ini',
        zh: '14. 本通知的变更',
        'zh-TW': '14. 本通知的變更',
      },
      body: [
        {
          en: 'If we change this notice we will publish the new version here with a new version number and effective date. Where a change materially affects how we use data you have already given us, we will ask for your consent again.',
          ms: 'Sekiranya kami mengubah notis ini, kami akan menerbitkan versi baharu di sini dengan nombor versi dan tarikh berkuat kuasa yang baharu. Sekiranya perubahan tersebut menjejaskan secara material cara kami menggunakan data yang telah anda berikan, kami akan meminta persetujuan anda semula.',
          zh: '如本通知有变更，我们将在此发布新版本，并注明新的版本号与生效日期。如变更对您已提供资料的使用方式有实质影响，我们将再次征得您的同意。',
          'zh-TW': '如本通知有變更，我們將在此發布新版本，並註明新的版本號與生效日期。如變更對您已提供資料的使用方式有實質影響，我們將再次徵得您的同意。',
        },
      ],
    },
  ],
};
