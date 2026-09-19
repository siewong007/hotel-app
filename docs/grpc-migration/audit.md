# REST → gRPC Migration — Phase 0 Audit

> **Point-in-time record.** This audit ran on 2026-09-17 against HEAD
> `c2b2ba1cd`. Phases 1–3 have since landed — tonic services for rooms,
> room types, housekeeping, maintenance, and guests are merged into the Axum
> router (`src/grpc/`), generated Connect-ES clients run behind per-context
> runtime flags (`hotel-web-fe/src/api/grpc/flags.ts`, REST default/fallback),
> and the Vite proxy forwards `/hotel.` (the production Caddyfile does not
> yet — see `../guides/deployment.md`). The findings below remain useful as
> the inventory of what is *not* yet migrated; read route counts as of that
> date, not as current.

Read-only inventory of the current REST surface. No code was changed. Generated
by static analysis of `hotel-app-be/src/**` and `hotel-web-fe/src/**` on
2026-09-17 (tree at `master`, HEAD `c2b2ba1cd`). Guard annotations were
extracted from the `routes.rs` wrappers and one level of callee scanning;
where a wrapper delegates `headers` into the handler/service layer the guard
is marked `JWT (handler)` — treat those as "permission check confirmed to exist
downstream, exact string to be lifted during contract design".

**Bottom line.** 441 method·path registrations (~350 unique paths) across 38
domain modules plus root infra routes. The surface is far bigger than a
six-package proto contract implies — several modules will map into shared
packages or be excluded from Phase 1 scope. ~98 endpoints return untyped
`serde_json::Value` and need response-shape archaeology before their messages
can be written.

## 1. Stack findings

### 1.1 Backend (`hotel-app-be`)

| Item | Finding |
|---|---|
| HTTP framework | **axum 0.8** (`macros`, `multipart`, `ws`) + axum-extra cookies; tower-http CORS/trace/set-header/catch-panic/fs |
| Process model | Single process, `axum::serve`. Server mode binds `0.0.0.0:$BACKEND_PORT` (3030); desktop mode (`HOTEL_DESKTOP_MODE`) binds `127.0.0.1` on a probed free port — gRPC must coexist in the same process and survive port probing |
| Router | `routes/mod.rs::create_router(pool)` merges 38 module routers under `/api`; root keeps `/health`, `/ws/status`, `/uploads` (`ServeDir` over `uploads/public`) |
| Error type | `core::error::ApiError` — 15 variants incl. structured payloads (`ProfileIncomplete(Vec<String>)`, `AutoCheckinBlocked{block_code,message}`, `GuestNameTaken`, `TwoFactorEnrollmentRequired`). `IntoResponse` → `{"error","message",...,"request_id"}`; `normalize_error_response` middleware normalizes extractor rejections/404s; `CatchPanicLayer` → JSON 500 |
| AuthN | Bearer JWT (`AuthService::verify_jwt`; `claims.sub` = user id, `claims.sid` = session id) for staff; **separate guest-portal session bearer** (sessionStorage-backed, own refresh lifecycle); booking capability tokens (in-path `{token}` or header variants); HttpOnly refresh cookie on `/auth/refresh` |
| Session check | `enforce_active_session` middleware on **all** `/api` routes: when a Bearer token is present it must verify AND its `sid` must still be active in `user_sessions`; guest-portal paths are exempted on token-parse failure. A gRPC auth interceptor must replicate this — JWT verify alone is a security regression |
| AuthZ | `require_permission_helper(pool, headers, "resource:action")` / `require_any_permission_helper` with const arrays; `<resource>:manage` implies all actions of that resource; `ensure_super_admin` for the ceiling. Checks live in routes.rs wrappers OR deeper (handlers/service) depending on module |
| Rate limiting | In-memory `RateLimiters` extension; per-route limiter buckets (`login`, `sensitive`, etc.) keyed by client IP (`extract_client_ip`, trusted-proxy aware) |
| DB | `sqlx 0.9` `PgPool` (`DbPool`), plain `sqlx::query()` — **no compile-time SQL checking**; `hotel_today()` business date; `decimal_to_db` for money |
| Realtime | 4 `broadcast` hubs: `DataChangeHub` (`/api/updates/socket`), `AvailabilityHub` (`/api/guest-portal/me/availability`), `SupportHub`, `LoyaltyHub` (admin + guest sockets). `publish_data_changes` middleware on **all** `/api` mutations; `publish_inventory_changes` route_layer on rooms (and reused by housekeeping) — gRPC mutation paths must still fire these or realtime silently dies |
| Background jobs | night audit, payment receipts, unpaid-hold release, comms worker+scheduler spawned in `main.rs` — unaffected by transport migration |
| Money | `rust_decimal::Decimal` ↔ Postgres `numeric(…,2)` (mostly `numeric(12,2)`, some `numeric(10,4)` 4-dp values — see §3.9). Bare `rust_decimal` serde → JSON **number** (float); the wire already loses decimal fidelity today |
| Dates | `chrono::NaiveDate` for stay dates (`"YYYY-MM-DD"`), `DateTime<Utc>` for instants — maps cleanly to `google.type.Date` / `Timestamp` |
| Pagination | Offset: `page` + `per_page` in, `PaginatedResponse{data,total,page,page_size}` out — `page_token` will need to wrap the page number (opaque) |

### 1.2 Frontend (`hotel-web-fe`)

| Item | Finding |
|---|---|
| HTTP client | **ky 2** single instance `api` in `src/api/client.ts`; `fetch` never used for API calls (except a couple of raw downloads). Base URL resolved per request via `resolveApiRequestUrl` (Tauri dynamic port in desktop mode) |
| Auth flow | In-memory access token → `Authorization: Bearer`; HttpOnly refresh cookie (`credentials:'include'`); **single-flight refresh + one retry on 401**, staff endpoints only — auth endpoints and `/guest-portal/*` are excluded (portal carries its own bearer via `authHeaders(token)`); failure → `clearStoredAuth` + `auth:unauthorized` event |
| Data layer | TanStack Query (`src/api/queryClient.ts`, `queryKeys.ts`); service classes in `src/api/*.service.ts` (~24) + feature-local `*/api.ts`. Mutations auto-invalidate their domain via `domainForApiPath` in the `afterResponse` hook — connect-query will need an equivalent mapping (path→domain) or per-RPC invalidation |
| TS types | **Hand-written** (`src/types/*`, feature `types.ts`); `.json<T>()` casts at call sites. No codegen anywhere — generated proto types will replace a large handwritten surface |
| Custom headers | `Accept-Language` (locale for server-rendered emails/receipts), `X-Client-Timezone`, `X-Skip-Api-Notification` (opt out of global toast), Cloudflare Turnstile header on login/register, step-up + backup-passphrase headers on data-transfer |
| WebSockets | 5 clients, all `new WebSocket(url, ['<subprotocol>', token])` token-in-subprotocol auth: `useDataChangeSocket` → `/api/updates/socket`; `useLoyaltySocket` → `/api/admin/loyalty/socket`; `useGuestLoyaltySocket` → `/api/guest-portal/me/loyalty/socket`; `useSupportSocket` → `/api/guest-portal/me/support/socket`; `useAvailabilitySocket` → `/api/guest-portal/me/availability` |
| Error UX | `beforeError` hook → `APIError` + global toast via `emitApiNotification`; 423 → `api:resource-locked` event; `toApiError` helper per service |

### 1.3 Also in the blast radius

`hotel-desktop` embeds this backend as a sidecar with bundled Postgres and
learns the probed port over Tauri IPC. Its webview calls the same REST API but
cannot use the refresh cookie (cross-origin, `SameSite`) — it already cannot
restore sessions. Any transport change must keep working for (a) web SPA on
Vite proxy, (b) Tauri webview on a dynamic port. gRPC-Web over the same
resolved base URL satisfies both.

## 2. Endpoint inventory

Convention notes for the table below:

- **Auth**: `` `resource:action` `` = RBAC permission string; `any of …` =
  `require_any_permission_helper` alternatives; `JWT` = authenticated but no
  permission check found; `portal-session` = guest-portal bearer; `public` =
  no auth detected (rate-limited where `IP-rl` appears); `super-admin` =
  `ensure_super_admin`; `JWT (handler)` = auth enforced inside handler/service
  (headers forwarded), permission string to be confirmed in Phase 1.
- **Request → Response** is extracted from the wrapper signature
  (`Json<T>`/`Query<T>`/`Multipart`/return type). `any` = `serde_json::Value`.
- **Flags**: `WS` = WebSocket upgrade · `UPLOAD` = multipart · `FILE/RAW` =
  non-JSON response (file/stream/HTML) · `untyped` = `serde_json::Value`
  response · `NO-FE` = no literal caller found in `hotel-web-fe/src`
  (external callers, email links, genuinely dead surface — see §3.12).

### Root infra routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | public | Docker/desktop healthcheck; DB probe |
| GET | `/ws/status` | public | JSON status stub, not a real socket |
| GET | `/uploads/*` | public | `ServeDir` static assets (`uploads/public` only) |


### `analytics` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/analytics/occupancy` | `analytics:read` | — → any | `api/analytics.service.ts` | untyped |
| GET | `/api/analytics/bookings` | `analytics:read` | — → any | `api/analytics.service.ts` | untyped |
| GET | `/api/analytics/benchmark` | `analytics:read` | — → any | `api/analytics.service.ts` | untyped |
| GET | `/api/analytics/personalized` | `analytics:read` + JWT | — → any | `api/analytics.service.ts` | untyped |
| GET | `/api/reports/generate` | any of `analytics:read`, `reports:execute` | — → any | `api/reports.service.ts` | untyped |

### `audit` (8)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/audit-logs` | `audit:read` | — → AuditLogResponse | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/actions` | `audit:read` | — → Vec<String> | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/resource-types` | `audit:read` | — → Vec<String> | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/users` | `audit:read` | — → Vec<any> | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/category-counts` | `audit:read` | — → AuditCategoryCounts | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/export/csv` | `audit:export` | — → raw-response | `api/audit.service.ts` | FILE/RAW |
| GET | `/api/audit-logs/export/json` | `audit:export` | — → AuditLogExportJson | `api/audit.service.ts` |  |
| GET | `/api/audit-logs/db-statements` | `audit:read` | — → any | — | NO-FE, untyped |

