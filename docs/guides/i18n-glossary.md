# Terminology glossary

Canonical en → zh → ms renderings for hotel-domain terms. Every entry is
extracted from the committed bundles — this file documents what shipped, not
what should have. Sources of truth:

- `hotel-web-fe/src/i18n/resources/{en,zh,ms}/*.json` — 16 namespaces
- `hotel-app-be/src/core/locales/{en,zh,ms}.json` — email catalog

One canonical term per concept. Deviating needs a reason recorded here —
either an accepted variant in §7 or an open item in §8. `Where` cites the
bundle that committed the term.

## 1. Core entities

| en | zh | ms | Where / notes |
|---|---|---|---|
| booking, reservation | 预订 | tempahan | `nav`, `status`, `email`. en mixes both words; zh/ms canonicalise to one |
| booking number | 预订编号 | nombor tempahan | `guestPortal.booking` |
| guest | 客人 | tetamu | `nav`, `common.count`, `help` — staff register |
| guest type | 客人类型 | jenis tetamu | `guestPortal.book` |
| nickname | 昵称 | nama samaran | `guestPortal.book` — guest-facing alias |
| stay | 住宿 | penginapan | `guestPortal`, `email` |
| night / nights (label) | 晚 / 晚数 | malam | `common.count`, `email`, `guestPortal` — counter `30 晚` |
| adults / children | 成人 / 儿童 | dewasa / kanak-kanak | `guestPortal.book` |
| room | 客房 (staff) / 房间 (guest) | bilik | `nav`, `guestPortal`, `email` — register split, §7 |
| room type | 房型 | jenis bilik | `guestPortal`, `help` |
| hotel, property | 酒店 | hotel | `help`, `guestPortal` — "the property" → 酒店 |
| staff, employee | 员工 | kakitangan | `help`, `status.employee` |
| local / foreign tourist | 本地游客 / 外国游客 | pelancong tempatan / asing | `guestPortal.book` |
| administrator | 管理员 | pentadbir | `help`, `auth` |
| account / profile | 账户 / 个人资料 | akaun / profil | `auth`, `nav`, `errors` |
| session / language | 会话 / 语言 | sesi / bahasa | `errors`, `common.language` |

## 2. Booking lifecycle

| en | zh | ms | Where / notes |
|---|---|---|---|
| check-in (noun/label) | 入住 | daftar masuk | `guestPortal`, `status` — never 登记入住 |
| check in (verb) | 办理入住 | daftar masuk | `help`; online pre-check-in → 在线办理入住 (`email.cta`) |
| check-out | 退房 | daftar keluar | `guestPortal`, `status` |
| early check-in / late checkout | 提前入住 / 延迟退房 | check-in awal / daftar keluar lewat | `help`, `status.booking` |
| arrival / departure | 抵店 / 离店 | ketibaan / berlepas | `nav.mobile` (今日抵店 / 今日离店) |
| no-show / walk-in | 预订未到 / 上门客 | tidak hadir / walk-in | `status.booking`, `help`; ms keeps walk-in English |
| hold, held (room) | 保留, 已保留 | ditahan, dikekalkan | `status.booking`, `guestPortal.book.holdWindow` |
| confirmed | 已确认 | disahkan | `status` |
| checked in | 已入住 | daftar masuk | `status.booking` |
| auto checked in | 自动入住 | daftar masuk auto | `status.booking` |
| checked out | 已退房 | daftar keluar | `status.booking` |
| pending | 待处理 | menunggu | `status` — all domains; pending payment/confirmation → 待支付/待确认 |
| completed | 已完成 | selesai | `status` — all domains |
| cancelled / expired | 已取消 / 已过期 | dibatalkan / tamat tempoh | `status` — all domains |
| void (action) / voided (state) | 作废 / 已作废 | void / terbatal | `help`, `status` — §12 rule 5 |
| complimentary (status) | 免费 | percuma | `status.booking`: 免费作废 / 部分免费 / 全额免费 |
| complimentary / free nights (credits) | 免费房晚 | malam percuma | `nav`, `guestPortal` — seed said 免费房, committed is 免费房晚 |
| special requests | 特殊要求 | permintaan khas | `guestPortal.book` |
| reservation timeline | 预订时间轴 | garis masa tempahan | `nav.timeline` |
| booking terms / privacy notice | 《预订条款》/《隐私声明》 | Terma Tempahan / Notis Privasi | `guestPortal`, `auth` — 《》 marks document names |

