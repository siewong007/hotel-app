// 简体中文 copy — same Copy shape as en.ts. Facts interpolate from
// config/site.ts; `{{name}}` slots are filled at runtime.
// DRAFT — pending native-speaker review.
import type { Copy } from './en';
import { SITE, WEB_RATES, SHOW_PRICES, CLAIM_ONLY_HOTEL } from '../config/site';

const minRate = Math.min(...Object.values(WEB_RATES));

export const zh: Copy = {
  meta: {
    title: 'Salim Inn——诗巫Farley商业中心酒店',
    description: `Salim Inn位于诗巫Jalan Salim的Farley中心地带：29间空调客房、免费Wi-Fi、24小时前台及门前宾客停车位${SHOW_PRICES ? `，直接预订每晚RM${minRate}起` : ''}。`,
  },
  brand: {
    name: 'SALIM INN',
    place: 'Farley · 诗巫',
    backToStart: 'Salim Inn——返回首页',
    logoAlt: 'Salim Inn——舒适洁净，实惠安心',
  },
  nav: {
    aria: '主导航',
    label: '章节',
    play: '播放影片',
    pause: '暂停影片',
    replay: '重新播放',
    book: '直接预订',
    skipLink: '跳过影片直接预订',
  },
  account: {
    signIn: '登录',
    myAccount: '我的账户',
    adminConsole: '管理后台',
    bookAnotherStay: '再次预订',
  },
  lang: { aria: '语言' },
  preloader: {
    loading: '正在加载街区',
    warming: '灯光预热中',
    almost: '即将完成',
    ready: '滚动开始',
  },
  chapterNav: {
    labels: ['Farley', '街区', 'Salim Inn', '抵达', '前台', '客房', '举步即达', '预订'],
    aria: '第{{id}}章：{{label}}',
  },
  chapters: [
    {
      id: 1,
      eyebrow: 'Farley · 砂拉越诗巫',
      title: 'Farley · 诗巫',
      body: '一切所需，举步即达。',
    },
    {
      id: 2,
      eyebrow: '街区',
      title: '超市、烘焙店、咖啡馆与药房——出门即达。',
      body: 'Farley超市、美食广场与日常商店环绕酒店街区。',
    },
    {
      id: 3,
      eyebrow: 'Lorong Salim 17',
      title: 'Salim Inn',
      body: CLAIM_ONLY_HOTEL ? 'Farley唯一的酒店。' : '位于Farley中心。',
    },
    {
      id: 4,
      eyebrow: '抵达',
      title: '抵达、门前停车、办理入住。',
      body: '标有宾客专用的停车位就在大堂门前、雨棚之下。',
    },
    {
      id: 5,
      eyebrow: '前台',
      title: '前台全天不打烊。',
      body: '下午2:00起入住 · 中午12:00前退房 · 前台24小时服务',
    },
    {
      id: 6,
      eyebrow: '29间客房 · 5种房型',
      title: '五种住宿方式。',
      body: '每间客房均配备免费高速Wi-Fi、空调、卫星电视及独立卫浴。',
    },
    {
      id: 7,
      eyebrow: '举步即达',
      title: '一切举步即达。',
      body: `诗巫机场（SBW）约 ${SITE.distances.airportKm} 公里 · 诗巫市中心约 ${SITE.distances.cityCentreKm} 公里 · Farley超市步行约5分钟`,
    },
    {
      id: 8,
      eyebrow: '直接预订',
      title: '通过Salim Inn直接预订。',
      body: SHOW_PRICES ? `每晚RM${minRate}起 · 官网价` : '直接预订更优惠。',
    },
  ],
  bookingCard: {
    blurb: '请在Salim Inn预订门户选择日期与房型。下午2:00起入住，中午12:00前退房。',
    book: '直接预订',
    call: '致电 {{phone}}',
  },
  welcome: {
    eyebrow: '欢迎来到SALIM INN',
    title: '现代舒适。<br><em>实在价格。</em>',
    intro:
      '自2012年起，Salim Inn一直接待寻求诗巫实用舒适住宿的旅客。酒店坐落于Farley商业中心，购物与餐饮近在咫尺，贴心团队全天候为您服务。',
  },
  trust: {
    aria: '酒店亮点',
    items: [
      { strong: '24小时', span: '前台与闭路电视' },
      { strong: '5分钟', span: '步行至Farley超市' },
      { strong: '自2012年', span: '在诗巫迎接宾客' },
    ],
  },
  rooms: {
    eyebrow: '客房与官网价格',
    title: '每种住宿方式<br>都有合适客房。',
    blurb: '从简约大床房到家庭套房，每次入住均包含舒适一夜所需的一切。',
    items: [
      { tag: '01 · 舒适双人', name: '标准大床房' },
      { tag: '02 · 更宽敞', name: '豪华大床房' },
      { tag: '03 · 双床', name: '高级双床房' },
      { tag: '04 · 结伴同行', name: '家庭房' },
      { tag: '05 · 大床+大床', name: '家庭套房' },
    ],
    perNight: ' / 晚',
    checkAvailability: '查询空房',
    rateNote: '所示为Salim Inn发布时的促销官网价格。空房情况与最终价格将在预订时确认。',
  },
  gallery: {
    eyebrow: '一睹内部',
    title: '先看看您将<br>安顿的地方。',
    blurb: 'Salim Inn官方照片让您在预订前看到真实客房布局、卫浴与Farley周边环境。',
    items: [
      { alt: 'Salim Inn豪华大床房，配备大床与床头家具', title: '豪华大床房', caption: '更宽敞的床铺与实用的空间布局' },
      { alt: 'Salim Inn高级双床房，配有两张独立单人床', title: '高级双床房', caption: '独立双床，住宿更灵活' },
      { alt: 'Salim Inn家庭房，配有多张床', title: '家庭房', caption: '同住的宽敞空间' },
      { alt: 'Salim Inn家庭套房，配备大床与书桌', title: '家庭套房', caption: '与家人共享的宽裕空间' },
      { alt: 'Salim Inn客房，配有窗户、电视、书桌与空调', title: '客房内部', caption: '电视、工作区与空调' },
      { alt: 'Salim Inn浴室，马桶上方的镀铬毛巾架放着干净毛巾', title: '独立浴室', caption: '干净毛巾，到店即备' },
      { alt: 'Salim Inn浴室，配有立柱式洗手盆与磨砂窗', title: '套房卫浴', caption: '明亮、干净、实用' },
      { alt: 'Salim Inn浴室，配有浴帘、立柱洗手盆与洁身喷头', title: '热水淋浴', caption: '淋浴、马桶与洁身喷头' },
      { alt: 'Salim Inn附近的Farley商业中心外观', title: 'Farley就在门口', caption: '购物餐饮近在咫尺' },
      { alt: 'Salim Inn与cafe.cafe临街外观，门前有车辆停放', title: 'Salim Inn临街门脸', caption: '在路边一眼可辨' },
    ],
  },
  amenities: {
    eyebrow: '标准配备',
    title: '所需皆有。<br>冗余皆无。',
    blurb: '周到的基础配备让住宿保持互联、舒适与安全。',
    items: [
      { title: '免费高速Wi-Fi', body: 'Salim Inn全馆覆盖，时刻在线。' },
      { title: '空调客房', body: '属于您的凉爽舒适空间。' },
      { title: '房内液晶电视', body: '卫星电视频道伴您放松。' },
      { title: '24小时前台', body: '随时为您提供帮助。' },
      { title: '24小时监控', body: '全天候现场监控。' },
      { title: '家庭友好客房', body: '结伴出行的灵活之选。' },
    ],
  },
  stay: {
    eyebrow: '规划行程',
    title: '就在Farley。<br>随时恭候。',
    body: '下午2:00起入住，中午12:00前退房。可在线预订，如需帮助选择房型也可直接联系Salim Inn。',
    cta: '查询空房',
    labels: { address: '地址', call: '电话', email: '邮箱' },
    address: 'Lot 21–22, Lorong Salim 17<br>96000 Sibu, Sarawak, Malaysia',
  },
  faq: {
    eyebrow: '常见问题',
    title: '常见<br>问题',
    blurb: '简明解答助您顺利抵达。如需其他帮助，请联系24小时前台。',
    items: [
      {
        q: '入住和退房时间？',
        a: '下午2:00起办理入住，中午12:00前退房。延迟退房视房态而定并可能收取额外费用；下午3:00后可能按全天房价收费。',
      },
      {
        q: '预订如何确认？',
        a: '收到全额付款后预订即获确认。支持的付款方式包括信用卡、PayPal及银行转账。',
      },
      {
        q: '取消政策是什么？',
        a: '在抵达前至少三天通知取消可获得退款。不足三天通知或未到店入住，可能收取首晚房费。',
      },
      {
        q: '每间客房都有Wi-Fi和空调吗？',
        a: '是的。Salim Inn全馆覆盖免费Wi-Fi，客房均配备空调与电视。',
      },
      {
        q: 'Salim Inn在哪里？',
        a: 'Salim Inn位于诗巫Farley商业中心Lorong Salim 17号Lot 21–22。Farley超市步行约五分钟。',
      },
      {
        q: '可以随时联系到人吗？',
        a: `可以。前台24小时服务。致电<a href="tel:${SITE.phoneE164}">${SITE.phoneDisplay}</a>或发送邮件至<a href="mailto:${SITE.email}">${SITE.email}</a>。`,
      },
    ],
  },
  cta: {
    title: '让诗巫<br>更像家一点。',
    book: '预订住宿',
    call: '致电Salim Inn',
  },
  footer: {
    osm: '地图数据 © OpenStreetMap 贡献者',
    rights: `© ${new Date().getFullYear()} Salim Inn, Sibu`,
  },
  mobileCta: {
    rate: SHOW_PRICES ? '每晚 <strong>RM{{min}}</strong> 起' : '直接预订',
  },
};