### `auth` (10)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | IP-rl | LoginRequest → raw-response | `api/client.ts`<br>`auth/AuthContext.tsx` | FILE/RAW |
| POST | `/api/auth/login/lookup` | IP-rl | LoginLookupRequest → LoginLookupResponse | `api/auth.service.ts` |  |
| POST | `/api/auth/google` | IP-rl | GoogleLoginRequest → raw-response | `api/auth.service.ts` | FILE/RAW |
| GET | `/api/auth/access` | JWT | — → AccessSnapshot | `api/auth.service.ts` |  |
| POST | `/api/auth/refresh` | IP-rl | — → raw-response | `api/client.ts`<br>`auth/tokenStore.ts` | FILE/RAW |
| POST | `/api/auth/logout` | public | — → — | `api/client.ts`<br>`auth/AuthContext.tsx` |  |
| POST | `/api/auth/register` | IP-rl | RegisterRequest → any | `api/auth.service.ts`<br>`api/client.ts` | untyped |
| POST | `/api/auth/verify-email` | IP-rl | EmailVerificationConfirm → any | `api/auth.service.ts` | untyped |
| POST | `/api/auth/resend-verification` | IP-rl | ResendVerificationRequest → any | — | NO-FE, untyped |
| POST | `/api/auth/accept-invite` | IP-rl | AcceptInviteInput → any | — | NO-FE, untyped |

### `booking_channels` (19)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/booking-channels` | JWT | — → Vec<BookingChannel> | `api/reports.service.ts`<br>`features/channels/api.ts` |  |
| POST | `/api/booking-channels` | `channels:write` | BookingChannelInput → BookingChannel | `api/reports.service.ts`<br>`features/channels/api.ts` |  |
| PUT | `/api/booking-channels/{id}` | `channels:write` | BookingChannelUpdate → BookingChannel | `api/reports.service.ts`<br>`features/channels/api.ts` |  |
| DELETE | `/api/booking-channels/{id}` | `channels:manage` | — → BookingChannel | `api/reports.service.ts`<br>`features/channels/api.ts` |  |
| GET | `/api/booking-channels/{id}/pricing-rules` | `channels:read` | — → Vec<ChannelPricingRule> | `features/channels/api.ts` |  |
| POST | `/api/booking-channels/{id}/pricing-rules` | `channels:write` | ChannelPricingRuleInput → PricingRuleResponse | `features/channels/api.ts` |  |
| GET | `/api/booking-channels/{id}/commission-rules` | `channels:read` | — → Vec<ChannelCommissionRule> | `features/channels/api.ts` |  |
| POST | `/api/booking-channels/{id}/commission-rules` | `channels:write` | ChannelCommissionRuleInput → ChannelCommissionRule | `features/channels/api.ts` |  |
| GET | `/api/booking-channels/{id}/mappings` | `channels:read` | — → ChannelMappings | `features/channels/api.ts` |  |
| PUT | `/api/booking-channels/{id}/mappings/room-types` | `channels:write` | ChannelRoomTypeMappingInput → ChannelRoomTypeMapping | `features/channels/api.ts` |  |
| PUT | `/api/booking-channels/{id}/mappings/rate-plans` | `channels:write` | ChannelRatePlanMappingInput → ChannelRatePlanMapping | `features/channels/api.ts` |  |
| PATCH | `/api/channel-pricing-rules/{id}` | `channels:write` | ChannelPricingRuleUpdate → PricingRuleResponse | `features/channels/api.ts` |  |
| DELETE | `/api/channel-pricing-rules/{id}` | `channels:manage` | — → any | `features/channels/api.ts` | untyped |
| PATCH | `/api/channel-commission-rules/{id}` | `channels:write` | ChannelCommissionRuleUpdate → ChannelCommissionRule | `features/channels/api.ts` |  |
| DELETE | `/api/channel-commission-rules/{id}` | `channels:manage` | — → any | `features/channels/api.ts` | untyped |
| DELETE | `/api/channel-room-type-mappings/{id}` | `channels:write` | — → any | `features/channels/api.ts` | untyped |
| DELETE | `/api/channel-rate-plan-mappings/{id}` | `channels:write` | — → any | `features/channels/api.ts` | untyped |
| POST | `/api/channel-pricing/preview` | `channels:read` | ChannelPricePreviewRequest → ChannelPricePreview | `features/channels/api.ts` |  |
| GET | `/api/channel-pricing/matrix` | `channels:read` | — → ChannelMatrix | `features/channels/api.ts` |  |

### `bookings` (30)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/bookings` | `bookings:read` | — → PaginatedResponse<Vec<BookingWithDetails>> | `api/bookings.service.ts`<br>`api/queryKeys.ts` |  |
| POST | `/api/bookings` | `bookings:create` | BookingInput → Booking | `api/bookings.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/bookings/checkin-advisory` | `bookings:read` | — → bookings::CheckInAdvisory | `api/bookings.service.ts` |  |
| GET | `/api/bookings/stats` | `bookings:read` | — → BookingStats | `api/bookings.service.ts` |  |
| GET | `/api/bookings/summary` | `bookings:read` | — → BookingBoardSummary | `api/bookings.service.ts` |  |
| GET | `/api/bookings/complimentary` | `bookings:read` | — → Vec<BookingWithDetails> | `api/bookings.service.ts` |  |
| POST | `/api/bookings/book-with-credits` | JWT (handler) | BookWithCreditsRequest → any | `api/bookings.service.ts` | untyped |
| POST | `/api/bookings/void` | `bookings:update` | BookingCancellationRequest → any | `api/bookings.service.ts` | untyped |
| GET | `/api/complimentary/summary` | `bookings:read` | — → any | `api/bookings.service.ts` | untyped |
| GET | `/api/guests/credits` | `guests:read` | — → any | `api/bookings.service.ts` | untyped |
| POST | `/api/guests/credits` | `guests:manage` | AddGuestCreditsRequest → any | `api/bookings.service.ts` | untyped |
| PATCH | `/api/guests/{guest_id}/credits/{room_type_id}` | `guests:manage` | UpdateGuestCreditsRequest → any | `api/bookings.service.ts` | untyped |
| DELETE | `/api/guests/{guest_id}/credits/{room_type_id}` | `guests:manage` | — → any | `api/bookings.service.ts` | untyped |
| GET | `/api/rate-codes` | public | — → settings::RateCodesResponse | `api/queryKeys.ts`<br>`api/rates.service.ts` |  |
| GET | `/api/market-codes` | public | — → settings::MarketCodesResponse | `api/queryKeys.ts`<br>`api/rates.service.ts` |  |
| POST | `/api/bookings/{id}/reactivate` | `bookings:update` | — → Booking | `api/bookings.service.ts` |  |
| POST | `/api/bookings/{id}/checkin` | `bookings:update` | Option<CheckInRequest → Booking | `api/bookings.service.ts` |  |
| POST | `/api/bookings/{id}/release` | `bookings:update` | ReleaseBookingRequest → any | `api/bookings.service.ts` | untyped |
| GET | `/api/bookings/{id}/auto-checkin-eligibility` | `bookings:read` | — → GuestEkycStatusSummary | — | NO-FE |
| POST | `/api/bookings/{id}/auto-checkin` | `bookings:update` | — → AutoCheckinResponse | — | NO-FE |
| GET | `/api/bookings/{id}/checkin-advisory` | `bookings:read` | — → bookings::CheckInAdvisory | `api/bookings.service.ts` |  |
| GET | `/api/bookings/{id}/timeline` | `bookings:read` | — → Vec<BookingTimelineEntry> | `api/bookings.service.ts` |  |
| POST | `/api/bookings/{id}/complimentary` | `bookings:update` | MarkComplimentaryRequest → any | `api/bookings.service.ts` | untyped |
| PATCH | `/api/bookings/{id}/complimentary` | `bookings:update` | UpdateComplimentaryRequest → any | `api/bookings.service.ts` | untyped |
| DELETE | `/api/bookings/{id}/complimentary` | `bookings:update` | — → any | `api/bookings.service.ts` | untyped |
| POST | `/api/bookings/{id}/convert-credits` | `bookings:update` | — → any | `api/bookings.service.ts` | untyped |
| GET | `/api/bookings/{id}` | `bookings:read` | — → BookingWithDetails | `api/bookings.service.ts`<br>`features/admin/components/AuditLogPage.tsx` |  |
| PATCH | `/api/bookings/{id}` | `bookings:update` | BookingUpdateInput → Booking | `api/bookings.service.ts`<br>`features/admin/components/AuditLogPage.tsx` |  |
| PUT | `/api/bookings/{id}` | `bookings:update` | BookingUpdateInput → Booking | `api/bookings.service.ts`<br>`features/admin/components/AuditLogPage.tsx` |  |
| DELETE | `/api/bookings/{id}` | `bookings:delete` | — → any | `api/bookings.service.ts`<br>`features/admin/components/AuditLogPage.tsx` | untyped |

### `communications` (24)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/admin/communications/campaigns` | `communications:read` | — → CampaignListResponse | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/campaigns` | `communications:compose` | CampaignInput → EmailCampaign | `features/communications/api/communicationsApi.ts` |  |
| GET | `/api/admin/communications/campaigns/{id}` | `communications:read` | — → EmailCampaign | `features/communications/api/communicationsApi.ts` |  |
| PUT | `/api/admin/communications/campaigns/{id}` | `communications:compose` | CampaignInput → EmailCampaign | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/campaigns/{id}/preview` | `communications:read` | — → PreviewResponse | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/campaigns/{id}/test-send` | `communications:send` | TestSendInput → any | `features/communications/api/communicationsApi.ts` | untyped |
| POST | `/api/admin/communications/campaigns/{id}/schedule` | `communications:send` | ScheduleCampaignInput → EmailCampaign | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/campaigns/{id}/cancel` | `communications:send` | — → EmailCampaign | `features/communications/api/communicationsApi.ts` |  |
| GET | `/api/admin/communications/campaigns/{id}/deliveries` | `communications:read` | — → DeliveryListResponse | `features/communications/api/communicationsApi.ts` |  |
| GET | `/api/admin/communications/deliveries` | `communications:read` | — → DeliveryFeedResponse | `features/notifications/api.ts` |  |
| GET | `/api/admin/communications/templates` | `communications:read` | — → Vec<EmailTemplate> | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/templates` | `communications:compose` | TemplateInput → EmailTemplate | `features/communications/api/communicationsApi.ts` |  |
| PUT | `/api/admin/communications/templates/{id}` | `communications:compose` | TemplateInput → EmailTemplate | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/templates/{id}/deactivate` | `communications:manage` | — → any | `features/communications/api/communicationsApi.ts` | untyped |
| GET | `/api/admin/communications/audience` | `communications:read` | — → AudienceCount | `features/communications/api/communicationsApi.ts` |  |
| GET | `/api/admin/communications/suppressions` | `communications:manage` | — → SuppressionListResponse | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/suppressions` | `communications:manage` | SuppressionInput → any | `features/communications/api/communicationsApi.ts` | untyped |
| DELETE | `/api/admin/communications/suppressions/{email}` | `communications:manage` | — → any | `features/communications/api/communicationsApi.ts` | untyped |
| GET | `/api/admin/communications/guests/{guest_id}/consent` | `communications:read` | — → ConsentStatusResponse | `features/communications/api/communicationsApi.ts` |  |
| POST | `/api/admin/communications/guests/{guest_id}/consent` | `communications:manage` | PreferenceUpdateInput → ConsentStatusResponse | `features/communications/api/communicationsApi.ts` |  |
| GET | `/api/guest-portal/me/notification-preferences` | portal-session | — → PreferencesResponse | `features/communications/api/portalCommunicationsApi.ts` |  |
| PUT | `/api/guest-portal/me/notification-preferences` | portal-session | PreferenceUpdateInput → PreferencesResponse | `features/communications/api/portalCommunicationsApi.ts` |  |
| GET | `/api/communications/unsubscribe/{token}` | IP-rl | — → PreferencesResponse | `features/communications/api/publicCommunicationsApi.ts` |  |
| POST | `/api/communications/unsubscribe/{token}` | IP-rl | UnsubscribeApplyInput → PreferencesResponse | `features/communications/api/publicCommunicationsApi.ts` |  |