## 3. Rooms & operations

| en | zh | ms | Where / notes |
|---|---|---|---|
| room status | 房态 | status bilik | `nav.mobile`, `help` |
| rooms board | 房态看板 | papan Rooms | `help.categories` |
| availability (guest-facing) | 可订 | ketersediaan | `guestPortal.book` — 可订状态/可订房间 |
| availability (staff, live) | 房态 | ketersediaan | `guestPortal.book.subtitle` renders "live availability" as 实时房态 |
| available | 可售 | tersedia | `status.room` |
| occupied | 占用中 | diduduki | `status.room` |
| reserved | 已预订 | ditempah | `status.room` |
| reserved (dirty) | 已预订待清洁 | ditempah (kotor) | `status.room` |
| cleaning / clean / dirty | 清洁中 / 已清洁 / 待清洁 | dibersihkan / bersih / kotor | `status.room` |
| inspected | 已检查 | diperiksa | `status.room`, `status.housekeeping` |
| maintenance / out of order / out of service | 维修中 / 维修停用 / 暂停服务 | penyelenggaraan / tidak berfungsi / tidak berkhidmat | `status.room` |
| housekeeping | 客房服务 | pengemasan | `nav`, `status`, `help` — see §8 collision note |
| daily room cleaning | 每日客房清洁 | pembersihan bilik harian | `guestPortal.book` — conflicts with above, §8 |
| maintenance (domain) | 维修 | penyelenggaraan | `status.maintenance`: open 待处理, on hold 已挂起, resolved 已解决, closed 已关闭 |
| online inventory / room configuration | 线上库存 / 客房配置 | inventori dalam talian / konfigurasi bilik | `nav`, `help` |
| front office / front desk | 前厅 / 前台 | pejabat hadapan / kaunter hadapan | `nav.groups`, `help` |

## 4. Finance

| en | zh | ms | Where / notes |
|---|---|---|---|
| payment (UI) | 支付 | pembayaran | `guestPortal`, `nav` — email register uses 付款, §8 |
| payment claim | 付款申报 | tuntutan pembayaran | `guestPortal.recoverPayment` |
| payment approvals | 支付审批 | kelulusan pembayaran | `nav` |
| payment method | 支付方式 | kaedah pembayaran | `guestPortal`; `email.labels.method` → 方式 |
| collect payment | 收取款项 | kutip bayaran | `nav.mobile` |
| deposit | 押金 | deposit | `status.payment`, `help` — unpaid 未付押金, forfeited 押金已没收 |
| refund | 退款 | bayaran balik | `status`, `help` — "refund a deposit" → 退还押金 |
| refunded | 已退款 | dibayar balik | `status` |
| ledger / company ledger | 台账 / 公司台账 | lejar / lejar syarikat | `nav`, `help`, `status.ledger` |
| balance / payments received | 余额 / 已收款项 | baki / pembayaran diterima | `email.labels` — no web key yet |
| remaining balance | 剩余余额 | baki tertunggak | `email.paymentConfirmed` — vs seed 未结余额, §8 |
| amount / amount due | 金额 / 应付金额 | amaun / jumlah perlu dibayar | `common.field`, `guestPortal` |
| total | 总计 | jumlah | web UI — `email.labels.total` uses 总额, §8 |
| subtotal / discount / tax | 小计 / 折扣 / 税费 | jumlah kecil / diskaun / cukai | `guestPortal.book` |
| first-night charge | 首晚房费 | caj malam pertama | `guestPortal.book` |
| receipt (transfer proof) | 凭证 | resit | `guestPortal.recoverPayment` |
| bank transfer / card | 银行转账 / 银行卡 | pemindahan bank / kad | `guestPortal` |
| paid / unpaid / partial | 已支付 / 未支付 / 部分支付 | dibayar / belum dibayar / separa | `status` — payment, invoice, ledger |
| overdue | 已逾期 | tertunggak | `status.invoice`, `status.ledger` |
| invoice statuses | 草稿/已开具/已发送 | draf/dikeluarkan/dihantar | `status.invoice` — the noun 发票 has no committed key yet |
| draft / forfeited | 草稿 / 已没收 | draf / dilucutkan | `status` — draft spans all domains |

