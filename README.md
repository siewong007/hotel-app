# Hotel Management System

A full-stack hotel property management system (PMS) built with Rust, React, and Tauri. Supports web and desktop deployments with PostgreSQL or SQLite databases.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, SQLx |
| Frontend | React 19, TypeScript 5.7, Vite 8, MUI v6 |
| Desktop | Tauri 2 (Windows, macOS, Linux) |
| Database | PostgreSQL (default), SQLite (optional) |
| Auth | JWT + TOTP 2FA + WebAuthn/Passkeys |

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

## Getting Started

### Prerequisites

- Rust (2021 edition)
- Node.js 18+
- PostgreSQL 14+ (or use SQLite feature)

### Backend Setup

```bash
cd hotel-app-be

# Copy and configure environment
cp .env.example .env
# Edit .env with your database credentials and JWT secret

# Run database migrations
sqlx migrate run

# Start the server
cargo run
```

The API starts at `http://localhost:3030`.

### Frontend Setup

```bash
cd hotel-web-fe

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend starts at `http://localhost:5173` with API proxy to the backend.

### Desktop App

```bash
cd hotel-desktop

# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `JWT_SECRET` | JWT signing key (min 32 chars) | Required |
| `BACKEND_PORT` | API server port | `3030` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000,http://localhost:5173` |
| `RUST_LOG` | Log level | `info` |
| `VITE_API_URL` | Frontend API URL (production) | `http://localhost:3030` |

### SQLite Mode

To use SQLite instead of PostgreSQL:

```bash
cd hotel-app-be
cargo run --features sqlite --no-default-features
```

## API Overview

| Endpoint Group | Description |
|---------------|-------------|
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

## License

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