### `companies` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/companies` | `companies:read` | — → Vec<Company> | `api/companies.service.ts`<br>`api/queryKeys.ts` |  |
| POST | `/api/companies` | `companies:create` | CompanyCreateRequest → Company | `api/companies.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/companies/{id}` | `companies:read` | — → Company | `api/companies.service.ts` |  |
| PUT | `/api/companies/{id}` | `companies:update` | CompanyUpdateRequest → Company | `api/companies.service.ts` |  |
| DELETE | `/api/companies/{id}` | `companies:delete` | — → any | `api/companies.service.ts` | untyped |

### `data_transfer` (9)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/data-transfer/export/preview` | super-admin | — → ExportPreview | `api/dataTransfer.service.ts` |  |
| GET | `/api/data-transfer/export` | super-admin | — → raw-response | `api/dataTransfer.service.ts` | FILE/RAW |
| POST | `/api/data-transfer/step-up` | IP-rl | StepUpRequest → StepUpResponse | `api/dataTransfer.service.ts` |  |
| GET | `/api/data-transfer/history` | `data_transfer:view` | — → TransferHistory | `api/dataTransfer.service.ts` |  |
| POST | `/api/data-transfer/import/uploads` | `data_transfer:import` | — → raw-response | `api/dataTransfer.service.ts` | FILE/RAW |
| POST | `/api/data-transfer/import/preview` | `data_transfer:import` | ImportPreviewRequest → ImportPreview | `api/dataTransfer.service.ts` |  |
| POST | `/api/data-transfer/import/execute` | `data_transfer:import` | ImportExecuteRequest → raw-response | `api/dataTransfer.service.ts` | FILE/RAW |
| GET | `/api/data-transfer/import/jobs/{job_id}` | `data_transfer:import` | — → ImportJobStatus | `api/dataTransfer.service.ts` |  |
| DELETE | `/api/data-transfer/import/uploads/{upload_id}` | `data_transfer:import` | — → — | `api/dataTransfer.service.ts` |  |

### `ekyc` (16)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/ekyc/upload-document` | JWT + IP-rl | MULTIPART → any | `api/ekyc.service.ts` | UPLOAD, untyped |
| POST | `/api/ekyc/submit` | JWT + IP-rl | EkycSubmissionRequest → EkycStatusResponse | `api/ekyc.service.ts` |  |
| GET | `/api/ekyc/status` | JWT | — → Option<EkycStatusResponse> | `api/ekyc.service.ts` |  |
| POST | `/api/ekyc/self-checkin` | JWT | SelfCheckinRequest → any | — | NO-FE, untyped |
| GET | `/api/ekyc/admin/dashboard` | `ekyc:read` | — → EkycDashboardMetrics | — | NO-FE |
| GET | `/api/ekyc/admin/applications` | `ekyc:read` | — → EkycAdminListResponse | `api/ekyc.service.ts` |  |
| POST | `/api/ekyc/admin/applications` | JWT | EkycAdminCreateRequest → EkycApplicationDetail | `api/ekyc.service.ts` |  |
| GET | `/api/ekyc/admin/applications/export` | `ekyc:export` | — → raw-response | — | FILE/RAW, NO-FE |
| GET | `/api/ekyc/admin/applications/{id}` | `ekyc:read` | — → EkycApplicationDetail | `api/ekyc.service.ts` |  |
| POST | `/api/ekyc/admin/applications/{id}/actions` | JWT | EkycReviewActionRequest → EkycApplicationDetail | `api/ekyc.service.ts` |  |
| POST | `/api/ekyc/admin/applications/{id}/reveal` | JWT | EkycSensitiveRevealRequest → EkycSensitiveRevealResponse | `api/ekyc.service.ts` |  |
| GET | `/api/ekyc/admin/reason-codes` | `ekyc:review` | — → Vec<EkycReasonCode> | `api/ekyc.service.ts` |  |
| GET | `/api/ekyc/admin/applications/{id}/documents/{kind}` | `ekyc:download_documents` | — → file download | `features/ekyc/components/EkycManagementPage.tsx` | FILE/RAW |
| GET | `/api/ekyc/verifications` | `ekyc:read` | — → Vec<EkycApplicationSummary> | — | NO-FE |
| GET | `/api/ekyc/verifications/{id}` | `ekyc:read` + `ekyc:download_documents` | — → EkycApplicationDetail | — | NO-FE |
| GET | `/api/ekyc/verifications/{id}/documents/{kind}` | `ekyc:download_documents` | — → file download | — | FILE/RAW, NO-FE |

### `guest_booking` (11)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/booking/offers` | IP-rl | — → Vec<GuestBookingOffer> | `features/guestPortal/booking/api.ts` |  |
| GET | `/api/booking/room-types` | IP-rl | — → Vec<super::PublicRoomType> | — | NO-FE |
| POST | `/api/booking/quote` | IP-rl | BookingQuoteRequest → GuestBookingQuote | `features/guestPortal/booking/api.ts` |  |
| POST | `/api/booking/reservations` | IP-rl | AnonymousBookingRequest → GuestBookingConfirmation | `features/guestPortal/booking/api.ts` |  |
| GET | `/api/guest-portal/me/booking-options` | portal-session + IP-rl | — → Vec<GuestBookingOffer> | `features/guestPortal/booking/api.ts` |  |
| POST | `/api/guest-portal/me/booking-quote` | portal-session + IP-rl | BookingQuoteRequest → GuestBookingQuote | `features/guestPortal/booking/api.ts` |  |
| POST | `/api/guest-portal/me/booking-voucher-options` | portal-session + IP-rl | BookingQuoteRequest → GuestBookingVoucherOptions | `features/guestPortal/booking/api.ts` |  |
| GET | `/api/guest-portal/me/availability` | portal-session + IP-rl | — → WS-UPGRADE | `features/guestPortal/booking/api.ts` | WS |
| GET | `/api/admin/online-inventory` | `rooms:update` | — → — | `features/onlineInventory/api.ts` |  |
| PUT | `/api/admin/online-inventory/bulk` | `rooms:update` | — → — | `features/onlineInventory/api.ts` |  |
| PUT | `/api/admin/online-inventory/{room_type_id}/{stay_date}` | `rooms:update` | — → — | — | NO-FE |

### `guest_portal` (35)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/guest-portal/verify` | portal-session + IP-rl | GuestPortalVerifyRequest → GuestPortalVerifyResponse | `api/guestPortal.service.ts` |  |
| GET | `/api/guest-portal/booking` | portal-session + IP-rl | — → GuestPortalBookingResponse | `api/guestPortal.service.ts` |  |
| GET | `/api/guest-portal/booking/{token}` | portal-session + IP-rl | — → GuestPortalBookingResponse | — | NO-FE |
| POST | `/api/guest-portal/pre-checkin` | portal-session + IP-rl | PreCheckInUpdateRequest → GuestPortalBookingResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/pre-checkin/{token}` | portal-session + IP-rl | PreCheckInUpdateRequest → GuestPortalBookingResponse | — | NO-FE |
| POST | `/api/guest-portal/auto-checkin` | portal-session + IP-rl | — → AutoCheckinResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/auto-checkin/{token}` | portal-session + IP-rl | — → AutoCheckinResponse | — | NO-FE |
| POST | `/api/guest-portal/claim-account` | portal-session + IP-rl | GuestPortalClaimAccountRequest → GuestPortalClaimAccountResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/session` | JWT | — → GuestPortalLoginResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/logout` | portal-session | — → — | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/me` | portal-session + IP-rl | — → GuestPortalMeResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| PATCH | `/api/guest-portal/me/profile` | portal-session + IP-rl | crate::GuestPortalProfileUpdate → GuestPortalMeResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/me/bookings` | portal-session + IP-rl | — → GuestPortalPage<GuestPortalBookingSummary> | `features/guestPortal/api/guestPortalDashboard.service.ts`<br>`features/guestPortal/booking/api.ts` |  |
| POST | `/api/guest-portal/me/bookings` | portal-session + IP-rl | CreateGuestBookingRequest → GuestBookingConfirmation | `features/guestPortal/api/guestPortalDashboard.service.ts`<br>`features/guestPortal/booking/api.ts` |  |
| POST | `/api/guest-portal/me/bookings/{id}/cancel` | portal-session + IP-rl | crate::GuestBookingCancellationRequest → any | `features/guestPortal/api/guestPortalDashboard.service.ts` | untyped |
| GET | `/api/guest-portal/me/transactions` | portal-session + IP-rl | — → GuestPortalPage<GuestPortalTransaction> | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/me/membership` | portal-session + IP-rl | — → GuestPortalMembershipResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/me/benefits` | portal-session + IP-rl | — → GuestPortalBenefitsResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/me/credits` | portal-session + IP-rl | — → GuestPortalCreditsResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| GET | `/api/guest-portal/payment-config` | portal-session + IP-rl | — → GuestPaymentConfig | `api/guestPortal.service.ts`<br>`features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/me/payments/bank-transfer` | portal-session + IP-rl | crate::GuestBookingPaymentRequest → crate::PaymentActionResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/me/payments/{payment_id}/receipt` | portal-session | MULTIPART → any | `features/guestPortal/api/guestPortalDashboard.service.ts` | UPLOAD, untyped |
| GET | `/api/guest-portal/me/ekyc` | portal-session + IP-rl | — → Option<EkycStatusResponse> | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/me/ekyc/documents` | portal-session + IP-rl | MULTIPART → any | `features/guestPortal/api/guestPortalDashboard.service.ts` | UPLOAD, untyped |
| POST | `/api/guest-portal/me/ekyc/submit` | portal-session + IP-rl | EkycSubmissionRequest → EkycStatusResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/me/payments/paypal/create-order` | portal-session + IP-rl | crate::GuestBookingPaymentRequest → crate::PaypalCreateOrderResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/me/payments/paypal/capture` | portal-session + IP-rl | crate::SessionPaypalCaptureRequest → crate::PaymentActionResponse | `features/guestPortal/api/guestPortalDashboard.service.ts` |  |
| POST | `/api/guest-portal/booking/payments/bank-transfer` | portal-session + IP-rl | — → PaymentActionResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/booking/payments/{payment_id}/receipt` | portal-session + IP-rl | MULTIPART → any | `api/guestPortal.service.ts` | UPLOAD, untyped |
| POST | `/api/guest-portal/booking/payments/paypal/create-order` | portal-session + IP-rl | — → PaypalCreateOrderResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/booking/payments/paypal/capture` | portal-session + IP-rl | — → PaymentActionResponse | `api/guestPortal.service.ts` |  |
| POST | `/api/guest-portal/booking/{token}/payments/bank-transfer` | portal-session + IP-rl | — → PaymentActionResponse | — | NO-FE |
| POST | `/api/guest-portal/booking/{token}/payments/{payment_id}/receipt` | capability-token | MULTIPART → any | — | UPLOAD, untyped, NO-FE |
| POST | `/api/guest-portal/booking/{token}/payments/paypal/create-order` | portal-session + IP-rl | — → PaypalCreateOrderResponse | — | NO-FE |
| POST | `/api/guest-portal/booking/{token}/payments/paypal/capture` | portal-session + IP-rl | — → PaymentActionResponse | — | NO-FE |

### `guest_relations` (14)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/guests/{id}/interactions` | `guests:read` | — → InteractionListResponse | `api/guestRelations.service.ts` |  |
| POST | `/api/guests/{id}/interactions` | `guests:update` | GuestInteractionInput → GuestInteraction | `api/guestRelations.service.ts` |  |
| PATCH | `/api/guests/{id}/interactions/{nid}` | `guests:update` | GuestInteractionUpdate → GuestInteraction | `api/guestRelations.service.ts`<br>`features/guestRelations/hooks/useGuestRelationsQueries.ts` |  |
| DELETE | `/api/guests/{id}/interactions/{nid}` | `guests:update` | — → any | `api/guestRelations.service.ts`<br>`features/guestRelations/hooks/useGuestRelationsQueries.ts` |  |
| GET | `/api/guests/{id}/preferences` | `guests:read` | — → Vec<GuestPreference> | `api/guestRelations.service.ts` |  |
| PUT | `/api/guests/{id}/preferences` | `guests:update` | GuestPreferencesPut → Vec<GuestPreference> | `api/guestRelations.service.ts` |  |
| GET | `/api/guests/{id}/reviews` | `reviews:read` + `reviews:update` | — → Vec<GuestReviewRow> | `api/guestRelations.service.ts` |  |
| POST | `/api/guests/{id}/reviews/{rid}/response` | `reviews:update` | GuestReviewResponseInput → GuestReviewRow | `api/guestRelations.service.ts` |  |
| GET | `/api/guests/{id}/loyalty` | `guests:read` | — → Option<GuestLoyaltySummary> | `api/guestRelations.service.ts` |  |
| GET | `/api/guests/{id}/vouchers` | `guests:read` | — → Vec<GuestVoucherRow> | `api/guestRelations.service.ts` |  |
| GET | `/api/guests/{id}/communications` | `communications:read` | — → GuestCommunicationsSummary | `api/guestRelations.service.ts` |  |
| GET | `/api/guests/{id}/support` | `support:read` | — → Vec<SupportConversationSummary> | `api/guestRelations.service.ts` |  |
| GET | `/api/guest-relations/overview` | `guests:read` | — → OverviewResponse | `api/guestRelations.service.ts` |  |
| GET | `/api/guest-relations/follow-ups` | `guests:read` | — → FollowUpQueueResponse | `api/guestRelations.service.ts`<br>`features/guestRelations/pages/GuestRelationsFollowUpsPage.tsx` |  |

