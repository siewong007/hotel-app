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
 *
 * zh/zh-TW copy: DRAFT — pending native/legal review.
 */
export const EKYC_CONSENT_VERSION = '2026-09-09';

/** Points shown inline above the eKYC consent checkbox. */
export const EKYC_KEY_POINTS: LocalizedText[] = [
  {
    en: 'You are about to upload an identity document and a photograph of your face. Your facial image is biometric data, which the law treats as sensitive.',
    ms: 'Anda akan memuat naik dokumen pengenalan dan gambar wajah anda. Imej wajah anda adalah data biometrik, yang dianggap sensitif di sisi undang-undang.',
    zh: '您即将上传身份证件及您的面部照片。面部影像属于生物识别资料，法律视其为敏感资料。',
    'zh-TW': '您即將上傳身分證件及您的面部照片。面部影像屬於生物識別資料，法律視其為敏感資料。',
  },
  {
    en: 'We use it for one purpose only: to check that you are the person shown on the document. It is not used for advertising or profiling.',
    ms: 'Kami menggunakannya untuk satu tujuan sahaja: menyemak bahawa anda adalah individu yang ditunjukkan pada dokumen tersebut. Ia tidak digunakan untuk pengiklanan atau pemprofilan.',
    zh: '我们仅将其用于一个目的：核实您是证件上所示的人。不用于广告或画像分析。',
    'zh-TW': '我們僅將其用於一個目的：核實您是證件上所示的人。不用於廣告或畫像分析。',
  },
  {
    en: 'This is optional. You can book and stay with us without it, and you can withdraw this consent and ask us to delete the images at any time.',
    ms: 'Ini adalah pilihan. Anda boleh menempah dan menginap bersama kami tanpanya, dan anda boleh menarik balik persetujuan ini serta meminta kami memadamkan imej tersebut pada bila-bila masa.',
    zh: '此为可选项目。您不完成亦可预订并入住本酒店，且可随时撤回本同意并要求我们删除相关影像。',
    'zh-TW': '此為可選項目。您不完成亦可預訂並入住本酒店，且可隨時撤回本同意並要求我們刪除相關影像。',
  },
];

