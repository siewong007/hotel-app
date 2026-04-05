<p align="center">
  <h1 align="center">Hotel Management System</h1>
  <p align="center">
    A full-stack hotel property management system built with Rust, React, and Tauri.
    <br />
    Web and desktop deployments with PostgreSQL or SQLite.
  </p>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/QUICK%20START-5%20MIN-blue?style=for-the-badge" alt="Quick Start"></a>
  <a href="#features"><img src="https://img.shields.io/badge/FEATURES-14+-green?style=for-the-badge" alt="Features"></a>
  <a href="#api-overview"><img src="https://img.shields.io/badge/API-15%20MODULES-orange?style=for-the-badge" alt="API"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-yellow?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-2024-orange?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/Axum-0.8-blue" alt="Axum">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/MUI-v7-007FFF?logo=mui&logoColor=white" alt="MUI">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/PostgreSQL-14+-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/SQLite-supported-003B57?logo=sqlite&logoColor=white" alt="SQLite">
</p>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Rust 1.94 (2024 edition), Axum 0.8, Tokio, SQLx 0.8 |
| **Frontend** | React 19, TypeScript 5.8, Vite 8, MUI v7 |
| **Desktop** | Tauri 2 (Windows, macOS, Linux) |
| **Database** | PostgreSQL (default), SQLite (optional) |
| **Auth** | JWT + TOTP 2FA + WebAuthn/Passkeys |
| **Security** | Rate limiting, account lockout, input sanitization, CSP |

## Features

- **Reservations & Front Desk** - Booking management, check-in/check-out, room changes, hourly and nightly rates
- **Room Management** - Room types, status tracking, maintenance scheduling, occupancy dashboard
- **Guest Management** - Guest profiles, history, complimentary stays, guest credits
- **Payments & Invoicing** - Payment processing, invoice generation, PDF export, refunds
- **City Ledger** - Company billing, receipt management, payment tracking, void/reversal
- **Night Audit** - End-of-day reconciliation, revenue posting, journal entries
- **Loyalty Program** - Points system, tier levels, rewards redemption
- **eKYC Verification** - Identity verification with document upload and face matching
- **Reports & Analytics** - Occupancy reports, revenue analytics, benchmark comparisons
- **Guest Portal** - Self-service pre-check-in for guests
- **RBAC** - Role-based access control with granular permissions
- **Rate Management** - Rate codes, market codes, daily rate overrides
- **Data Import/Export** - Bulk data transfer between databases
- **Security** - Rate limiting, account lockout, input sanitization, CSP headers

## Project Structure

```
hotel-app/
├── hotel-app-be/          # Rust backend API
│   ├── src/
│   │   ├── core/          # Auth, DB, middleware, rate limiter
│   │   ├── handlers/      # Route handlers
│   │   ├── models/        # Data models
│   │   ├── routes/        # API route definitions
│   │   ├── services/      # Business logic (audit, etc.)
│   │   └── utils/         # Sanitization, helpers
│   └── database/
│       ├── migrations/    # PostgreSQL migrations
│       ├── sqlite_migrations/
│       └── seed-data/     # Initial data (roles, rooms, etc.)
├── hotel-web-fe/          # React web frontend
│   └── src/
│       ├── api/           # API service layer
│       ├── auth/          # Auth context & providers
│       ├── features/      # Feature modules (bookings, rooms, guests, etc.)
│       ├── hooks/         # Custom React hooks
│       ├── types/         # TypeScript type definitions
│       └── utils/         # Utilities (storage, validation, retry)
└── hotel-desktop/         # Tauri desktop wrapper
    └── src-tauri/         # Tauri config, embedded DB & binaries
```

## Quick Start

### Prerequisites

- **Rust** 1.94+ (2024 edition) with `cargo`
- **Node.js** 18+ with `npm`
- **PostgreSQL** 14+ (or use SQLite for local development)

### Backend

```bash
cd hotel-app-be
cp .env.example .env       # Configure database credentials & JWT secret
sqlx migrate run           # Run database migrations
cargo run                  # Starts at http://localhost:3030
```

### Frontend

```bash
cd hotel-web-fe
npm install
npm run dev                # Starts at http://localhost:5173
```

### Desktop App

```bash
cd hotel-desktop
npm install
npm run tauri dev          # Development mode
npm run tauri build        # Production build
```

### SQLite Mode

```bash
cd hotel-app-be
cargo run --features sqlite --no-default-features
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | **Required** |
| `JWT_SECRET` | JWT signing key (min 32 chars) | **Required** |
| `BACKEND_PORT` | API server port | `3030` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000,http://localhost:5173` |
| `RUST_LOG` | Log level | `info` |
| `VITE_API_URL` | Frontend API URL (production) | `http://localhost:3030` |

See [`.env.example`](hotel-app-be/.env.example) for the full configuration reference.

## API Overview

| Endpoint | Description |
|----------|-------------|
| `/auth/*` | Login, register, 2FA, passkeys, token refresh |
| `/bookings/*` | CRUD, check-in/out, complimentary, credits |
| `/rooms/*` | Rooms, room types, occupancy, availability |
| `/guests/*` | Guest profiles, history, credits |
| `/payments/*` | Payment processing, invoices |
| `/ledgers/*` | City ledger, payments, transaction codes |
| `/loyalty/*` | Programs, memberships, rewards |
| `/ekyc/*` | Identity verification |
| `/reports/*` | Report generation, PDF export |
| `/settings/*` | System configuration |
| `/admin/*` | Users, roles, permissions |
| `/analytics/*` | Occupancy, revenue, benchmarks |
| `/night-audit/*` | End-of-day operations |
| `/profile/*` | User profile, password, 2FA, passkeys |
| `/guest-portal/*` | Guest self-service |

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the [MIT License](LICENSE).