## 5. Revenue & marketing

| en | zh | ms | Where / notes |
|---|---|---|---|
| revenue / revenue & marketing | 收益 / 收益与营销 | hasil / hasil & pemasaran | `nav.groups`, `revenue.title` — seed said 收入, committed is 收益 |
| rates | 房价 | kadar | `nav`, `help` |
| promotion(s) | 促销 | promosi | `help` (房价与促销), `status.promotion` |
| campaign | 营销活动 | kempen | `nav`, `status.campaign` |
| offer(s) | 优惠 / 优惠活动 | tawaran | `guestPortal.nav` (优惠), `help` (优惠活动) — §8 overlap risk |
| voucher | 优惠券 | baucar | `guestPortal`, `status.voucher` |
| loyalty (programme) / points | 会员忠诚度 (计划) / 积分 | kesetiaan / mata | `nav`, `help`, `guestPortal` |
| segment | 客群细分 / 客人细分 | segmen | `nav.segments` — internally inconsistent, §8 |
| redeemed / fulfilled | 已使用 / 已兑现 | ditebus / ditunaikan | `status.voucher`, `status.loyalty_redemption` |
| insights | 经营分析 | wawasan | `nav.groups`; "metrics" → 经营指标 in `help` |
| guest relations | 宾客关系 | hubungan tetamu | `nav` — 宾客 register, §7 |
| communications | 通信管理 | komunikasi | `nav`; `help` uses 通信与通知 |
| email delivery: queued / suppressed | 排队中 / 已抑制 | dalam giliran / disekat | `status.email_delivery` |

## 6. Admin & system

| en | zh | ms | Where / notes |
|---|---|---|---|
| administration | 系统管理 | pentadbiran | `nav.groups`, `admin.title` |
| settings / hotel settings | 设置 / 酒店设置 | tetapan / tetapan hotel | `nav`; "configuration" → 配置, distinct |
| access control (RBAC) | 访问控制 | kawalan akses | `nav` |
| role / permission | 角色 / 权限 | peranan / kebenaran | `help`; "requires" → 所需权限 |
| audit log | 审计日志 | log audit | `nav`, `help` |
| night audit | 夜审 | audit malam | `nav`, `help`, `status.night_audit` — ms `help` keeps English, §8 |
| reports | 报表 | laporan | `nav`, `help` |
| notifications | 通知 | pemberitahuan | `nav`, `notifications` |
| support | 客服 / 客人支持 / 客服支持 | sokongan | `nav`, `guestPortal`, `help` — three renderings, §8 |
| help centre | 帮助中心 | pusat bantuan | `help` |
| data transfer | 数据迁移 | pemindahan data | `nav`, `help` |
| guest portal | 宾客门户 | portal tetamu | `guestPortal`, `email` |
| identity (eKYC tab) | 身份认证 | identiti | `guestPortal.nav` |
| escalation | 上报 | eskalasi | `help` — status.ekyc.escalated uses 已升级, §7 |
| two-factor authentication | 双重身份验证 | pengesahan dua faktor | `auth`, `errors` |
| passkey / recovery code | 通行密钥 / 恢复码 | kunci laluan / kod pemulihan | `auth` |
| authenticator app / verification code | 验证器应用 / 验证码 | aplikasi pengesah / kod | `auth` — `6 位验证码` |
| sign in / log in | 登录 | log masuk | `auth`, `guestPortal` — both en verbs map to 登录 |
| sign out / log out | 退出登录 | log keluar | `nav`, `guestPortal` |
| sign up / register | 注册 | daftar | `auth` |
| email | 电子邮箱 | e-mel | `common.field`, `auth`, `email` |
| dashboard / overview | 概览 | papan pemuka / utama | `nav`, `dashboard.title` — en ambiguous, §8 |
| verified / verify | 已验证 / 验证 | disahkan / sahkan | `status.ekyc`, `email.cta` |
| app title (fallback document.title) | 酒店管理系统 | Sistem ERP Hotel | `common.app.title` — used only when `hotel_name` is blank |
| notification priority: info / warning / critical | 提示 / 警告 / 严重 | Maklumat / Amaran / Kritikal | `notifications.priority` — chip/tooltip register, not `status.*` |
| email delivery tier: transactional / marketing | 事务 / 营销 | Transaksi / Pemasaran | `notifications.tier` — tab labels |
| error page: access denied / page not found / resource locked | 无权访问 / 页面未找到 / 资源已锁定 | Akses ditolak / Halaman tidak ditemui / Sumber dikunci | `errors.page` — StatusPage 403/404/423 |
| error boundary scope titles | 访客页面出错 / 认证错误 / 页面错误 / 组件错误 | Ralat Halaman Tetamu / Pengesahan / Halaman / Komponen | `errors.boundary` — guest/auth/page/component |
| staff (role fallback label) | 员工 | Kakitangan | `nav.userMenu.defaultRole` — renders only when no role/username |