export const ekycConsent: LegalDocument = {
  id: 'ekyc_biometric',
  version: EKYC_CONSENT_VERSION,
  effectiveDate: '2026-09-09',
  title: {
    en: 'Identity Verification — Consent to Process Sensitive Personal Data',
    ms: 'Pengesahan Identiti — Persetujuan Memproses Data Peribadi Sensitif',
    zh: '身份验证——处理敏感个人资料的同意',
    'zh-TW': '身分驗證——處理敏感個人資料的同意',
  },
  summary: {
    en: 'Identity verification asks you for an identity document and a photograph of your face. Because a facial image is biometric data, and biometric data is sensitive personal data under the Personal Data Protection Act 2010, we may only process it with your explicit consent. This notice tells you exactly what you would be agreeing to.',
    ms: 'Pengesahan identiti meminta anda mengemukakan dokumen pengenalan dan gambar wajah anda. Oleh kerana imej wajah adalah data biometrik, dan data biometrik merupakan data peribadi sensitif di bawah Akta Perlindungan Data Peribadi 2010, kami hanya boleh memprosesnya dengan persetujuan nyata anda. Notis ini menerangkan dengan tepat apa yang anda persetujui.',
    zh: '身份验证需要您提供身份证件及您的面部照片。由于面部影像属于生物识别资料，而生物识别资料是《2010年个人资料保护法令》下的敏感个人资料，我们只有在取得您的明确同意后才能处理。本通知将准确说明您所同意的内容。',
    'zh-TW': '身分驗證需要您提供身分證件及您的面部照片。由於面部影像屬於生物識別資料，而生物識別資料是《2010年個人資料保護法令》下的敏感個人資料，我們只有在取得您的明確同意後才能處理。本通知將準確說明您所同意的內容。',
  },
  sections: [
    {
      id: 'what-we-take',
      heading: {
        en: '1. What we ask for',
        ms: '1. Apa yang kami minta',
        zh: '1. 我们要求提供的资料',
        'zh-TW': '1. 我們要求提供的資料',
      },
      emphasis: 'requirement',
      bullets: [
        {
          en: 'Your identity document type, number, issuing country, and issue and expiry dates.',
          ms: 'Jenis dokumen pengenalan, nombor, negara pengeluaran, serta tarikh dikeluarkan dan tarikh luput.',
          zh: '您的身份证件类型、号码、签发国家，以及签发与到期日期。',
          'zh-TW': '您的身分證件類型、號碼、簽發國家，以及簽發與到期日期。',
        },
        {
          en: 'An image of the front of the document, and of the back where the document has one.',
          ms: 'Imej bahagian hadapan dokumen, dan bahagian belakang sekiranya dokumen tersebut mempunyainya.',
          zh: '证件正面的影像；证件有背面的，亦包括背面影像。',
          'zh-TW': '證件正面的影像；證件有背面的，亦包括背面影像。',
        },
        {
          en: 'A photograph of your face (a selfie), used to compare against the photograph on the document.',
          ms: 'Gambar wajah anda (swafoto), digunakan untuk dibandingkan dengan gambar pada dokumen tersebut.',
          zh: '您的面部照片（自拍），用于与证件上的照片比对。',
          'zh-TW': '您的面部照片（自拍），用於與證件上的照片比對。',
        },
        {
          en: 'Optionally, a proof of address document if you choose to provide one.',
          ms: 'Sebagai pilihan, dokumen bukti alamat sekiranya anda memilih untuk memberikannya.',
          zh: '您可选择提供住址证明文件（非必须）。',
          'zh-TW': '您可選擇提供住址證明文件（非必須）。',
        },
      ],
    },
    {
      id: 'purpose',
      heading: {
        en: '2. What we do with it',
        ms: '2. Apa yang kami lakukan dengannya',
        zh: '2. 我们如何使用这些资料',
        'zh-TW': '2. 我們如何使用這些資料',
      },
      body: [
        {
          en: 'We use it solely to verify your identity: to confirm the document is valid and that the person presenting it is the person it belongs to. This supports the guest register that hotel operators in Malaysia are required to keep, and helps us prevent booking fraud and identity misuse.',
          ms: 'Kami menggunakannya semata-mata untuk mengesahkan identiti anda: memastikan dokumen tersebut sah dan bahawa individu yang mengemukakannya adalah pemiliknya. Ini menyokong daftar tetamu yang wajib disimpan oleh pengendali hotel di Malaysia, dan membantu kami mencegah penipuan tempahan dan penyalahgunaan identiti.',
          zh: '我们仅将其用于核实您的身份：确认证件有效，且出示证件者即证件持有人。这支持马来西亚法律要求酒店经营者保存的住客登记，并有助于我们防范预订欺诈及身份盗用。',
          'zh-TW': '我們僅將其用於核實您的身分：確認證件有效，且出示證件者即證件持有人。這支持馬來西亞法律要求酒店經營者保存的住客登記，並有助於我們防範預訂欺詐及身分盜用。',
        },
        {
          en: 'We do not use your facial image to profile you, to track you between visits for marketing, or to train any automated system, and we do not sell or licence it to anyone.',
          ms: 'Kami tidak menggunakan imej wajah anda untuk memprofil anda, menjejaki anda antara kunjungan bagi tujuan pemasaran, atau melatih mana-mana sistem automatik, dan kami tidak menjual atau melesenkannya kepada sesiapa.',
          zh: '我们不会将您的面部影像用于画像分析、跨次访问的营销追踪或训练任何自动化系统，也不会将其出售或授权给任何人。',
          'zh-TW': '我們不會將您的面部影像用於畫像分析、跨次訪問的行銷追蹤或訓練任何自動化系統，也不會將其出售或授權給任何人。',
        },
      ],
    },
    {
      id: 'who-sees-it',
      heading: {
        en: '3. Who can see it',
        ms: '3. Siapa yang boleh melihatnya',
        zh: '3. 谁可以查阅',
        'zh-TW': '3. 誰可以查閱',
      },
      body: [
        {
          en: 'Only staff whose role requires them to verify guest identity can open these documents, and every access is recorded in an audit trail. We disclose them outside the hotel only where the law compels us to, such as a lawful request from the police or a regulator.',
          ms: 'Hanya kakitangan yang peranannya memerlukan pengesahan identiti tetamu boleh membuka dokumen ini, dan setiap capaian direkodkan dalam jejak audit. Kami mendedahkannya di luar hotel hanya sekiranya undang-undang mewajibkan, seperti permintaan sah daripada polis atau pengawal selia.',
          zh: '只有岗位职责需要核实宾客身份的员工才可查阅这些文件，且每次查阅均记录在审计轨迹中。我们仅在法律强制要求时向酒店以外披露，例如警方或监管机关的合法请求。',
          'zh-TW': '只有崗位職責需要核實賓客身分的員工才可查閱這些文件，且每次查閱均記錄在審計軌跡中。我們僅在法律強制要求時向酒店以外披露，例如警方或監管機關的合法請求。',
        },
      ],
    },
    {
      id: 'retention',
      heading: {
        en: '4. How long we keep it',
        ms: '4. Tempoh penyimpanan',
        zh: '4. 保留期限',
        'zh-TW': '4. 保留期限',
      },
      body: [
        {
          en: 'We keep the images only for as long as we need them to verify you and to satisfy the guest-register and tax obligations connected to your stay, and we delete them after that. The verification result — whether the check passed — is kept with your guest record for longer, because that is what we rely on.',
          ms: 'Kami menyimpan imej tersebut hanya selama yang diperlukan untuk mengesahkan anda dan memenuhi kewajipan daftar tetamu serta cukai berkaitan penginapan anda, dan kami memadamkannya selepas itu. Keputusan pengesahan — sama ada semakan berjaya — disimpan bersama rekod tetamu anda untuk tempoh lebih lama, kerana itulah yang kami jadikan sandaran.',
          zh: '影像仅在核实您的身份及履行与您住宿相关的住客登记和税务义务所需期间保存，其后即予删除。验证结果（核验是否通过）会随您的住客记录保存更久，因为那是我们的依据所在。',
          'zh-TW': '影像僅在核實您的身分及履行與您住宿相關的住客登記和稅務義務所需期間保存，其後即予刪除。驗證結果（核驗是否通過）會隨您的住客記錄保存更久，因為那是我們的依據所在。',
        },
      ],
    },
    {
      id: 'voluntary',
      heading: {
        en: '5. This is voluntary, and you can change your mind',
        ms: '5. Ini adalah sukarela, dan anda boleh berubah fikiran',
        zh: '5. 本项属自愿，您可以改变主意',
        'zh-TW': '5. 本項屬自願，您可以改變主意',
      },
      emphasis: 'info',
      body: [
        {
          en: 'You do not have to verify your identity online. You can book, pay and stay without it, and you will not be charged more or offered less for declining. If you decline, we will simply sight your identification at reception when you arrive, as we do for every guest.',
          ms: 'Anda tidak perlu mengesahkan identiti anda dalam talian. Anda boleh menempah, membayar dan menginap tanpanya, dan anda tidak akan dikenakan caj lebih tinggi atau ditawarkan kurang kerana menolaknya. Sekiranya anda menolak, kami akan menyemak dokumen pengenalan anda di kaunter penyambut tetamu semasa ketibaan, sebagaimana yang kami lakukan bagi setiap tetamu.',
          zh: '您不必在线完成身份验证。不验证亦可预订、付款并入住，不会因拒绝而被多收费或减少服务。如您拒绝，我们将在您到店时于前台核验证件，与对每位宾客的做法一致。',
          'zh-TW': '您不必線上完成身分驗證。不驗證亦可預訂、付款並入住，不會因拒絕而被多收費或減少服務。如您拒絕，我們將在您到店時於前台核驗證件，與對每位賓客的做法一致。',
        },
        {
          en: `You may withdraw this consent at any time by contacting ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. We will stop processing the images and delete them, unless a law requires us to keep them. Withdrawal does not undo processing that has already lawfully taken place.`,
          ms: `Anda boleh menarik balik persetujuan ini pada bila-bila masa dengan menghubungi ${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}. Kami akan berhenti memproses imej tersebut dan memadamkannya, melainkan undang-undang mewajibkan kami menyimpannya. Penarikan balik tidak membatalkan pemprosesan yang telah dilakukan secara sah sebelum itu.`,
          zh: `您可随时联系${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}撤回本同意。我们将停止处理并删除相关影像，但法律要求保留的情形除外。撤回不影响此前已依法进行的处理。`,
          'zh-TW': `您可隨時聯絡${HOTEL_LEGAL_IDENTITY.dataProtectionContactEmail}撤回本同意。我們將停止處理並刪除相關影像，但法律要求保留的情形除外。撤回不影響此前已依法進行的處理。`,
        },
      ],
    },
  ],
};