### `guests` (15)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/guests` | JWT | — → GuestPaginatedResponse | `api/guests.service.ts`<br>`api/queryKeys.ts` |  |
| POST | `/api/guests` | `guests:create` | GuestInput → Guest | `api/guests.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/guests/my-guests` | JWT | — → Vec<Guest> | `api/guests.service.ts` |  |
| GET | `/api/guests/my-guests-with-credits` | JWT | — → Vec<any> | `api/guests.service.ts` |  |
| POST | `/api/guests/link` | `guests:update` | LinkGuestInput → any | — | NO-FE, untyped |
| DELETE | `/api/guests/unlink/{guest_id}` | JWT | — → any | — | NO-FE, untyped |
| POST | `/api/guests/upgrade` | `guests:update` | UpgradeGuestInput → any | — | NO-FE, untyped |
| POST | `/api/guests/{id}/portal-account` | `guests:update` | TransferGuestPortalAccountInput → any | `api/guests.service.ts` | untyped |
| GET | `/api/guests/{id}` | `guests:read` | — → Guest | `api/guestRelations.service.ts`<br>`api/guests.service.ts` |  |
| PATCH | `/api/guests/{id}` | `guests:update` | GuestUpdateInput → Guest | `api/guestRelations.service.ts`<br>`api/guests.service.ts` |  |
| DELETE | `/api/guests/{id}` | `guests:delete` | — → any | `api/guestRelations.service.ts`<br>`api/guests.service.ts` | untyped |
| GET | `/api/guests/{id}/profile` | `guests:read` | — → GuestProfile | `api/guests.service.ts` |  |
| POST | `/api/guests/{id}/tourism-from-last-check-in` | `guests:update` | — → GuestTourismConversionResponse | `api/guests.service.ts` |  |
| GET | `/api/guests/{id}/bookings` | `guests:read` | — → Vec<any> | `api/guests.service.ts` |  |
| GET | `/api/guests/{id}/credits` | JWT | — → any | `api/guests.service.ts` | untyped |

### `housekeeping` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/housekeeping/tasks` | `housekeeping:read` | — → HousekeepingTaskListResponse | `api/housekeeping.service.ts` |  |
| POST | `/api/housekeeping/tasks` | `housekeeping:create` | CreateHousekeepingTaskRequest → HousekeepingTask | `api/housekeeping.service.ts` |  |
| PATCH | `/api/housekeeping/tasks/{id}` | `housekeeping:update` | UpdateHousekeepingTaskRequest → HousekeepingTask | `api/housekeeping.service.ts` |  |
| GET | `/api/housekeeping/board` | `housekeeping:read` | — → HousekeepingBoardResponse | `api/housekeeping.service.ts` |  |
| GET | `/api/housekeeping/assignable-staff` | any of `housekeeping:update`, `housekeeping:manage`, `maintenance:write`, `maintenance:manage` | — → Vec<AssignableStaffMember> | `api/housekeeping.service.ts` |  |

### `insights` (3)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/insights/overview` | `analytics:read` | — → InsightsOverview | `features/dashboard/components/reports/reportsModel.ts`<br>`features/insights/api.ts` |  |
| GET | `/api/insights/reports` | `analytics:read` | — → &'static [ReportCatalogEntry] | `features/insights/api.ts` |  |
| GET | `/api/insights/reports/{id}` | JWT | — → ReportEnvelope | `features/insights/api.ts` |  |

### `ledgers` (14)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/ledgers` | `ledgers:read` | — → LedgerPaginatedResponse | `api/ledger.service.ts`<br>`api/queryKeys.ts` |  |
| POST | `/api/ledgers` | `ledgers:create` | CustomerLedgerCreateRequest → CustomerLedger | `api/ledger.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/ledgers/summary` | `ledgers:read` | — → any | `api/ledger.service.ts` | untyped |
| POST | `/api/ledgers/company-payments` | `ledgers:create` | CompanyLedgerPaymentRequest → CompanyLedgerPaymentResponse | `api/ledger.service.ts` |  |
| GET | `/api/ledgers/{id}` | `ledgers:read` | — → CustomerLedger | `api/ledger.service.ts` |  |
| PATCH | `/api/ledgers/{id}` | `ledgers:update` | CustomerLedgerUpdateRequest → CustomerLedger | `api/ledger.service.ts` |  |
| DELETE | `/api/ledgers/{id}` | `ledgers:manage` | — → any | `api/ledger.service.ts` | untyped |
| GET | `/api/ledgers/{id}/with-payments` | `ledgers:read` | — → CustomerLedgerWithPayments | `api/ledger.service.ts` |  |
| GET | `/api/ledgers/{id}/payments` | `ledgers:read` | — → Vec<CustomerLedgerPayment> | `api/ledger.service.ts` |  |
| POST | `/api/ledgers/{id}/payments` | `ledgers:create` | CustomerLedgerPaymentRequest → CustomerLedgerPayment | `api/ledger.service.ts` |  |
| PATCH | `/api/ledgers/{id}/payments/{payment_id}` | `ledgers:update` | UpdateLedgerPaymentRequest → CustomerLedgerPayment | `api/ledger.service.ts` |  |
| DELETE | `/api/ledgers/{id}/payments/{payment_id}` | `ledgers:manage` | — → any | `api/ledger.service.ts` | untyped |
| POST | `/api/ledgers/{id}/void` | `ledgers:void` | LedgerVoidRequest → CustomerLedger | `api/ledger.service.ts` |  |
| POST | `/api/ledgers/{id}/reverse` | `ledgers:void` | LedgerReversalRequest → CustomerLedger | `api/ledger.service.ts` |  |