## 7. Accepted register variants

Two renderings of one concept, kept deliberately — the register decides:

| Concept | Staff / internal | Guest-facing | Reason |
|---|---|---|---|
| room | 客房 (`nav`, `rooms`, `common.count`) | 房间 (`guestPortal`, `email`) | OTA convention for guests; 客房 is ops register |
| guest | 客人 (staff UI) | 宾客 in fixed compounds: 宾客关系, 宾客门户 | industry compound terms, not free variation |
| availability | 房态 / 可售 (staff) | 可订 (guest booking flow) | 可售/房态 are ops jargon |
| escalate | 已升级 (`status.ekyc`) | 上报 (`help` prose, 上报指南) | state enum vs process verb |
| check in | 入住 (label/state) | 办理入住 (verb, incl. 在线办理入住) | label vs action |

## 8. Inconsistencies to resolve

Committed renderings that disagree. Do not pick silently — a wave that touches
the surface settles it and records the outcome here.

| Concept | Rendering A | Rendering B | Where | Disposition |
|---|---|---|---|---|
| segment | 客群细分 | 客人细分 | `zh/nav.json` label vs breadcrumb | open — unify (Task 1 deferred minor) |
| support | 客服 / 客人支持 | 客服支持 | `nav` label+breadcrumb vs `guestPortal` | open — rule needed per surface |
| payment | 支付 (web UI, 25×) | 付款 (`email` labels, 付款申报, payment prose) | `guestPortal`, BE `zh.json` | open — register split or drift? |
| housekeeping | 客房服务 | 每日客房清洁 (daily cleaning) | `nav`/`status` vs `guestPortal.book` | open — 客房服务 also collides with F&B "room service"; ledger assigned alignment to this file |
| outstanding balance | 剩余余额 (committed, `email`) | 未结余额 (Task 1 seed) | BE `zh.json` vs plan seed | open — seed never committed; decide before finance wave |
| void (state) | 作废 | 已作废 | `status.payment.void` vs every other `.void` | likely deliberate (action/state split) — verify context |
| open vs pending | 待处理 | 待处理 | `status.maintenance.open`, all `.pending` | two en states collapse; acceptable, watch |
| in progress | 进行中 | 进行中 | `in_progress`, `campaign.running`, `promotion.live` | three en states collapse; acceptable, watch |
| active | 启用 | 在职 / 有效 / 已上线 | `generic` / `employee` / `loyalty` / `campaign` | contextual variants — keep, document per domain |
| offer vs promotion | 优惠 (guest tab) | 促销 (staff objects) | `guestPortal.nav` vs `help` | collision risk — rule: 优惠 guest-facing, 促销 staff |
| redeemed vs used | 已使用 | 已使用 | `voucher.redeemed`, `reward_redemption.used` | ms distinguishes (ditebus/digunakan); zh collapses — watch |
| night audit (ms) | Audit Malam | night audit (English) | `ms/nav` vs `ms/help` | open — ms internal split; help jargon borrow is common in ms, confirm |
| dashboard vs overview | 概览 | 概览 | `dashboard.title`, `nav.dashboard` | en itself ambiguous; zh collapsed, ms kept distinct — watch |
| "last reviewed" | 审核 | (suggested 复核) | `zh/help.json` | open — collides with eKYC 审核 register (Task 1 deferred minor) |
| reservation (label) | 预订编号 | 预订 | `guestPortal.recoverPayment.reference` | en "Reservation" gained 编号 — collapses with booking number; verify |
| total | 总计 (web UI) | 总额 | `common`, `guestPortal` vs `email.labels` | open — unify, or rule 总额 for email register |
| auto checked in (ms) | Daftar masuk auto | — | `ms/status.booking` | flagged colloquial in Task 6 review — later wave polish |

