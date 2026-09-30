// 繁體中文 copy — same Copy shape as en.ts; written for Traditional readers,
// not a Simplified passthrough. Facts interpolate from config/site.ts;
// `{{name}}` slots are filled at runtime.
// DRAFT — pending native-speaker review.
import type { Copy } from './en';
import { SITE, WEB_RATES, SHOW_PRICES, CLAIM_ONLY_HOTEL } from '../config/site';

const minRate = Math.min(...Object.values(WEB_RATES));

export const zhTW: Copy = {
  meta: {
    title: 'Salim Inn——詩巫Farley商業中心酒店',
    description: `Salim Inn位於詩巫Jalan Salim的Farley中心地帶：29間空調客房、免費Wi-Fi、24小時前台及門前賓客停車位${SHOW_PRICES ? `，直接預訂每晚RM${minRate}起` : ''}。`,
  },
  brand: {
    name: 'SALIM INN',
    place: 'Farley · 詩巫',
    backToStart: 'Salim Inn——返回首頁',
    logoAlt: 'Salim Inn——舒適潔淨，實惠安心',
  },
  nav: {
    aria: '主導覽',
    label: '章節',
    play: '播放影片',
    pause: '暫停影片',
    replay: '重新播放',
    book: '直接預訂',
    skipLink: '略過影片直接預訂',
  },
  account: {
    signIn: '登入',
    myAccount: '我的帳戶',
    adminConsole: '管理後台',
    bookAnotherStay: '再次預訂',
  },
  lang: { aria: '語言' },
  preloader: {
    loading: '正在載入街區',
    warming: '燈光預熱中',
    almost: '即將完成',
    ready: '捲動開始',
  },
  chapterNav: {
    labels: ['Farley', '街區', 'Salim Inn', '抵達', '前台', '客房', '舉步即達', '預訂'],
    aria: '第{{id}}章：{{label}}',
  },
  chapters: [
    {
      id: 1,
      eyebrow: 'Farley · 砂拉越詩巫',
      title: 'Farley · 詩巫',
      body: '一切所需，舉步即達。',
    },
    {
      id: 2,
      eyebrow: '街區',
      title: '超市、烘焙店、咖啡館與藥房——出門即達。',
      body: 'Farley超市、美食廣場與日常商店環繞酒店街區。',
    },
    {
      id: 3,
      eyebrow: 'Lorong Salim 17',
      title: 'Salim Inn',
      body: CLAIM_ONLY_HOTEL ? 'Farley唯一的酒店。' : '位於Farley中心。',
    },
    {
      id: 4,
      eyebrow: '抵達',
      title: '抵達、門前停車、辦理入住。',
      body: '標有賓客專用的停車位就在大堂門前、雨棚之下。',
    },
    {
      id: 5,
      eyebrow: '前台',
      title: '前台全天不打烊。',
      body: '下午2:00起入住 · 中午12:00前退房 · 前台24小時服務',
    },
    {
      id: 6,
      eyebrow: '29間客房 · 5種房型',
      title: '五種住宿方式。',
      body: '每間客房均配備免費高速Wi-Fi、空調、衛星電視及獨立衛浴。',
    },
    {
      id: 7,
      eyebrow: '舉步即達',
      title: '一切舉步即達。',
      body: `詩巫機場（SBW）約 ${SITE.distances.airportKm} 公里 · 詩巫市中心約 ${SITE.distances.cityCentreKm} 公里 · Farley超市步行約5分鐘`,
    },
    {
      id: 8,
      eyebrow: '直接預訂',
      title: '透過Salim Inn直接預訂。',
      body: SHOW_PRICES ? `每晚RM${minRate}起 · 官網價` : '直接預訂更優惠。',
    },
  ],
  bookingCard: {
    blurb: '請在Salim Inn預訂門戶選擇日期與房型。下午2:00起入住，中午12:00前退房。',
    book: '直接預訂',
    call: '致電 {{phone}}',
  },
  welcome: {
    eyebrow: '歡迎來到SALIM INN',
    title: '現代舒適。<br><em>實在價格。</em>',
    intro:
      '自2012年起，Salim Inn一直接待尋求詩巫實用舒適住宿的旅客。酒店坐落於Farley商業中心，購物與餐飲近在咫尺，貼心團隊全天候為您服務。',
  },
  trust: {
    aria: '酒店亮點',
    items: [
      { strong: '24小時', span: '前台與閉路電視' },
      { strong: '5分鐘', span: '步行至Farley超市' },
      { strong: '自2012年', span: '在詩巫迎接賓客' },
    ],
  },
  rooms: {
    eyebrow: '客房與官網價格',
    title: '每種住宿方式<br>都有合適客房。',
    blurb: '從簡約大床房到家庭套房，每次入住均包含舒適一夜所需的一切。',
    items: [
      { tag: '01 · 舒適雙人', name: '標準大床房' },
      { tag: '02 · 更寬敞', name: '豪華大床房' },
      { tag: '03 · 雙床', name: '高級雙床房' },
      { tag: '04 · 結伴同行', name: '家庭房' },
      { tag: '05 · 大床+大床', name: '家庭套房' },
    ],
    perNight: ' / 晚',
    checkAvailability: '查詢空房',
    rateNote: '所示為Salim Inn發佈時的促銷官網價格。空房情況與最終價格將在預訂時確認。',
  },
  gallery: {
    eyebrow: '一睹內部',
    title: '先看看您將<br>安頓的地方。',
    blurb: 'Salim Inn官方照片讓您在預訂前看到真實客房佈局、衛浴與Farley周邊環境。',
    items: [
      { alt: 'Salim Inn豪華大床房，配備大床與床頭家具', title: '豪華大床房', caption: '更寬敞的床鋪與實用的空間佈局' },
      { alt: 'Salim Inn高級雙床房，配有兩張獨立單人床', title: '高級雙床房', caption: '獨立雙床，住宿更靈活' },
      { alt: 'Salim Inn家庭房，配有多張床', title: '家庭房', caption: '同住的寬敞空間' },
      { alt: 'Salim Inn家庭套房，配備大床與書桌', title: '家庭套房', caption: '與家人共享的寬裕空間' },
      { alt: 'Salim Inn客房，配有窗戶、電視、書桌與空調', title: '客房內部', caption: '電視、工作區與空調' },
      { alt: 'Salim Inn浴室，馬桶上方的鍍鉻毛巾架放著乾淨毛巾', title: '獨立浴室', caption: '乾淨毛巾，到店即備' },
      { alt: 'Salim Inn浴室，配有立柱式洗手盆與磨砂窗', title: '套房衛浴', caption: '明亮、乾淨、實用' },
      { alt: 'Salim Inn浴室，配有浴簾、立柱洗手盆與潔身噴頭', title: '熱水淋浴', caption: '淋浴、馬桶與潔身噴頭' },
      { alt: 'Salim Inn附近的Farley商業中心外觀', title: 'Farley就在門口', caption: '購物餐飲近在咫尺' },
      { alt: 'Salim Inn與cafe.cafe臨街外觀，門前有車輛停放', title: 'Salim Inn臨街門臉', caption: '在路邊一眼可辨' },
    ],
  },
  amenities: {
    eyebrow: '標準配備',
    title: '所需皆有。<br>冗餘皆無。',
    blurb: '周到的基礎配備讓住宿保持互聯、舒適與安全。',
    items: [
      { title: '免費高速Wi-Fi', body: 'Salim Inn全館覆蓋，時刻在線。' },
      { title: '空調客房', body: '屬於您的涼爽舒適空間。' },
      { title: '房內液晶電視', body: '衛星電視頻道伴您放鬆。' },
      { title: '24小時前台', body: '隨時為您提供幫助。' },
      { title: '24小時監控', body: '全天候現場監控。' },
      { title: '家庭友好客房', body: '結伴出行的靈活之選。' },
    ],
  },
  stay: {
    eyebrow: '規劃行程',
    title: '就在Farley。<br>隨時恭候。',
    body: '下午2:00起入住，中午12:00前退房。可線上預訂，如需幫助選擇房型也可直接聯絡Salim Inn。',
    cta: '查詢空房',
    labels: { address: '地址', call: '電話', email: '郵箱' },
    address: 'Lot 21–22, Lorong Salim 17<br>96000 Sibu, Sarawak, Malaysia',
  },
  faq: {
    eyebrow: '常見問題',
    title: '常見<br>問題',
    blurb: '簡明解答助您順利抵達。如需其他幫助，請聯絡24小時前台。',
    items: [
      {
        q: '入住和退房時間？',
        a: '下午2:00起辦理入住，中午12:00前退房。延遲退房視房態而定並可能收取額外費用；下午3:00後可能按全天房價收費。',
      },
      {
        q: '預訂如何確認？',
        a: '收到全額付款後預訂即獲確認。支援的付款方式包括信用卡、PayPal及銀行轉帳。',
      },
      {
        q: '取消政策是什麼？',
        a: '在抵達前至少三天通知取消可獲得退款。不足三天通知或未到店入住，可能收取首晚房費。',
      },
      {
        q: '每間客房都有Wi-Fi和空調嗎？',
        a: '是的。Salim Inn全館覆蓋免費Wi-Fi，客房均配備空調與電視。',
      },
      {
        q: 'Salim Inn在哪裡？',
        a: 'Salim Inn位於詩巫Farley商業中心Lorong Salim 17號Lot 21–22。Farley超市步行約五分鐘。',
      },
      {
        q: '可以隨時聯絡到人嗎？',
        a: `可以。前台24小時服務。致電<a href="tel:${SITE.phoneE164}">${SITE.phoneDisplay}</a>或發送郵件至<a href="mailto:${SITE.email}">${SITE.email}</a>。`,
      },
    ],
  },
  cta: {
    title: '讓詩巫<br>更像家一點。',
    book: '預訂住宿',
    call: '致電Salim Inn',
  },
  footer: {
    osm: '地圖資料 © OpenStreetMap 貢獻者',
    rights: `© ${new Date().getFullYear()} Salim Inn, Sibu`,
  },
  mobileCta: {
    rate: SHOW_PRICES ? '每晚 <strong>RM{{min}}</strong> 起' : '直接預訂',
  },
};