### `loyalty` (19)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/loyalty/me` | JWT | — → LoyaltyMeResponse | — | NO-FE |
| POST | `/api/loyalty/enroll` | JWT | — → LoyaltyEnrollmentResponse | — | NO-FE |
| GET | `/api/loyalty/me/activity` | JWT | — → Vec<LoyaltyTransaction> | — | NO-FE |
| GET | `/api/loyalty/rewards` | JWT | — → Vec<LoyaltyReward> | `api/loyalty.service.ts` |  |
| POST | `/api/loyalty/rewards/{id}/redeem` | JWT | RedeemRewardInput → LoyaltyRedemption | — | NO-FE |
| GET | `/api/admin/loyalty/members` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → Vec<LoyaltyMemberSummary> | `api/loyaltyAdmin.service.ts` |  |
| GET | `/api/admin/loyalty/members/{id}` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → LoyaltyMemberDetail | `api/loyaltyAdmin.service.ts` |  |
| POST | `/api/admin/loyalty/members/{id}/adjustments` | any of `loyalty:manage` | ManualAdjustmentInput → LoyaltyTransaction | `api/loyaltyAdmin.service.ts` |  |
| POST | `/api/admin/loyalty/members/{id}/gifts` | any of `loyalty:manage` | GiftPointsInput → LoyaltyTransaction | `api/loyaltyAdmin.service.ts` |  |
| GET | `/api/admin/loyalty/socket` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → WS-UPGRADE | `features/loyalty/hooks/useLoyaltySocket.ts` | WS |
| GET | `/api/guest-portal/me/loyalty/socket` | portal-session | — → WS-UPGRADE | `features/guestPortal/hooks/useGuestLoyaltySocket.ts` | WS |
| GET | `/api/admin/loyalty/rules` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → LoyaltyProgramRules | `api/loyaltyAdmin.service.ts` |  |
| PUT | `/api/admin/loyalty/rules` | any of `loyalty:manage` | LoyaltyRulesInput → LoyaltyProgramRules | `api/loyaltyAdmin.service.ts` |  |
| GET | `/api/admin/loyalty/rewards` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → Vec<LoyaltyReward> | `api/loyaltyAdmin.service.ts` |  |
| POST | `/api/admin/loyalty/rewards` | any of `loyalty:manage` | RewardInput → LoyaltyReward | `api/loyaltyAdmin.service.ts` |  |
| PUT | `/api/admin/loyalty/rewards/{id}` | any of `loyalty:manage` | RewardUpdateInput → LoyaltyReward | `api/loyaltyAdmin.service.ts` |  |
| GET | `/api/admin/loyalty/redemptions` | any of `loyalty:read`, `loyalty:manage`, `analytics:read` | — → Vec<LoyaltyRedemption> | `api/loyaltyAdmin.service.ts` |  |
| PUT | `/api/admin/loyalty/redemptions/{id}/approve` | any of `loyalty:manage` | — → LoyaltyRedemption | `api/loyaltyAdmin.service.ts` |  |
| PUT | `/api/admin/loyalty/redemptions/{id}/reject` | any of `loyalty:manage` | RejectRedemptionInput → LoyaltyRedemption | `api/loyaltyAdmin.service.ts` |  |

### `maintenance` (4)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/maintenance` | `maintenance:read` | — → MaintenanceTicketListResponse | `api/maintenance.service.ts`<br>`api/queryKeys.ts` |  |
| POST | `/api/maintenance` | `maintenance:write` | CreateMaintenanceTicketRequest → MaintenanceTicket | `api/maintenance.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/maintenance/{id}` | `maintenance:read` | — → MaintenanceTicket | `api/maintenance.service.ts` |  |
| PATCH | `/api/maintenance/{id}` | `maintenance:write` | UpdateMaintenanceTicketRequest → MaintenanceTicket | `api/maintenance.service.ts` |  |

### `night_audit` (6)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/night-audit/preview` | `night_audit:read` | — → NightAuditPreview | — | NO-FE |
| POST | `/api/night-audit/run` | `night_audit:execute` | RunNightAuditRequest → NightAuditResponse | `api/nightAudit.service.ts` |  |
| GET | `/api/night-audit` | `night_audit:read` | — → NightAuditListResponse | `api/nightAudit.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/night-audit/{id}` | `night_audit:read` | — → NightAuditRunWithUser | `api/nightAudit.service.ts` |  |
| GET | `/api/night-audit/{id}/details` | `night_audit:read` | — → AuditDetailsResponse | `api/nightAudit.service.ts` |  |
| GET | `/api/bookings/{id}/posted` | `bookings:read` | — → any | `api/nightAudit.service.ts` | untyped |

### `passkey` (4)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/auth/passkey/register/start` | JWT + IP-rl | PasskeyRegistrationStart → any | `auth/AuthContext.tsx` | untyped |
| POST | `/api/auth/passkey/register/finish` | JWT + IP-rl | PasskeyRegistrationFinish → any | `auth/AuthContext.tsx` | untyped |
| POST | `/api/auth/passkey/login/start` | IP-rl | PasskeyLoginStart → any | `auth/AuthContext.tsx` | untyped |
| POST | `/api/auth/passkey/login/finish` | IP-rl | PasskeyLoginFinish → raw-response | `auth/AuthContext.tsx` | FILE/RAW |

### `payment_retry` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/booking/recover-payment/{token}` | IP-rl | — → PaymentRecoveryView | `features/paymentRecovery/api.ts` |  |
| POST | `/api/booking/recover-payment/{token}/bank-transfer` | IP-rl | — → PaymentActionResponse | `features/paymentRecovery/api.ts` |  |
| POST | `/api/booking/recover-payment/{token}/paypal/create-order` | IP-rl | — → PaypalCreateOrderResponse | `features/paymentRecovery/api.ts` |  |
| POST | `/api/booking/recover-payment/{token}/paypal/capture` | IP-rl | CaptureRecoveredPaypalRequest → PaymentActionResponse | `features/paymentRecovery/api.ts` |  |
| POST | `/api/booking/recover-payment/{token}/payments/{payment_id}/receipt` | capability-token + IP-rl | MULTIPART → any | `features/paymentRecovery/api.ts` | UPLOAD, untyped |

### `payments` (22)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/payments/calculate/{booking_id}` | `payments:read` | — → PaymentSummary | — | NO-FE |
| POST | `/api/payments/record-payment` | `payments:create` | RecordPaymentRequest → any | `api/invoices.service.ts` | untyped |
| GET | `/api/payments/all-payments/{booking_id}` | `payments:read` | — → Vec<any> | `api/invoices.service.ts` |  |
| GET | `/api/payments/workflow-summary/{booking_id}` | `payments:read` | — → PaymentWorkflowSummary | `api/invoices.service.ts` |  |
| POST | `/api/payments/refund-deposit/{booking_id}` | `payments:refund` | any → any | `api/invoices.service.ts` | untyped |
| POST | `/api/payments/forfeit-deposit/{booking_id}` | `payments:refund` | any → any | `api/invoices.service.ts` | untyped |
| POST | `/api/payments/revert-deposit-refund/{booking_id}` | `payments:manage` | — → any | `api/invoices.service.ts` | untyped |
| POST | `/api/payments/revert-deposit-void/{booking_id}` | `payments:delete` | — → any | `api/invoices.service.ts` | untyped |
| GET | `/api/payments/booking/{booking_id}` | `payments:read` | — → Option<Payment> | — | NO-FE |
| PATCH | `/api/payments/{payment_id}` | `payments:update` | UpdatePaymentRequest → any | `api/invoices.service.ts` | untyped |
| DELETE | `/api/payments/{payment_id}` | `payments:delete` | — → any | `api/invoices.service.ts` | untyped |
| POST | `/api/payments` | `payments:create` | PaymentRequest → Payment | `api/ledger.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/admin/payments/pending` | `payments:read` | — → PendingPaymentPage | `api/paymentApprovals.service.ts` |  |
| GET | `/api/admin/payments/history` | `payments:read` | — → PendingPaymentPage | `api/paymentApprovals.service.ts` |  |
| GET | `/api/admin/payments/paypal-conflicts` | `payments:read` | — → any | `api/paymentApprovals.service.ts` | untyped |
| GET | `/api/admin/payments/{payment_id}/receipt` | `payments:read` | — → raw-response | `api/paymentApprovals.service.ts` | FILE/RAW |
| PUT | `/api/admin/payments/{payment_id}/approve` | `payments:approve` | — → PaymentActionResponse | `api/paymentApprovals.service.ts` |  |
| PUT | `/api/admin/payments/{payment_id}/reject` | `payments:approve` | RejectPaymentRequest → PaymentActionResponse | `api/paymentApprovals.service.ts` |  |
| POST | `/api/admin/payments/{payment_id}/request-receipt` | `payments:approve` | RequestPaymentReceiptRequest → any | `api/paymentApprovals.service.ts` | untyped |
| GET | `/api/invoices/preview/{booking_id}` | `payments:read` | — → InvoicePreview | `api/invoices.service.ts` |  |
| POST | `/api/invoices/generate/{booking_id}` | `payments:create` | — → Invoice | `api/invoices.service.ts` |  |
| GET | `/api/invoices` | `payments:read` | — → Vec<Invoice> | `api/invoices.service.ts`<br>`api/queryKeys.ts` |  |

### `profile` (14)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/profile` | JWT | — → UserProfile | `api/queryKeys.ts`<br>`api/users.service.ts` |  |
| PATCH | `/api/profile` | JWT | UserProfileUpdate → UserProfile | `api/queryKeys.ts`<br>`api/users.service.ts` |  |
| POST | `/api/profile/complete` | JWT | CompleteGuestProfileRequest → UserProfile | `api/auth.service.ts` |  |
| POST | `/api/profile/password` | JWT + IP-rl | PasswordUpdateInput → any | `api/users.service.ts` | untyped |
| GET | `/api/profile/sessions` | JWT (handler) | — → Vec<UserSessionInfo> | `api/auth.service.ts`<br>`features/guestPortal/components/dashboard/DevicesSection.tsx` |  |
| DELETE | `/api/profile/sessions/{id}` | JWT | — → any | `api/auth.service.ts` | untyped |
| GET | `/api/profile/passkeys` | JWT | — → Vec<PasskeyInfo> | `api/auth.service.ts` |  |
| DELETE | `/api/profile/passkeys/{id}` | JWT | — → any | `api/auth.service.ts` | untyped |
| PATCH | `/api/profile/passkeys/{id}` | JWT | PasskeyUpdateInput → any | `api/auth.service.ts` | untyped |
| POST | `/api/profile/2fa/setup` | JWT + IP-rl | TwoFactorSetupRequest → any | `api/auth.service.ts` | untyped |
| POST | `/api/profile/2fa/enable` | JWT + IP-rl | TwoFactorEnableRequest → any | `api/auth.service.ts` | untyped |
| POST | `/api/profile/2fa/disable` | JWT + IP-rl | TwoFactorDisableRequest → any | `api/auth.service.ts` | untyped |
| GET | `/api/profile/2fa/status` | JWT | — → TwoFactorStatusResponse | — | NO-FE |
| POST | `/api/profile/2fa/verify` | JWT + IP-rl | TwoFactorVerifyRequest → any | — | NO-FE, untyped |