## 9. Do not translate

Copy verbatim into every locale (zh included):

- Acronyms: **eKYC, RBAC, API, KPI, 2FA, PDF, QR, OTA, PMS, ADR, RevPAR, MICE**
- Channel names: **Booking.com, Agoda, Expedia**, and any other OTA brand
- Product/vendor names already committed: **PayPal, Google** (Turnstile is
  rendered generically as 验证 in `auth.turnstile`)
- File formats: JPEG, PNG, WebP, PDF
- Enum values, JSON keys, URLs, `{{var}}` placeholder names — never localised;
  `resources.test.ts` fails on a translated placeholder
- Status values internally: `checked_in`, `no_show` etc. stay English in data
  and API; only the `status` bundle labels render localised

## 10. Tone rules (zh)

- Professional hotel-industry Mandarin. Standard ops terms: 入住 (never
  登记入住), 退房, 房态, 夜审, 前厅.
- `您` for the reader — committed in guest portal, errors, and staff help
  alike. `你` never appears (0 occurrences; keep it that way).
- Nav labels compact — ≤4 characters where natural: 客房, 房态, 夜审, 报表,
  通知, 房价, 台账. Longer only when clarity demands (会员忠诚度, eKYC 管理).
- Full-width punctuation where idiomatic: 。，；：、“”、《》 (document names take
  《》). Half-width `…` for in-progress states.
- Arabic numerals with a space at CJK–Latin boundaries: `30 晚`, `6 位验证码`,
  `10MB`, `eKYC 管理`. Same spacing around `{{var}}` when a Latin value lands
  inside CJK text.
- Sentence-final 。 on toast/prose strings; bare labels take no punctuation.
- Email register is more formal: salutation 尊敬的{{name}}，; web UI stays 您.

## 11. Plurals, interpolation, formatting

- Chinese has no plural inflection — `Intl.PluralRules('zh-CN')` yields only
  `other`. zh keys carry `_other` (plus `_zero` where en defines one, rendered
  numerically: `0 晚`, `0 位客人`). Never author `_one`.
- Measure words are the committed counter set: 晚 (nights), 位客人 (guests),
  间客房/间房 (rooms), 项 (items), 篇 (articles), 个 (misc).
- `{{var}}` placeholders verbatim — ASCII names, never translated or reordered
  away from what the en key defines (the parity test enforces this).
- Numbers passed as variables are formatted for the locale by the engine.
  Dates go through `utils/date.ts` (hotel timezone, zh-CN via `Intl`), never
  `toLocaleDateString` inline.
- Email dates use the catalog pattern `{{year}}年{{month}}{{day_num}}日`;
  `day_num` is the single sanctioned placeholder absent from the en source.
- Currency stays in the configured hotel currency regardless of interface
  language (`utils/currency.ts` is deliberately not locale-aware).
- Malay also inflects nothing (`_other` only) but keeps English hotel jargon
  in `help` prose — acceptable for ms, not licensed for zh.

## 12. Rules for translators

1. Translate values, never keys, enums, URLs, file formats, or §9 terms.
2. One canonical term per concept — check §1–6 before inventing; a deviation
   needs a reason appended to §7 or §8.
3. Keep `{{var}}` count and names identical to the en key for that row.
4. Guest-facing copy uses the guest register (§7): 房间, 宾客门户, 可订.
5. Status labels: state takes 已X (已确认, 已作废); action takes the bare
   verb (作废, 取消). Don't collapse the two.
6. Zero counts render numerically (`0 晚`), matching the committed set.
7. ms is the reference for tone level, not for vocabulary — never borrow an
   ms string's English jargon into zh.

## 13. Living document

Seeded from the Task 1 anchor table, expanded to everything committed through
Task 8 (namespace expansion, error mapper, status helper, CJK pass). Each
subsequent migration wave appends the terms it settles — new canonical rows
in §1–6, resolved items struck from §8 with the wave noted. When this table
and a bundle disagree, the bundle wins in code and this file gets amended in
the same commit.
