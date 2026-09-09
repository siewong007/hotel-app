# Anonymous booking nickname

**Status:** Draft, awaiting review  
**Date:** 2026-09-09  
**Product:** hotel-app (guest portal public booking + desk check-in)

## Problem

Anonymous website bookings create a new `guests` row. `guests.full_name` is unique (`idx_guests_full_name_unique`). When the typed name is taken, insert retries under a SAVEPOINT and stores `Name (2)`, `Name (3)`, and so on. That mutates the guest-facing name and is a poor identifier.

Anonymous booking also asks for first and last name. Legal identity is only needed at the desk.

## Goals

- Anonymous bookers enter a **nickname**, not a legal first and last name.
- That nickname is the unique guest identifier and is never rewritten to `Name (2)`.
- If the nickname is taken, the booker is asked to choose another; the booking is not created.
- Staff collect legal first and last name at check-in. That must not change the nickname.
- Rename `guests.full_name` to `guests.nick_name` (column, unique index, guest JSON). Walk-in and member unique names live in `nick_name` too.

## Non-goals

- Live public “is this nickname free?” lookup while typing.
- Merging an anonymous profile into an existing guest when the legal name already exists.
- Changing pre-check-in or auto-check-in beyond what falls out of the column rename.
- Changing signed-in account booking (still uses the account profile).
- Adding a separate `nickname` column in addition to the renamed unique-name column.
- Dropping uniqueness on the identifier.
- Renaming `users.full_name` (staff/account display names) or eKYC document `full_name`.
- Renaming report/DTO fields already called `guest_name` (those queries change their SQL source only).

## Identity

`guests.nick_name` is the unique, case-insensitive trimmed identifier for every guest (anonymous, walk-in, and member). Staff create and registration still set it from first + last, as `full_name` is set today.

Anonymous booking:

- Form field: Nickname (required). Email and guest type stay required; phone stays optional.
- Wire field stays `guest.first_name` (no new JSON field). `guest.last_name` is not sent.
- Server writes the sanitized nickname to `nick_name` and `first_name`. `last_name` is NULL.
- Nickname length follows `first_name` (max 100 after sanitize). Empty after sanitize is rejected.

After check-in of an anonymous guest:

- `nick_name` is still the booking nickname (unique id).
- `first_name` / `last_name` hold the legal name.
- Meaning of `nick_name` therefore differs by guest kind: legal “Jane Tan” for desk-created guests, booking nickname for anonymous guests. That is accepted. Uniqueness is global: an anonymous nickname “Jane Tan” conflicts with a walk-in already stored as `nick_name = Jane Tan`.

## Schema

Rename on `public.guests`:

- Column `full_name` → `nick_name` (same type, NOT NULL).
- `idx_guests_full_name` → `idx_guests_nick_name` (btree on `nick_name`).
- `idx_guests_full_name_trgm` → `idx_guests_nick_name_trgm` (gin trigram on `nick_name`, `deleted_at IS NULL`).
- `idx_guests_full_name_unique` → `idx_guests_nick_name_unique` (`lower(trim(nick_name))` where `deleted_at IS NULL`).

Views and functions that select `g.full_name` (including `booking_summary.guest_name`) read `g.nick_name`.

This is a compatible rename (data preserved), not a generation rebuild:

1. V1 baseline (`0001_v1_baseline.sql`) uses `nick_name` and the renamed indexes so fresh installs match.
2. Idempotent catalog patch `0011_guest_nick_name.sql` (next after `0010_consent_records.sql`) renames the column and indexes on live V1 databases. Guard each step so re-run is a no-op. Record it in `patches/manifest.tsv`.
3. Desktop PostgreSQL copies are produced from the backend source via the existing sync scripts. Do not hand-edit desktop schema.
4. Deploy install lists that enumerate patch files (`deploy/deploy.sh`, `deploy/deploy-staging.sh`) include the new patch.

Helpers such as `full_name_conflict_id` and `is_guest_name_unique_violation` follow the column/index names.

## Anonymous booking flow

`POST /booking/reservations` is unchanged in path and auth (public, IP rate-limited). Behaviour changes:

1. Validate nickname via the existing `first_name` field. Do not accept or persist `last_name`.
2. Remove `disambiguated_full_name` and the 1..=50 suffix retry loop.
3. Insert `nick_name` / `first_name` as the nickname. Keep a SAVEPOINT around the insert so a unique violation does not abort the rest of the booking transaction.
4. On unique violation (pre-check or race): roll back the SAVEPOINT, return **409** with body `{ "error": "<message>", "code": "guest_name_taken" }`. No guest row, no booking, no suffix. Message asks the guest to choose another nickname. Do not return the conflicting guest id.
5. Price-change 409 stays a distinct message without that code so the client can still re-quote.

Frontend (`PortalBookingPage` anonymous review):

- One Nickname field instead of First name / Last name.
- Confirm stays enabled; uniqueness is enforced on submit, not while typing.
- On `code === "guest_name_taken"`: stay on Review, highlight Nickname, do **not** re-quote or return to search.
- Other create failures keep the current re-quote / availability-lost behaviour.
- English and Malay copy for the field, hint, validation, and taken-name error.

## Check-in

Desk check-in (`EnhancedCheckInModal`) collects legal identity. It does not write `nick_name`. `apply_guest_update_tx` already omits the unique-name column; keep that.

When `last_name` is empty (anonymous nickname profile):

- Show a read-only hint `Booked as: {nick_name}`.
- Do not split `nick_name` into the first-name box.
- First name and last name are empty, editable, and both required to complete check-in.

When `last_name` is already set (walk-in / member):

- Prefill first and last from those columns (not by splitting `nick_name`).
- Fields stay editable.

IC/passport stays required. Duplicate legal names are not a unique-index concern (uniqueness is on `nick_name`). No merge workflow.

## Display

| Surface | What to show |
|---|---|
| Anonymous booking, pay link, booking board, `booking_summary.guest_name`, global search hit on the identifier | `nick_name` |
| Search | Match `nick_name` and `first_name` / `last_name` |
| Folios, invoices, confirmation-style mail once `last_name` is set | `trim(first_name + ' ' + last_name)` |
| Same documents before legal name exists | `nick_name` |

Do not leave `Name (2)` generation in any insert path.

## Error handling

| Case | Result |
|---|---|
| Empty / too-long nickname | 400, stay on form (client + server) |
| Nickname taken | 409 `guest_name_taken`, stay on Review, highlight Nickname |
| Price changed | 409 without that code, re-quote (existing) |
| Unique violation during insert after the pre-check | Same 409 `guest_name_taken` (SAVEPOINT), never suffix |
| Check-in missing first or last name on a nickname-only profile | Client validation; do not check in |

Structured `code` follows the `profile_incomplete` pattern: add `ApiError::GuestNameTaken` that serializes as 409 `{ "error": "...", "code": "guest_name_taken" }` so the client does not match on English message text.

## Testing

Backend:

- Replace `postgres_anonymous_guest_insert_retries_when_the_name_is_taken`: taken nickname fails; stored value is never `Name (2)`.
- Delete `disambiguated_full_name` unit tests with the helper.
- Validation: nickname → `nick_name` and `first_name`, `last_name` empty.
- Create path returns 409 with `code: "guest_name_taken"`.
- Check-in / `apply_guest_update_tx` updates first and last and leaves `nick_name` unchanged.
- Baseline + patch: column and unique index names; patch is idempotent.

Frontend:

- Anonymous review shows Nickname, not first/last.
- Create payload uses `guest.first_name` as the nickname and omits `last_name`.
- 409 `guest_name_taken` stays on Review, highlights Nickname, does not re-quote.
- Check-in: empty last name → “Booked as: …”, empty required first/last, fields editable.

## Implementation notes

Likely touch (not exhaustive): `hotel-app-be` guest_booking module (repository, validation, service, models), `repositories/guest.rs`, `repositories/auth.rs` unique-violation helper, guest JSON models, SQL that selects `g.full_name`, `booking_summary`, schema baseline + patch + manifest + deploy copy lists, `hotel-web-fe` `PortalBookingPage` (+ anonymous tests), `guest.types.ts` and every `guest.full_name` consumer, `EnhancedCheckInModal`, i18n `guestPortal` en/ms, desktop schema sync.

OpenAPI (`docs/api/openapi.json`) is updated if guest `full_name` is generated from code; otherwise leave it to the existing doc pipeline.