### `promotions` (20)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/promotions` | public | — → PublicPromotionListResponse | `api/queryKeys.ts`<br>`features/auth/components/LoginPage.tsx` |  |
| GET | `/api/promotions/{slug}` | public | — → PublicPromotion | — | NO-FE |
| GET | `/api/guest-portal/me/promotions` | portal-session + IP-rl | — → GuestPromotionListResponse | `features/promotions/api/portalPromotionsApi.ts` |  |
| POST | `/api/guest-portal/me/promotions/{id}/claim` | portal-session | ClaimPromotionInput → Voucher | `features/promotions/api/portalPromotionsApi.ts` |  |
| GET | `/api/guest-portal/me/vouchers` | portal-session + IP-rl | — → VoucherListResponse | `features/promotions/api/portalPromotionsApi.ts` |  |
| GET | `/api/admin/promotions` | `promotions:read` | — → PromotionListResponse | `features/promotions/api/promotionsApi.ts` |  |
| POST | `/api/admin/promotions` | `promotions:manage` | PromotionInput → Promotion | `features/promotions/api/promotionsApi.ts` |  |
| GET | `/api/admin/promotions/targeting-options` | `promotions:read` | — → TargetingOptionsResponse | `features/promotions/api/promotionsApi.ts` |  |
| GET | `/api/admin/promotions/{id}` | `promotions:read` | — → Promotion | `features/promotions/api/promotionsApi.ts` |  |
| PUT | `/api/admin/promotions/{id}` | `promotions:manage` | PromotionInput → Promotion | `features/promotions/api/promotionsApi.ts` |  |
| POST | `/api/admin/promotions/{id}/publish` | `promotions:approve` | PromotionActionInput → Promotion | — | NO-FE |
| POST | `/api/admin/promotions/{id}/pause` | `promotions:manage` | PromotionActionInput → Promotion | — | NO-FE |
| POST | `/api/admin/promotions/{id}/archive` | `promotions:manage` | PromotionActionInput → Promotion | — | NO-FE |
| POST | `/api/admin/promotions/{id}/cancel` | `promotions:manage` | PromotionActionInput → Promotion | — | NO-FE |
| GET | `/api/admin/promotions/{id}/performance` | `promotions:read` | — → CampaignPerformance | `features/promotions/api/promotionsApi.ts` |  |
| GET | `/api/admin/vouchers` | `vouchers:read` | — → VoucherListResponse | `features/promotions/api/promotionsApi.ts` |  |
| POST | `/api/admin/vouchers` | `vouchers:manage` | VoucherIssueInput → Voucher | `features/promotions/api/promotionsApi.ts` |  |
| GET | `/api/admin/vouchers/summary` | `vouchers:read` | — → VoucherSummary | `features/promotions/api/promotionsApi.ts` |  |
| GET | `/api/admin/vouchers/{id}` | `vouchers:read` | — → Voucher | `features/promotions/api/promotionsApi.ts` |  |
| POST | `/api/admin/vouchers/{id}/revoke` | `vouchers:manage` | VoucherRevokeInput → Voucher | `features/promotions/api/promotionsApi.ts` |  |

### `rates` (15)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/rate-plans` | `rooms:read` | — → raw-response | `features/rates/api.ts`<br>`features/rates/hooks/useRatePlans.ts` | FILE/RAW |
| POST | `/api/rate-plans` | `rooms:write` | RatePlanInput → raw-response | `features/rates/api.ts`<br>`features/rates/hooks/useRatePlans.ts` | FILE/RAW |
| GET | `/api/rate-plans/{id}` | `rooms:read` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| GET | `/api/rate-plans/{id}/with-rates` | `rooms:read` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| PATCH | `/api/rate-plans/{id}` | `rooms:update` | RatePlanUpdateInput → raw-response | `features/rates/api.ts` | FILE/RAW |
| DELETE | `/api/rate-plans/{id}` | `rooms:write` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| GET | `/api/room-rates` | `rooms:read` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| POST | `/api/room-rates` | `rooms:write` | RoomRateInput → raw-response | `features/rates/api.ts` | FILE/RAW |
| POST | `/api/room-rates/bulk` | `rooms:write` | BulkRoomRateInput → raw-response | `features/rates/api.ts` | FILE/RAW |
| GET | `/api/room-rates/by-plan/{rate_plan_id}` | `rooms:read` | — → raw-response | — | FILE/RAW, NO-FE |
| GET | `/api/room-rates/{id}` | `rooms:read` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| PATCH | `/api/room-rates/{id}` | `rooms:update` | RoomRateUpdateInput → raw-response | `features/rates/api.ts` | FILE/RAW |
| DELETE | `/api/room-rates/{id}` | `rooms:write` | — → raw-response | `features/rates/api.ts` | FILE/RAW |
| GET | `/api/room-rates/applicable` | `rooms:read` | — → raw-response | — | FILE/RAW, NO-FE |
| GET | `/api/rate-management/room-types` | `rooms:read` | — → raw-response | `features/rates/api.ts` | FILE/RAW |

### `rbac` (15)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/rbac/snapshot` | any of `roles:read`, `roles:manage`, `permissions:read`, `permissions:manage`, `users:read`, `users:manage` | — → RbacSnapshot | `api/admin.service.ts` |  |
| GET | `/api/rbac/route-policies` | any of `roles:read`, `roles:manage`, `permissions:read`, `permissions:manage`, `users:read`, `users:manage` | — → Vec<RouteAccessPolicy> | `api/admin.service.ts` |  |
| PUT | `/api/rbac/route-policies/{route_id}` | any of `permissions:manage` | RouteAccessPolicyInput → RouteAccessPolicy | `api/admin.service.ts` |  |
| GET | `/api/rbac/roles` | any of `roles:read`, `roles:manage` | — → Vec<Role> | `api/admin.service.ts` |  |
| POST | `/api/rbac/roles` | any of `roles:create`, `roles:manage` | RoleInput → Role | `api/admin.service.ts` |  |
| PUT | `/api/rbac/roles/{role_id}` | any of `roles:update`, `roles:manage` | RoleInput → Role | `api/admin.service.ts` |  |
| DELETE | `/api/rbac/roles/{role_id}` | any of `roles:delete`, `roles:manage` | — → any | `api/admin.service.ts` | untyped |
| GET | `/api/rbac/roles/{role_id}/permissions` | any of `roles:read`, `roles:manage` | — → RoleWithPermissions | `api/admin.service.ts` |  |
| PUT | `/api/rbac/roles/{role_id}/permissions` | any of `permissions:manage` | RolePermissionIdsInput → any | `api/admin.service.ts` | untyped |
| GET | `/api/rbac/permissions` | any of `permissions:read`, `permissions:manage`, `roles:read`, `roles:manage` | — → Vec<Permission> | `api/admin.service.ts` |  |
| POST | `/api/rbac/permissions` | any of `permissions:create`, `permissions:manage` + super-admin | PermissionInput → Permission | `api/admin.service.ts` |  |
| PUT | `/api/rbac/permissions/{permission_id}` | any of `permissions:update`, `permissions:manage` + super-admin | PermissionInput → Permission | `api/admin.service.ts` |  |
| DELETE | `/api/rbac/permissions/{permission_id}` | any of `permissions:delete`, `permissions:manage` + super-admin | — → any | `api/admin.service.ts` | untyped |
| POST | `/api/rbac/roles/permissions` | any of `permissions:manage` | AssignPermissionInput → any | `api/admin.service.ts` | untyped |
| DELETE | `/api/rbac/roles/{role_id}/permissions/{permission_id}` | any of `permissions:manage` | — → any | `api/admin.service.ts` | untyped |

### `realtime` (1)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/updates/socket` | JWT (handler) | — → WS-UPGRADE | `hooks/useDataChangeSocket.ts` | WS |

### `revenue` (3)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/revenue/overview` | `revenue:read` | — → RevenueOverview | `features/dashboard/components/reports/reportsModel.ts`<br>`features/revenue/api.ts` |  |
| GET | `/api/revenue/receivables` | `revenue:read` | — → Receivables | `features/dashboard/components/reports/reportsModel.ts`<br>`features/revenue/api.ts` |  |
| GET | `/api/revenue/rate-calendar` | `revenue:read` | — → RateCalendar | `features/rates/api.ts` |  |

### `rooms` (27)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/rooms` | `rooms:read` | — → Vec<RoomWithRating> | `api/queryKeys.ts`<br>`api/rooms.service.ts` |  |
| POST | `/api/rooms` | `rooms:write` | RoomCreateInput → Room | `api/queryKeys.ts`<br>`api/rooms.service.ts` |  |
| GET | `/api/rooms/available` | `rooms:read` | — → Vec<RoomWithRating> | `api/rooms.service.ts` |  |
| PATCH | `/api/rooms/{id}` | `rooms:update` | RoomUpdateInput → Room | `api/rooms.service.ts` |  |
| DELETE | `/api/rooms/{id}` | `rooms:write` | — → any | `api/rooms.service.ts` | untyped |
| GET | `/api/room-types` | `rooms:read` | — → Vec<RoomType> | `api/queryKeys.ts`<br>`api/rooms.service.ts` |  |
| GET | `/api/room-types/all` | JWT (handler) | — → Vec<RoomType> | `api/rooms.service.ts` |  |
| POST | `/api/room-types` | JWT (handler) | RoomTypeCreateInput → RoomType | `api/queryKeys.ts`<br>`api/rooms.service.ts` |  |
| GET | `/api/room-types/{id}` | JWT (handler) | — → RoomType | `api/rooms.service.ts` |  |
| PATCH | `/api/room-types/{id}` | JWT (handler) | RoomTypeUpdateInput → RoomType | `api/rooms.service.ts` |  |
| DELETE | `/api/room-types/{id}` | JWT (handler) | — → any | `api/rooms.service.ts` | untyped |
| POST | `/api/room-types/{id}/images` | JWT (handler) | MULTIPART → RoomType | `api/rooms.service.ts` | UPLOAD |
| GET | `/api/rooms/{room_type}/reviews` | `rooms:read` | — → Vec<GuestReview> | `api/rooms.service.ts` |  |
| PUT | `/api/rooms/{id}/status` | JWT (handler) | RoomStatusUpdateInput → Room | `api/rooms.service.ts` |  |
| POST | `/api/rooms/{id}/events` | JWT (handler) | RoomEventInput → RoomEvent | `api/rooms.service.ts` |  |
| GET | `/api/rooms/{id}/detailed` | JWT (handler) | — → RoomDetailedStatus | `api/rooms.service.ts` |  |
| GET | `/api/rooms/{id}/history` | JWT (handler) | — → Vec<any> | `api/rooms.service.ts` |  |
| POST | `/api/rooms/{id}/end-maintenance` | JWT (handler) | — → Room | `api/rooms.service.ts` |  |
| POST | `/api/rooms/{id}/end-cleaning` | JWT (handler) | — → any | — | NO-FE, untyped |
| POST | `/api/rooms/sync-statuses` | JWT (handler) | — → any | `api/rooms.service.ts` | untyped |
| POST | `/api/rooms/{id}/execute-change` | JWT (handler) | any → any | `api/rooms.service.ts` | untyped |
| GET | `/api/rooms/change-history` | JWT (handler) | — → Vec<any> | — | NO-FE |
| GET | `/api/rooms/occupancy` | JWT (handler) | — → Vec<RoomCurrentOccupancy> | `api/rooms.service.ts` |  |
| GET | `/api/rooms/occupancy/summary` | JWT (handler) | — → HotelOccupancySummary | `api/rooms.service.ts` |  |
| GET | `/api/rooms/occupancy/by-type` | JWT (handler) | — → Vec<OccupancyByRoomType> | `api/rooms.service.ts` |  |
| GET | `/api/rooms/with-occupancy` | JWT (handler) | — → Vec<RoomWithOccupancy> | `api/rooms.service.ts` |  |
| GET | `/api/rooms/{id}/occupancy` | JWT (handler) | — → RoomCurrentOccupancy | `api/rooms.service.ts` |  |

