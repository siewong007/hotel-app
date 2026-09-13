# Dependencies

Architecturally significant dependencies and the reasoning behind them — not a
lockfile dump. Last reviewed during the 2026-09-13 modernization pass.

## Frontend (`hotel-web-fe`)

| Package | Purpose | Notes |
|---|---|---|
| react / react-dom 19 | UI | React Compiler enabled via `babel-plugin-react-compiler` |
| vite 8 | Build/dev server | `@vitejs/plugin-react` + `@rolldown/plugin-babel` |
| typescript 6 | Language | Full `strict` mode + `noImplicitOverride`, `noImplicitReturns`, `erasableSyntaxOnly` |
| @mui/material + @emotion/* | Component system | MUI 9; `@mui/lab` removed (unused) |
| @tanstack/react-router | Routing | File routes + generated `routeTree.gen.ts` |
| @tanstack/react-query | Server state | The only state library by design (ADR 006) |
| @tanstack/react-table 9 | Tables | Behind shared `DataTable`; v9 feature-gated API (`tableFeatures`) |
| ky | HTTP client | Wrapped by `src/api/client.ts` — never call `fetch` directly |
| date-fns | Dates | Business-day math belongs to the backend (`hotel_today`) |
| recharts | Charts | Dashboard/reports |
| jspdf + jspdf-autotable | PDF export | Receipts/reports |
| @paypal/react-paypal-js | PayPal buttons | Guest + staff payment surfaces |
| qrcode.react | QR rendering | 2FA enrollment, share links |
| web-vitals 6 | RUM metrics | `onINP` (FID removed in v6) |
| vitest 5 + jsdom 30 + @testing-library/* | Tests | Three independent gates: `typecheck`, `lint`, `test` |
| eslint 10 + typescript-eslint | Lint | `typescript-eslint` peer range `<6.1.0` is the TypeScript 7 blocker — see below |

### Why TypeScript 6, not 7

TypeScript 7 exists, but the installed `typescript-eslint` declares a peer range
of `<6.1.0` for TypeScript. Upgrading `typescript` ahead of the linter's
support would leave `eslint` parsing on an unsupported compiler. TS 6 + full
strictness is the correct stable point until `typescript-eslint` declares TS 7
support.

## Backend (`hotel-app-be`)

| Crate | Purpose | Notes |
|---|---|---|
| axum 0.8 + tower-http 0.7 | HTTP | `catch-panic`, `set-header`, CORS, tracing |
| sqlx 0.9 | PostgreSQL | Runtime queries only — no `query!` macros, so type/column mismatches need live-DB tests. v9 requires `AssertSqlSafe` on dynamic SQL — every wrapped site is template SQL (constants + `param!` bind placeholders), never user input |
| tokio 1 | Async runtime | |
| jsonwebtoken 11 | JWT | `rust_crypto` provider (HMAC only); exactly one provider required |
| bcrypt 0.19 | Password hashing | On `spawn_blocking` |
| totp-rs 6 | TOTP 2FA | `Totp`/`Builder` API; `check*` returns `Option<step>` (v6) |
| ring | AES-256-GCM | TOTP secret encryption at rest |
| reqwest 0.13 | Outbound HTTP (PayPal, Turnstile) | `rustls` = platform cert verifier (image ships `ca-certificates`); `form` feature for Turnstile siteverify |
| lettre 0.11 | SMTP | `tokio1-rustls-tls` — no OpenSSL anywhere |
| rust_decimal | Money | Never floats |
| validator 0.21 | Request validation | Derives on request models |
| ammonia | HTML sanitization | Campaign/email HTML |
| sha2 + hmac + constant_time_eq + data-encoding + hex + base64 | Crypto/encoding | Webhook signatures, fingerprints, tokens |
| uuid, chrono, rand 0.10 | Primitives | `v7` UUIDs where ordering matters |
| simplelog + log | Logging | |
| dirs 7 | Data dirs | |
| qrcode + image | TOTP QR images | |
| clap 4 | Helper binaries | `hash_password`, `fix_password` |

Deliberately absent: an ORM (repositories hold explicit SQL), a rate-limit
store (in-memory by design, ADR 005), webauthn-rs (commented out — OpenSSL
conflict on Windows builds), `lazy_static` (replaced by `std::sync::LazyLock`).

## Desktop (`hotel-desktop/src-tauri`)

| Crate | Purpose | Notes |
|---|---|---|
| tauri 2 + shell/updater/process plugins | Desktop shell | Updater shares the reqwest instance via feature unification |
| reqwest 0.13 | Outbound HTTP | Same `rustls` feature set as backend; `charset`/`http2`/`system-proxy` kept for the updater |
| tokio, serde/serde_json, thiserror 2, log/env_logger | Plumbing | |
| rand 0.10, sha2 0.11, hex, bcrypt | Local crypto | Patch checksums, bootstrap credentials |
| dirs 7 | Platform data dirs | Embedded PostgreSQL location |

## 2026-09-13 modernization changes

**Removed:** `@mui/lab` (unused), `react-to-print` (unused), `lazy_static`
(stdlib `LazyLock`), `@types/babel__core` (Babel 8 ships types).

**Upgraded:** TanStack Table 8→9 (feature-gated API migration in `DataTable`),
web-vitals 4→6 (`onFID`→`onINP`), vitest 4→5 + coverage + jsdom 29→30,
`@babel/core` 7→8; backend `jsonwebtoken` 10→11, `reqwest` 0.12→0.13,
`totp-rs` 5→6, `constant_time_eq` 0.5→0.6, `dirs` 5→7; desktop `reqwest`
0.12→0.13, `thiserror` 1→2, `rand` 0.8→0.10, `sha2` 0.10→0.11, `dirs` 5→7,
edition 2021→2024.

**TLS trust store:** reqwest 0.13 replaced `rustls-tls` (bundled webpki roots)
with `rustls` (rustls + aws-lc + platform verifier). The deploy image installs
`ca-certificates`, and platform verification additionally honors enterprise
TLS-inspection CAs — important for hotel networks.

**sqlx 0.8→0.9:** the `SqlSafeStr` bound forced `AssertSqlSafe` wrappers at
~175 dynamic-SQL call sites (all template-built SQL: constant fragments +
`param!` placeholders — user input only ever travels via `.bind()`). Feature
split: `runtime-tokio-rustls` → `runtime-tokio` + `tls-rustls-ring-webpki`
(same ring+webpki DB TLS stack). Full suite green on live PostgreSQL.
