import type { LocalizedText } from './types';

/** Informational cookie copy; this is not a consentable legal document. */
export const cookieUsage = {
  languageLabel: {
    en: 'Language',
    ms: 'Bahasa',
    zh: '语言',
    'zh-TW': '語言',
  },
  title: {
    en: 'Cookie Usage',
    ms: 'Penggunaan Kuki',
    zh: 'Cookie 使用说明',
    'zh-TW': 'Cookie 使用說明',
  },
  privacyLink: {
    en: 'Privacy Policy',
    ms: 'Dasar Privasi',
    zh: '隐私政策',
    'zh-TW': '隱私權政策',
  },
  paragraphs: [
    {
      en: 'We save your language and display preferences in this browser. If you have signed in, saved account information helps us show your account link.',
      ms: 'Kami menyimpan pilihan bahasa dan paparan anda dalam pelayar ini. Jika anda telah log masuk, maklumat akaun tersimpan membantu kami memaparkan pautan akaun anda.',
      zh: '我们会在此浏览器中保存您的语言和显示偏好。如果您已登录，保存的账户信息会帮助我们显示您的账户链接。',
      'zh-TW': '我們會在此瀏覽器中保存您的語言和顯示偏好。如果您已登入，保存的帳戶資料會協助我們顯示您的帳戶連結。',
    },
    {
      en: 'Sign-in cookies and temporary browser storage keep your account and guest booking session working.',
      ms: 'Kuki log masuk dan storan pelayar sementara membantu akaun dan sesi tempahan tetamu anda berfungsi.',
      zh: '登录 Cookie 和临时浏览器存储会帮助您的账户和宾客预订会话正常运行。',
      'zh-TW': '登入 Cookie 和暫存瀏覽器儲存會協助您的帳戶和賓客預訂工作階段正常運作。',
    },
    {
      en: 'This landing page does not currently send usage events to an analytics provider.',
      ms: 'Halaman ini tidak menghantar isyarat penggunaan kepada penyedia analitik pada masa ini.',
      zh: '本落地页目前不会向分析服务商发送使用事件。',
      'zh-TW': '本落地頁目前不會向分析服務商傳送使用事件。',
    },
    {
      en: 'You can block or clear cookies and site storage in your browser settings. Doing so can reset your language or display preferences and sign you out.',
      ms: 'Anda boleh menyekat atau memadam kuki dan storan laman melalui tetapan pelayar. Tindakan itu boleh menetapkan semula bahasa atau pilihan paparan dan melog keluar anda.',
      zh: '您可以在浏览器设置中阻止或清除 Cookie 和网站存储。这样可能会重置语言或显示偏好，并使您退出登录。',
      'zh-TW': '您可以在瀏覽器設定中封鎖或清除 Cookie 和網站儲存。這可能會重設語言或顯示偏好，並使您登出。',
    },
  ] satisfies LocalizedText[],
};