### `search` (1)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/search` | JWT | — → SearchResponse | `api/audit.service.ts`<br>`components/layout/CommandPalette.tsx` |  |

### `segments` (8)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/admin/segments` | `segments:read` | — → SegmentListResponse | `features/segments/api.ts` |  |
| POST | `/api/admin/segments` | `segments:manage` | SegmentInput → GuestSegment | `features/segments/api.ts` |  |
| GET | `/api/admin/segments/field-options` | `segments:read` | — → SegmentFieldOptions | `features/segments/api.ts` |  |
| POST | `/api/admin/segments/preview` | `segments:read` | SegmentPreviewInput → SegmentPreview | `features/segments/api.ts` |  |
| GET | `/api/admin/segments/{id}` | `segments:read` | — → GuestSegment | `features/segments/api.ts` |  |
| PUT | `/api/admin/segments/{id}` | `segments:manage` | SegmentInput → GuestSegment | `features/segments/api.ts` |  |
| DELETE | `/api/admin/segments/{id}` | `segments:manage` | — → any | `features/segments/api.ts` | untyped |
| GET | `/api/admin/segments/{id}/preview` | `segments:read` | — → SegmentPreview | `features/segments/api.ts` |  |

### `settings` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/settings` | `settings:read` | — → Vec<SystemSetting> | `api/admin.service.ts`<br>`api/queryKeys.ts` |  |
| GET | `/api/settings/public` | public | — → Vec<PublicSetting> | `api/admin.service.ts`<br>`features/legal/components/LegalDocumentPage.tsx` |  |
| PATCH | `/api/settings/{key}` | `settings:update` | SystemSettingUpdate → SystemSetting | `api/admin.service.ts` |  |
| POST | `/api/settings/{key}/reset` | `settings:update` | — → SystemSetting | `api/admin.service.ts` |  |
| POST | `/api/system/process-checkins` | JWT | — → any | — | NO-FE, untyped |

### `support` (12)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/support/conversations` | `support:read` | — → SupportConversationListResponse | `api/guestRelations.service.ts`<br>`features/support/api.ts` |  |
| POST | `/api/support/conversations` | `support:write` | CreateStaffConversationRequest → SupportConversationDetail | `api/guestRelations.service.ts`<br>`features/support/api.ts` |  |
| GET | `/api/support/agents` | any of `support:assign`, `support:manage` | — → Vec<super::SupportAgent> | `features/support/api.ts` |  |
| GET | `/api/support/conversations/{id}` | `support:read` | — → SupportConversationDetail | `features/support/api.ts` |  |
| POST | `/api/support/conversations/{id}/messages` | JWT | SupportMessageRequest → SupportConversationDetail | `features/support/api.ts` |  |
| POST | `/api/support/conversations/{id}/actions` | JWT | SupportActionRequest → SupportConversationDetail | `features/support/api.ts` |  |
| GET | `/api/guest-portal/me/support/conversations` | portal-session + IP-rl | — → GuestSupportConversationListResponse | `features/guestPortal/api/guestPortalSupport.service.ts` |  |
| POST | `/api/guest-portal/me/support/conversations` | portal-session + IP-rl | CreateGuestSupportConversationRequest → GuestSupportConversationDetail | `features/guestPortal/api/guestPortalSupport.service.ts` |  |
| GET | `/api/guest-portal/me/support/conversations/{id}` | portal-session + IP-rl | — → GuestSupportConversationDetail | — | NO-FE |
| POST | `/api/guest-portal/me/support/conversations/{id}/messages` | portal-session + IP-rl | GuestSupportMessageRequest → GuestSupportConversationDetail | — | NO-FE |
| POST | `/api/guest-portal/me/support/conversations/{id}/reopen` | portal-session + IP-rl | — → GuestSupportConversationDetail | — | NO-FE |
| GET | `/api/guest-portal/me/support/socket` | portal-session + IP-rl | — → WS-UPGRADE | `features/guestPortal/api/guestPortalSupport.service.ts` | WS |

### `system` (5)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/system/health` | `settings:manage` | — → SystemHealthResponse | `features/admin/system/api.ts` |  |
| GET | `/api/system/jobs/failures` | `settings:manage` | — → Vec<JobRunRow> | `features/admin/system/api.ts` |  |
| GET | `/api/system/notifications` | JWT | — → StaffNotificationsResponse | `features/admin/system/api.ts` |  |
| POST | `/api/system/notifications/{id}/read` | JWT | — → any | `features/admin/system/api.ts` | untyped |
| POST | `/api/system/notifications/read-all` | JWT | — → any | `features/admin/system/api.ts` | untyped |

### `teams` (8)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/teams` | `teams:read` | — → Vec<TeamSummary> | `features/admin/components/rbac/RolesTab/NavigationAccessSection.tsx` |  |
| POST | `/api/teams` | `teams:create` | TeamCreateInput → Team | `features/admin/components/rbac/RolesTab/NavigationAccessSection.tsx` |  |
| GET | `/api/teams/{team_id}` | `teams:read` | — → TeamDetail | — | NO-FE |
| PATCH | `/api/teams/{team_id}` | `teams:update` | TeamUpdateInput → Team | — | NO-FE |
| DELETE | `/api/teams/{team_id}` | `teams:delete` | — → any | — | NO-FE, untyped |
| POST | `/api/teams/{team_id}/members` | JWT | TeamMemberInput → any | — | NO-FE, untyped |
| DELETE | `/api/teams/{team_id}/members/{member_user_id}` | JWT | — → any | — | NO-FE, untyped |
| PUT | `/api/teams/{team_id}/roles` | `teams:manage` | TeamRoleIdsInput → any | — | NO-FE, untyped |

### `two_factor` (6)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/auth/2fa/setup` | JWT + IP-rl | TwoFactorSetupRequest → any | — | NO-FE, untyped |
| POST | `/api/auth/2fa/enable` | JWT + IP-rl | TwoFactorEnableRequest → any | — | NO-FE, untyped |
| POST | `/api/auth/2fa/disable` | JWT + IP-rl | TwoFactorDisableRequest → any | — | NO-FE, untyped |
| GET | `/api/auth/2fa/status` | JWT | — → TwoFactorStatusResponse | `api/auth.service.ts` |  |
| POST | `/api/auth/2fa/verify` | JWT + IP-rl | TwoFactorVerifyRequest → any | — | NO-FE, untyped |
| POST | `/api/auth/2fa/regenerate-backup-codes` | JWT + IP-rl | RegenerateBackupCodesRequest → any | `api/auth.service.ts` | untyped |

### `users` (17)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| GET | `/api/users` | any of `users:read`, `users:manage` | — → Vec<UserResponse> | `api/queryKeys.ts`<br>`api/users.service.ts` |  |
| POST | `/api/users` | any of `users:create`, `users:manage` | UserCreateInput → UserResponse | `api/queryKeys.ts`<br>`api/users.service.ts` |  |
| GET | `/api/users/directory` | any of `users:read`, `users:manage` | — → StaffDirectoryResponse | — | NO-FE |
| POST | `/api/users/invite` | any of `users:create`, `users:manage` | InviteUserInput → InviteUserResponse | — | NO-FE |
| GET | `/api/users/{user_id}` | any of `users:read`, `users:manage` | — → UserWithRolesAndPermissions | `api/users.service.ts` |  |
| PATCH | `/api/users/{user_id}` | any of `users:update`, `users:manage` | UserUpdateInput → UserResponse | `api/users.service.ts` |  |
| DELETE | `/api/users/{user_id}` | any of `users:delete`, `users:manage` | — → any | `api/users.service.ts` | untyped |
| POST | `/api/users/{user_id}/suspend` | any of `users:update`, `users:manage` | — → UserResponse | — | NO-FE |
| POST | `/api/users/{user_id}/reactivate` | any of `users:update`, `users:manage` | — → UserResponse | — | NO-FE |
| POST | `/api/users/{user_id}/unlock` | any of `users:update`, `users:manage` | — → UserResponse | — | NO-FE |
| POST | `/api/users/{user_id}/resend-invite` | any of `users:create`, `users:manage` | — → InviteUserResponse | — | NO-FE |
| GET | `/api/users/{user_id}/sessions` | any of `users:read`, `users:manage` | — → Vec<auth::UserSessionInfo> | — | NO-FE |
| DELETE | `/api/users/{user_id}/sessions` | any of `users:update`, `users:manage` | — → any | — | NO-FE, untyped |
| DELETE | `/api/users/{user_id}/sessions/{session_id}` | any of `users:update`, `users:manage` | — → any | — | NO-FE, untyped |
| POST | `/api/users/roles` | any of `users:update`, `users:manage` | AssignRoleInput → any | `api/users.service.ts` | untyped |
| PUT | `/api/users/{user_id}/roles` | any of `users:update`, `users:manage` | UserRoleIdsInput → any | `api/users.service.ts` | untyped |
| DELETE | `/api/users/{user_id}/roles/{role_id}` | any of `users:update`, `users:manage` | — → any | `api/users.service.ts` | untyped |

### `webhooks` (1)

| Method | Path | Auth | Request → Response | FE caller | Flags |
|---|---|---|---|---|---|
| POST | `/api/webhooks/paypal` | IP-rl | — → any | — | NO-FE, untyped |

## 3. What does NOT map cleanly to unary gRPC — risk list

### 3.1 Bidirectional WebSockets (5 endpoints) — hard constraint

gRPC-Web supports unary + server-streaming only; these sockets are
server-push channels that could become server-streaming RPCs in principle,
but they are keyed to bespoke subprotocol token auth and bespoke event
payloads, and `/api/updates/socket` is fired by middleware on every REST
mutation — meaning **REST and gRPC traffic must share the broadcast hubs**
during rollout regardless. Cheapest correct answer: keep the WS endpoints on
axum permanently (they are not REST↔gRPC candidates at all); evaluate a
server-streaming `Watch*` RPC only if the sockets ever need replacing.

| Path | Purpose | FE client |
|---|---|---|
| `GET /api/updates/socket` | global data-change events | `src/hooks/useDataChangeSocket.ts` |
| `GET /api/admin/loyalty/socket` | staff loyalty push | `src/features/loyalty/hooks/useLoyaltySocket.ts` |
| `GET /api/guest-portal/me/loyalty/socket` | guest loyalty push | `src/features/guestPortal/hooks/useGuestLoyaltySocket.ts` |
| `GET /api/guest-portal/me/support/socket` | guest support chat | `src/features/guestPortal/hooks/useSupportSocket.ts` |
| `GET /api/guest-portal/me/availability` | booking availability push | `src/features/guestPortal/booking/useAvailabilitySocket.ts` |

### 3.2 Multipart / file uploads (7 endpoints)

