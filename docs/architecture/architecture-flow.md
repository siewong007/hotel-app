# Architecture Flow

Decisions and rationale live in [ADRS.md](ADRS.md); deployment steps live in
[the deployment guide](../guides/deployment.md).

## Web request flow

```text
Browser (React / MUI / TanStack Router and Query)
  └─ src/api/client.ts (ky, bearer token, auth events)
      └─ Vite proxy in development or Caddy in production
          └─ Axum routes, CORS, rate limits, and security headers
              └─ authentication and permission checks
                  └─ handlers
                      └─ services
                          └─ repositories
                              └─ PostgreSQL
```

## Desktop flow

```text
Tauri webview
  └─ Tauri IPC and backend-ready event
      └─ backend sidecar on a dynamically selected localhost port
          └─ bundled PostgreSQL runtime and resources
```

Desktop mode sets `HOTEL_DESKTOP_MODE`. The webview obtains the selected backend
port through Tauri IPC. The sidecar receives an explicit `ALLOWED_ORIGINS` list.

## PostgreSQL V1 lifecycle

A new empty database is initialized exactly once, then converged by an ordered
patch catalog:

```text
database/postgres/migrations/0001_v1_baseline.sql
  → database/postgres/seed.sql
      → database/postgres/patches/ (manifest.tsv, in version order)
```

Docker, server, and desktop deployments share this sequence. Legacy databases
must be exported and rebuilt rather than upgraded in place.

An additive change lands in **two** places every time: the baseline (fresh
installs) and a new catalog patch (databases already on V1). Only files listed
in `patches/manifest.tsv` are ever executed, only in manifest order, and only
through a catalog executor that verifies each file's recorded `sha256:`
checksum first. Published versions and checksums are immutable — a patch that
needs to change gets a new version, never an edit.

Each patch runs as `_begin.sql` + the patch + `_end.sql` in one transaction: an
advisory lock serializes concurrent runners, a guard aborts unless the recorded
V1 baseline checksum is the supported one, an already-recorded revision is
skipped via `\if`, and the DDL commits together with its `hotel_schema_revisions`
row. There is no partially applied patch, and a rerun is a no-op.

| Context | Application point |
|---|---|
| Server / local | `make db-patch` (also the last step of `make db-setup`) |
| Production deploy | `deploy/deploy.sh` — after the verified backup, after PostgreSQL alone is up, before the application containers are activated |
| Desktop | the Tauri launcher (`src-tauri/src/postgres/patches.rs`), after it recognizes a fresh or V1 database and before it starts the backend sidecar |
| Backend startup | never — it validates the schema and refuses layouts it does not recognize |

`make db-schema-drift` compares a target database against a scratch
current-baseline database read-only (`report-schema-drift.sh` +
`schema-inventory.sql`); exit 2 means the schemas differ.

Full lifecycle reference, including failure recovery:
[database README](../../hotel-app-be/database/README.md).

## Payments and PayPal webhooks

Two capture paths converge on one policy: the synchronous capture
(`services/payments.rs::capture_paypal_payment`) and the inbound webhook
(`/webhooks/paypal` → `routes/webhooks.rs` → `handlers/webhooks.rs`). Both
verify the captured amount against the stored payment row — never the editable
booking total. On a mismatch after money has moved they write a
`paypal_capture_conflict` / `paypal_webhook_conflict` audit event and leave the
payment untouched for staff review; a payment is only marked failed when money
never moved. Webhook routes carry no bearer auth by design — each delivery is
cryptographically verified and IP rate-limited; unhandled event types are
audit-logged as `paypal_webhook_ignored` and acknowledged. Conflicts surface on
the admin Payment Approvals page (requires `payments:read` + `audit:read`).
Payments RBAC lives at the route layer: every wrapper in `routes/payments.rs`
calls `require_permission_helper` before its handler.

## Payment idempotency and deposit refunds

Staff-created booking and ledger payments require a client-generated
idempotency key. The write path locks the parent booking or ledger `FOR UPDATE`
before reading its balance, persists the key plus a canonical SHA-256
`idempotency_fingerprint` of the material request fields, and is backed by
partial unique indexes on `(booking_id, idempotency_key)` and
`(ledger_id, idempotency_key)`. An exact replay returns the original payment;
the same key with different payment data is a conflict. Several legitimate
partial/installment payments per charge remain supported. A company payment
allocates across ledger entries in one transaction — all or nothing. Ledger
receipt uniqueness is scoped to `(ledger_id, lower(trim(receipt_number)))`, so
one real company receipt can be allocated across several entries.

Frontend callers hold an idempotency attempt until **every** step that can throw
has succeeded, so a failed post-payment refetch replays server-side instead of
minting a new key and charging twice.

`PaymentRepository::refund_deposit` bounds a keycard-deposit refund by the
deposit actually held: inside the refund transaction it locks the booking and
takes `bookings.deposit_amount` when `deposit_paid` is true and positive,
otherwise the sum of completed `deposit` payments — alternatives, never additive.
A missing or exceeded deposit is rejected; the one-refund-per-booking rule and
partial refunds are unchanged.

## Ledger reporting

`customer_ledgers` responses and the Company Ledger statement carry the linked
booking's `check_in_date` / `check_out_date`, resolved from
`customer_ledgers.booking_id`. The fields are nullable — a standalone ledger
entry with no booking renders `-` — and no ledger amount, total, filter, or
status logic depends on them.

## Hotel business day

The hotel timezone lives in `system_settings.timezone` and is applied to every
pooled connection (`core/db.rs`), so SQL `CURRENT_DATE` is the hotel business
day. Rust code must use `core/db.rs::hotel_today(executor)` for business-day
decisions (due dates, occupancy gating, report windows) — never
`chrono::Local`/`Utc` date math.

## Guest portal security

Pre-checkin tokens are 256-bit (`generate_session_token`) and invalidated on
submit; the portal has logout/revoke and `/guest_portal/me/*` is rate-limited.
Every portal mutation writes an audit event. Portal booking creation is
race-safe: `lock_room_type_tx` (`FOR UPDATE`) plus `allocate_room_tx`
(`FOR UPDATE SKIP LOCKED`) guarantee a single winner for the last room.

## Communications (email)

`modules/communications/`: SMTP via lettre (delivery worker spawned in
`main.rs` when `SMTP_*` env vars are set), campaign scheduler, per-guest
notification preferences (`/guest-portal/me/notification-preferences`), and
booking-confirmation deliveries queued from the guest-booking and payment
paths.

## Realtime resilience

WebSocket hubs log lagged-drop counts; frontend sockets reconnect with capped
exponential backoff plus jitter; the HTTP client honors `Retry-After` on
413/429/503.

## Important wiring checks

- Merge every new backend router in `routes/mod.rs`.
- Add new top-level API prefixes to `hotel-web-fe/vite.config.ts`.
- Register new pages in both `src/routes/` and `src/navigation/routeRegistry.tsx`.
- Keep SQL parameterized and validate it against PostgreSQL.
