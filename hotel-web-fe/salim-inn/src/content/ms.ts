// Bahasa Malaysia copy — same Copy shape as en.ts. Room type names stay in
// English: they are product names that match the booking portal and the photo
// library. Facts interpolate from config/site.ts; `{{name}}` slots are filled
// at runtime.
import type { Copy } from './en';
import { SITE, WEB_RATES, SHOW_PRICES, CLAIM_ONLY_HOTEL } from '../config/site';

const minRate = Math.min(...Object.values(WEB_RATES));

export const ms: Copy = {
  meta: {
    title: 'Salim Inn — Hotel di Farley Commercial Centre, Sibu',
    description: `Salim Inn ialah hotel di pusat Farley, Jalan Salim, Sibu: 29 bilik berhawa dingin, Wi-Fi percuma, kaunter penyambut tetamu 24 jam dan tempat letak kereta tetamu di depan pintu. Tempah terus${SHOW_PRICES ? ` dari RM${minRate} semalam` : ''}.`,
  },
  brand: {
    name: 'SALIM INN',
    place: 'Farley, Sibu',
    backToStart: 'Salim Inn — kembali ke permulaan',
    logoAlt: 'Salim Inn — Keselesaan yang Selesa, Bersih dan Berpatutan',
  },
  nav: {
    aria: 'Navigasi utama',
    label: 'Bab',
    play: 'Mainkan filem',
    pause: 'Jeda filem',
    replay: 'Main semula filem',
    book: 'Tempah terus',
    skipLink: 'Langkau filem dan tempah',
  },
  account: {
    signIn: 'Log masuk',
    myAccount: 'Akaun saya',
    adminConsole: 'Konsol pentadbir',
    bookAnotherStay: 'Tempah penginapan lain',
  },
  lang: { aria: 'Bahasa' },
  preloader: {
    loading: 'Memuatkan kejiranan',
    warming: 'Memanaskan lampu',
    almost: 'Hampir siap',
    ready: 'Skrol untuk bermula',
  },
  chapterNav: {
    labels: ['Farley', 'Kejiranan', 'Salim Inn', 'Ketibaan', 'Resepsionis', 'Bilik', 'Sekeliling', 'Tempah'],
    aria: 'Bab {{id}}: {{label}}',
  },
  chapters: [
    {
      id: 1,
      eyebrow: 'Farley · Sibu, Sarawak',
      title: 'Farley, Sibu.',
      body: 'Semua keperluan anda, hanya sejengkal jarak.',
    },
    {
      id: 2,
      eyebrow: 'Kejiranan',
      title: 'Barangan runcit, bakeri, kafe dan farmasi — hanya beberapa langkah dari pintu anda.',
      body: 'Pasar raya, medan selera dan kedai harian Farley mengelilingi blok hotel.',
    },
    {
      id: 3,
      eyebrow: 'Lorong Salim 17',
      title: 'Salim Inn',
      body: CLAIM_ONLY_HOTEL ? 'Satu-satunya hotel di Farley.' : 'Di pusat Farley.',
    },
    {
      id: 4,
      eyebrow: 'Ketibaan',
      title: 'Tiba, parkir di depan pintu, daftar masuk.',
      body: 'Petak tetamu bertanda betul-betul di hadapan lobi, di bawah kanopi.',
    },
    {
      id: 5,
      eyebrow: 'Resepsionis',
      title: 'Kaunter kami tidak pernah tutup.',
      body: `Daftar masuk dari ${SITE.checkIn.label} · Daftar keluar sebelum ${SITE.checkOut.label} · Kaunter 24 jam`,
    },
    {
      id: 6,
      eyebrow: '29 bilik · 5 jenis bilik',
      title: 'Lima cara untuk menginap.',
      body: 'Setiap bilik mempunyai Wi-Fi berkelajuan tinggi percuma, penyaman udara, TV satelit dan bilik air en suite sendiri.',
    },
    {
      id: 7,
      eyebrow: 'Hanya sejengkal',
      title: 'Semuanya hanya sejengkal.',
      body: `Lapangan Terbang Sibu (SBW) ≈ ${SITE.distances.airportKm} km · Pusat bandar Sibu ≈ ${SITE.distances.cityCentreKm} km · Pasar raya Farley kira-kira 5 minit berjalan kaki`,
    },
    {
      id: 8,
      eyebrow: 'Tempah terus',
      title: 'Tempah terus dengan Salim Inn.',
      body: SHOW_PRICES ? `Dari RM${minRate} semalam · kadar web` : 'Terbaik apabila anda menempah terus.',
    },
  ],
  bookingCard: {
    blurb: `Pilih tarikh dan bilik anda di portal tempahan Salim Inn. Daftar masuk dari ${SITE.checkIn.label}, daftar keluar sebelum ${SITE.checkOut.label}.`,
    book: 'Tempah terus',
    call: 'Hubungi {{phone}}',
  },
  welcome: {
    eyebrow: 'SELAMAT DATANG KE SALIM INN',
    title: 'Keselesaan moden.<br><em>Nilai jujur.</em>',
    intro:
      'Sejak 2012, Salim Inn mengalu-alukan pengembara yang mencari penginapan praktikal dan selesa di Sibu. Terletak di Farley Commercial Centre, kedai-kedai dan tempat makan betul-betul di luar—manakala pasukan kami sedia membantu sepanjang masa.',
  },
  trust: {
    aria: 'Ciri-ciri utama hotel',
    items: [
      { strong: '24 jam', span: 'Resepsionis dan CCTV' },
      { strong: '5 minit', span: 'Berjalan kaki ke Pasar Raya Farley' },
      { strong: 'Sejak 2012', span: 'Mengalu-alukan tetamu di Sibu' },
    ],
  },
  rooms: {
    eyebrow: 'BILIK & KADAR WEB',
    title: 'Bilik untuk setiap<br>jenis penginapan.',
    blurb: 'Dari bilik queen ringkas hingga suite keluarga, setiap penginapan merangkumi keperluan untuk malam yang selesa.',
    items: [
      { tag: '01 · SELESA UNTUK DUA', name: 'Standard Queen' },
      { tag: '02 · RUANG TAMBAHAN', name: 'Deluxe King' },
      { tag: '03 · DUA KATIL', name: 'Superior Twin' },
      { tag: '04 · MELANCONG BERSAMA', name: 'Family Room' },
      { tag: '05 · KING + QUEEN', name: 'Family Suite' },
    ],
    perNight: '/ malam',
    checkAvailability: 'Semak ketersediaan',
    rateNote:
      'Kadar web promosi dipaparkan oleh Salim Inn pada masa penerbitan. Ketersediaan dan harga muktamad disahkan semasa tempahan.',
  },
  gallery: {
    eyebrow: 'MELIHAT KE DALAM',
    title: 'Lihat tempat anda<br>akan berehat.',
    blurb: 'Gambar rasmi Salim Inn menunjukkan susun atur bilik sebenar, bilik air dan persekitaran Farley sebelum anda menempah.',
    items: [
      { alt: 'Bilik Deluxe King Salim Inn dengan katil dan perabot sisi katil', title: 'Deluxe King', caption: 'Katil lebih besar dan susun atur praktikal' },
      { alt: 'Bilik Superior Twin Salim Inn dengan dua katil berasingan', title: 'Superior Twin', caption: 'Katil berasingan untuk penginapan fleksibel' },
      { alt: 'Bilik keluarga Salim Inn dengan beberapa katil', title: 'Family Room', caption: 'Ruang untuk tinggal bersama' },
      { alt: 'Suite keluarga Salim Inn dengan katil queen dan meja kerja', title: 'Family Suite', caption: 'Ruang untuk berehat bersama' },
      { alt: 'Bilik tetamu Salim Inn dengan tingkap, televisyen, meja kerja dan penyaman udara', title: 'Dalam bilik anda', caption: 'TV, ruang kerja dan penyaman udara' },
      { alt: 'Bilik air Salim Inn dengan tuala bersih di rak krom di atas tandas', title: 'Bilik air peribadi', caption: 'Tuala bersih, sedia semasa ketibaan' },
      { alt: 'Bilik air Salim Inn dengan singki pedestal dan tingkap kabur', title: 'Bilik air en suite', caption: 'Cerah, bersih dan praktikal' },
      { alt: 'Bilik air Salim Inn dengan langsir mandian, singki pedestal dan bidet', title: 'Pancuran air panas', caption: 'Pancuran, WC dan bidet' },
      { alt: 'Bahagian luar Farley Commercial Centre berhampiran Salim Inn', title: 'Farley di depan pintu anda', caption: 'Kedai dan makanan berdekatan' },
      { alt: 'Fasad menghadap jalan Salim Inn dan cafe.cafe dengan kereta diparkir di luar', title: 'Wajah hadapan Salim Inn', caption: 'Mudah dikenali dari jalan' },
    ],
  },
  amenities: {
    eyebrow: 'KEPERLUAN SEBAGAI STANDARD',
    title: 'Semua yang anda perlukan.<br>Tiada yang tidak perlu.',
    blurb: 'Asas yang teliti memastikan penginapan anda terhubung, selesa dan selamat.',
    items: [
      { title: 'Wi-Fi berkelajuan tinggi percuma', body: 'Kekal berhubung di seluruh Salim Inn.' },
      { title: 'Bilik berhawa dingin', body: 'Ruang sejuk dan selesa anda sendiri.' },
      { title: 'Televisyen LCD dalam bilik', body: 'Berehat dengan saluran televisyen satelit.' },
      { title: 'Resepsionis 24 jam', body: 'Bantuan tersedia bila-bila anda perlukan.' },
      { title: 'CCTV 24 jam', body: 'Pengawasan di lokasi sepanjang masa.' },
      { title: 'Bilik mesra keluarga', body: 'Pilihan fleksibel untuk melancong bersama.' },
    ],
  },
  stay: {
    eyebrow: 'RANCANG KUNJUNGAN ANDA',
    title: 'Betul-betul di Farley.<br>Sedia bila anda tiba.',
    body: `Daftar masuk dari ${SITE.checkIn.label} dan daftar keluar sebelum ${SITE.checkOut.label}. Tempah dalam talian atau hubungi Salim Inn terus jika anda perlukan bantuan memilih bilik.`,
    cta: 'Semak ketersediaan',
    labels: { address: 'Alamat', call: 'Telefon', email: 'E-mel' },
    address: 'Lot 21–22, Lorong Salim 17<br>96000 Sibu, Sarawak, Malaysia',
  },
  faq: {
    eyebrow: 'PERKARA UNTUK DIKETAHUI',
    title: 'Soalan yang<br>kerap ditanya.',
    blurb: 'Jawapan ringkas untuk ketibaan yang lebih lancar. Hubungi pasukan resepsionis 24 jam jika anda perlukan apa-apa lagi.',
    items: [
      {
        q: 'Bila waktu daftar masuk dan daftar keluar?',
        a: `Daftar masuk bermula pada ${SITE.checkIn.label} dan daftar keluar sebelum ${SITE.checkOut.label}. Daftar keluar lewat tertakluk pada ketersediaan bilik dan caj tambahan; kadar sehari penuh mungkin dikenakan selepas 3:00 petang.`,
      },
      {
        q: 'Bagaimana tempahan saya disahkan?',
        a: 'Tempahan disahkan selepas bayaran penuh diterima. Kaedah pembayaran yang diterima termasuk kad kredit, PayPal dan pindahan bank.',
      },
      {
        q: 'Apakah polisi pembatalan?',
        a: 'Bayaran balik mungkin tersedia apabila notis pembatalan diberikan sekurang-kurangnya tiga hari sebelum ketibaan. Dengan notis lebih pendek—atau ketidakhadiran—malam pertama mungkin dicaj.',
      },
      {
        q: 'Adakah setiap bilik mempunyai Wi-Fi dan penyaman udara?',
        a: 'Ya. Wi-Fi percuma tersedia di seluruh Salim Inn, dan bilik tetamu termasuk penyaman udara dan televisyen.',
      },
      {
        q: 'Di manakah Salim Inn terletak?',
        a: 'Salim Inn terletak di Lot 21–22, Lorong Salim 17, Farley Commercial Centre, Sibu. Pasar Raya Farley kira-kira lima minit berjalan kaki.',
      },
      {
        q: 'Bolehkah saya berhubung dengan seseorang pada bila-bila masa?',
        a: `Ya. Resepsionis beroperasi 24 jam. Hubungi <a href="tel:${SITE.phoneE164}">${SITE.phoneDisplay}</a> atau e-mel <a href="mailto:${SITE.email}">${SITE.email}</a>.`,
      },
    ],
  },
  cta: {
    title: 'Jadikan Sibu<br>lebih terasa seperti rumah.',
    book: 'Tempah penginapan anda',
    call: 'Hubungi Salim Inn',
  },
  footer: {
    osm: 'Data peta © penyumbang OpenStreetMap',
    rights: `© ${new Date().getFullYear()} Salim Inn, Sibu`,
  },
  mobileCta: {
    rate: SHOW_PRICES ? 'dari <strong>RM{{min}}</strong> / malam' : 'Tempah terus',
  },
};