Client/bidi streaming is unavailable in gRPC-Web. Options per endpoint:
single-message `bytes` field (fine for receipts ~MBs, wrong for backup files),
or keep upload on REST and migrate the surrounding RPCs. `data-transfer`
import uploads can be large — recommend **keep REST** there.

- `POST /api/ekyc/upload-document` (+ portal variant `/api/guest-portal/me/ekyc/documents`)
- `POST /api/room-types/{id}/images` (per-route `DefaultBodyLimit` override)
- `POST /api/guest-portal/me/payments/{payment_id}/receipt` (+ token variant `/api/guest-portal/booking/{token}/payments/{payment_id}/receipt` — the latter currently has no FE caller)
- `POST /api/booking/recover-payment/{token}/payments/{payment_id}/receipt`
- `POST /api/data-transfer/import/uploads`

### 3.3 Binary / streaming downloads & static files (~23 `FILE/RAW` + `ServeDir`)

CSV/JSON exports (`/api/audit-logs/export/*`, `/api/ekyc/admin/applications/export`,
`/api/data-transfer/export`), authenticated document fetches
(`/api/ekyc/**/documents/{kind}`, `/api/admin/payments/{id}/receipt`), and the
`/uploads/*` static dir. Server-streaming bytes is possible but buys nothing;
these stay REST (or become a `GetDownloadUrl` RPC returning a short-lived URL —
more infra, not recommended for Phase 2).

### 3.4 External callers — stay REST/JSON permanently

- `POST /api/webhooks/paypal` — PayPal platform webhook.
- `GET/POST /api/communications/unsubscribe/{token}` — email-link flow.
- `GET /api/booking/recover-payment/{token}` + bank-transfer/paypal/receipt
  siblings — capability-URL recovery flow reached from email links.
- `POST /api/guest-portal/verify`, `GET /api/guest-portal/booking/{token}` and
  the whole `{token}`-in-path guest-portal family — magic-link surface. The FE
  currently uses the header variants for payments; **the token-in-path
  variants are an alternate form of the same operations** (see §3.12) — pick
  ONE form for proto (recommend header/session metadata, not resource names
  containing secrets).
- Booking-channel/OTA surface: `booking_channels` is admin config only today
  (no inbound OTA webhook exists yet) — nothing to preserve, but any future
  channel-manager callback lands on REST by definition.

### 3.5 Cookie-based token refresh

`POST /api/auth/refresh` mints access tokens from an HttpOnly cookie. gRPC-Web
requests carry metadata, not cookie semantics the interceptor can own — keep
`refresh`, `login`, `logout`, `register`, passkey, and 2FA challenge endpoints
on REST (they are session bootstrap, not domain RPCs). Recommendation: exclude
`auth`, `passkey`, `two_factor`, `guest_portal/session` from the proto
contract entirely.

### 3.6 Per-route policies that need interceptor equivalents

- `RateLimiters` buckets keyed by IP per route (login, sensitive, guest-portal,
  eKYC…) — gRPC needs a per-method rate-limit interceptor reading the same
  client-IP logic (`extract_client_ip`, trusted-proxy aware).
- Turnstile header on `/auth/login`+`/auth/register`, step-up +
  backup-passphrase headers on `/api/data-transfer/*`, `X-Client-Timezone` —
  these become request metadata fields; CORS allowlist already names them.
- `publish_data_changes` (all `/api` mutations) and `publish_inventory_changes`
  (rooms/housekeeping mutations) fire the WS hubs — **the gRPC path must
  invoke the same publishes**, inside the shared service layer rather than a
  duplicated middleware.

### 3.7 Session binding (`claims.sid`)

`enforce_active_session` rejects JWTs whose session row is gone (logout,
revocation). The tonic interceptor must do: parse `authorization` metadata →
verify JWT → load `sid` → `is_session_active` → then permission check. Skipping
the sid check silently re-enables revoked sessions — flag it as an acceptance
criterion.

### 3.8 Error contract

Today: `ApiError` → `{"error","message",...,"request_id"}` + correct HTTP
status, plus `normalize_error_response` for non-ApiError rejections and panic
catching. Phase 2 needs one internal error enum rendered twice. Special
variants (`ProfileIncomplete`, `AutoCheckinBlocked.block_code`,
`GuestNameTaken`, `TwoFactorEnrollmentRequired`) carry machine-readable codes
the FE switches on — these belong in `google.rpc.ErrorInfo`/`BadRequest`
details, not free-text `Status::message`.

### 3.9 Money and numeric types

DB stores **major-units** `numeric(12,2)` (dominant), `numeric(10,2)`, and
`numeric(10,4)` (4-dp values — e.g. rate factors — that **cannot** be minor
units). REST today serializes `Decimal` as a JSON float. For proto:
`int64` minor units + ISO-4217 code is right for 2-dp money, but the contract
needs a second type (e.g. `Decimal` string or `int64` with declared scale) for
the 4-dp columns — flag for proto review. Currency code: check
`system_settings`/booking currency columns before fixing the field.

### 3.10 Pagination

Offset pagination (`page`,`per_page` → `{data,total,page,page_size}`). AIP
`page_token` can wrap the integer opaquely — fine — but `total` must stay in
list responses or every table UI regresses.

### 3.11 Untyped responses

98 endpoints return `serde_json::Value` (`any` in the table). Their real
shapes are only knowable by reading handler bodies or sampling responses —
budget for that in Phase 1; each is a small proto-design task, not a
mechanical translation. Concentrated in bookings (13), payments (9),
profile (8), users (6), guests (6).

### 3.12 Endpoints with no FE caller (~64 `NO-FE`)

Three buckets: (a) external/token-link surface that is *supposed* to have no
SPA caller (PayPal webhook, unsubscribe, recover-payment links — WS upgrade
GETs are matched via `new WebSocket` literals and excluded here);
(b) duplicate/alternate forms — `/api/auth/2fa/{setup,enable,disable,verify}`
(FE uses `profile/2fa/*` + `auth/2fa/status|regenerate-backup-codes`),
`/api/guest-portal/booking/{token}/payments/*` (FE uses the header variants);
(c) genuinely unused-looking admin/user endpoints (`users/directory`,
`users/invite`, `reactivate`, `unlock`, `resend-invite`, user session admin,
`loyalty/me` + `enroll` + `redeem`, `teams` member routes, several
`promotions` lifecycle actions, `night-audit/preview`, `search`,
`system/process-checkins`, `ekyc/self-checkin`…). Verify each before writing
proto for it — several look like real dead surface, not missing literals.

### 3.13 Structural quirks the contract must not copy

- Same path + multiple verbs routed separately (`/api/bookings/{id}` PATCH and
  PUT both → `update_booking`; `/api/bookings/{id}/complimentary` POST/PATCH/DELETE
  on one path).
- Cross-cutting paths owned by other modules: `/api/rate-codes`,
  `/api/market-codes`, `/api/complimentary/*`, `/api/guests/*/credits` (bookings
  module), `/api/bookings/{id}/posted` (night_audit module), `/api/guests/{id}/*`
  (guest_relations module).
- Route-order dependencies documented in code ("static routes before
  parameterized") — gRPC method names eliminate this class entirely.
- `GET /api/rooms/{room_type}/reviews` — path param is a *room type name
  string*, not an id.
- `PUT /api/rooms/{id}/status` accepts a transition object whose required
  permission is *computed from the transition* (`normalize_transition_permission`)
  — a proto enum on the request preserves this.
- `GET /api/search`, `/api/reports/generate`, `/api/ekyc/self-checkin`,
  `/api/system/process-checkins` — misc/ops surface; decide inclusion per case.

### 3.14 Realtime side-effects on mutation

Any REST→gRPC switch must re-fire `publish_data_changes` /
`publish_inventory_changes` for the same mutations or staff screens go stale.
Put the publish inside the shared service layer in Phase 2 (single place both
adapters call), not in a gRPC-only interceptor.

### 3.15 Audit writes

`services/audit.rs` is invoked from mutating handlers today. Keep it in the
service layer so gRPC mutations produce identical audit rows (actor id must
arrive via interceptor context, not a request field clients can spoof).

## 4. Suggested bounded-context mapping (input for Phase 1)

The brief's six packages do not cover this surface 1:1. Proposed mapping:

| Proto package | Modules absorbed |
|---|---|
| `hotel.iam.v1` (new — auth itself is out of scope per §3.5) | users, rbac, teams, profile (non-2FA parts) |
| `hotel.guests.v1` | guests, guest_relations, companies, segments |
| `hotel.rooms.v1` | rooms, housekeeping, maintenance |
| `hotel.reservations.v1` | bookings (+ its `complimentary`, `guests/*/credits`, `rate-codes`, `market-codes` strays), night_audit |
| `hotel.rates.v1` | rates, promotions?, revenue (rate-calendar), booking_channels (config) |
| `hotel.billing.v1` | payments, ledgers, invoices (payments module), payment_retry (admin parts) |
| `hotel.guestportal.v1` (new) | guest_portal, guest_booking, portal-side loyalty/support/promotions views |
| `hotel.ops.v1` (new) | analytics, insights, revenue, audit, search, system, settings, communications, data_transfer (non-upload parts), ekyc (admin review) |
| stays REST | auth/session/passkey/2FA, webhooks, WS sockets, uploads, file downloads, `/uploads`, `/health`, magic-link token endpoints (or reduce to one canonical form) |

## 5. Criticality ranking (for strangler ordering)

- **Never-first / highest risk**: payments, ledgers, bookings mutations,
  night_audit, ekyc — financial, legal, or audit-critical; heavy `any` shapes.
- **Good first candidates** (read-mostly, typed, low blast radius):
  `rooms` read endpoints (`GET /api/rooms`, `/api/room-types*`, occupancy),
  `guests` read endpoints, `analytics`/`insights` read endpoints,
  `companies` — small CRUD, clean types, real FE callers.
- **Defer**: guest_portal token flows (auth-model redesign first),
  communications (worker-coupled), data_transfer (upload + step-up headers),
  anything in §3.12 until callers are confirmed.

## 6. Open questions for review

1. Scope: confirm which NO-FE endpoints are dead vs. called by other clients
   (desktop uses the same FE bundle, so "no FE caller" ≈ "no caller").
2. Auth endpoints: keep entire `auth`/`passkey`/`two_factor`/`guest_portal`
   session surface on REST? (recommended — §3.5)
3. WS sockets: permanently out of gRPC scope? (recommended — §3.1)
4. `numeric(10,4)` fields: second numeric proto type or widen to
   `google.type.Decimal`? (§3.9)
5. One canonical guest-portal auth form for proto: session bearer metadata
   (recommended) vs. token-in-path.
6. `page_token`: wrap page number, or move hot lists (bookings) to keyset
   pagination? Keyset changes behavior — needs its own decision.

---

*Phase 0 complete — stopping here per the brief. Awaiting review before
Phase 1 (proto contract).*
