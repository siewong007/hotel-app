# Room-type photos: admin-managed, shown on landing page + booking portal

Date: 2026-09-13
Status: approved (design reviewed in session)

## Goal

Let staff attach photos to room types from the admin panel (Room Configuration →
room-type drawer). Photos appear in the guest booking portal offer cards and on the
public landing page gallery. Four real room photos ship bundled as landing-page
defaults until admin-uploaded photos replace them.

## Current state

- `room_types.images` (jsonb) already exists and already flows through the public
  guest-booking offers API (`GET /api/booking/offers` → `GuestBookingOffer.images`);
  `PortalBookingPage` renders `images[0]` with a fallback icon.
- The admin `RoomType` model (backend `models/room.rs`, frontend `room.types.ts`)
  omits `images`, so nothing can write it.
- `/uploads/*` is served statically from `uploads/public/` (routes/mod.rs); deploy
  scripts already create the dir. `uploads/` is git-ignored — runtime data only.
- Existing upload patterns write to `private_uploads/` (payment receipts, eKYC) and
  stream multipart fields in chunks with a byte cap; receipts sniff magic bytes
  (`receipt_extension` in services/payments.rs).
- Landing page is static `hotel-web-fe/salim-inn/index.html` (a Vite build input;
  static assets live under `public/salim-inn/`). Its `.photo-grid` gallery has 6
  cards — 3 room photos hotlinked from saliminn.com/bstatic.com + bathroom, Farley
  exterior, frontage.

## Decisions (confirmed with user)

- Landing gallery is **dynamic**: room-type photos come from the API, with bundled
  photos as fallback when the API is empty or unreachable.
- Gallery = room-type photo cards + keep the 3 non-room static cards.
- Photo→type mapping (bundled defaults): photo 1 → Family Room, photo 2 → Superior
  Twin, photo 3 → Deluxe King, photo 4 → Family Suite. Standard Queen starts with
  no photo.
- Landing cards bind to room types by `data-room-name` (case-insensitive match on
  `type.name`) with optional `data-room-code` override; unmatched → bundled photo
  stays. Fails safe on rename/mismatch.

## Design

### Backend

1. `models/room.rs`: `RoomType` gains `images: Vec<String>`;
   `RoomTypeUpdateInput` gains `images: Option<Vec<String>>`.
2. `repositories/rooms_queries.rs`: add `images` to `ROOM_TYPE_COLUMNS`;
   `row_to_room_type` decodes jsonb → `Vec<String>` (default `[]`);
   `RoomTypeUpdate` gains `images`; UPDATE gains `images = COALESCE($16, images)`
   bound as `Option<serde_json::Value>`.
3. `services/rooms.rs::update_room_type_handler`: fetch existing type before the
   update; afterwards best-effort delete removed files — only paths matching
   `/uploads/room-types/<file>` (never trust arbitrary strings as fs paths).
4. New route `POST /api/room-types/{id}/images` (routes/rooms.rs), permission
   `rooms:update`:
   - streams the `file` multipart field in chunks, cap 10 MB (same approach as
     `receipt_upload_bytes` — `field.bytes()` would buffer unboundedly);
   - sniffs magic bytes: JPEG / PNG / WebP only;
   - writes `uploads/public/room-types/<uuid>.<ext>`; stores the public URL path
     `/uploads/room-types/<uuid>.<ext>` in `room_types.images` (append);
   - audit `room_type_image_added`; returns the updated `RoomType`.
5. New public route `GET /api/booking/room-types` (modules/guest_booking, beside
   the other public `/booking/*` routes): returns active room types as
   `{id, name, code, description, images, sort_order}` ordered by `sort_order`,
   no auth, no date/availability requirements.
6. Regenerate `docs/api/openapi.json`
   (`HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`).

### Frontend admin

- `types/room.types.ts`: `images?: string[]` on `RoomType` + `RoomTypeUpdateInput`.
- `api/rooms.service.ts`: `uploadRoomTypeImage(id, file)` →
  `api.post(\`room-types/${id}/images\`, { body: FormData })` (same multipart style
  as ekyc.service.ts).
- `RoomConfigurationPage` drawer: "Photos" section — thumbnail grid + upload
  button + per-photo remove. Upload/remove apply immediately (POST, then PATCH
  `{images}`), with the page's existing `emitApiNotification` toasts. First array
  entry is the cover image everywhere. For a not-yet-saved room type the section
  is disabled with a "save first" hint.

### Landing page

- Add the four photos to `hotel-web-fe/public/salim-inn/rooms/`:
  `family-room.jpg`, `superior-twin.jpg`, `deluxe-king.jpg`, `family-suite.jpg`
  (served at `/salim-inn/rooms/...`; copied into `dist` and the Tauri bundle).
- `index.html` gallery: replace the 3 hotlinked room cards with 4 cards keyed by
  `data-room-name` (+ `data-room-code` escape hatch), bundled photo as default
  `src`; keep bathroom / Farley / frontage cards unchanged (7 cards total; grid
  wraps to a third row).
- New `salim-inn/room-photos.js` module (external file — desktop CSP allows no
  inline scripts):
  - resolve API base: `__TAURI_INTERNALS__.invoke('get_status')` → `backend_url`
    on desktop; same-origin on web;
  - `GET /api/booking/room-types`; for each card, if the bound type has images,
    swap `src`/alt/caption; append a cloned card for types with photos but no
    bound slot (e.g. Standard Queen after an upload);
  - any failure → bundled defaults stay.
- `tauri.conf.json` CSP: add `http://127.0.0.1:* http://localhost:*` to `img-src`
  (connect-src already allows them) so uploaded `/uploads/...` photos render in
  the desktop webview — also fixes guest-portal offer images there.
- `PortalBookingPage::offerImage`: run the path through `apiUrl()` so `/uploads/…`
  resolves to the backend URL under Tauri.

### Error handling / safety

- Upload rejects: >10 MB, non-image bytes, missing field — `BadRequest` with the
  same wording style as receipt upload.
- File removal on image delete is best-effort and path-guarded; a failed unlink
  never fails the PATCH.
- Landing page never hard-fails: no API → bundled photos.

### Tests

- Backend unit tests: image magic-byte sniffing; removal path-guard; upload field
  extraction (mirror receipt tests).
- Backend integration (DATABASE_URL-gated, follows existing pattern): upload →
  images contains `/uploads/room-types/…`; PATCH removes entry; public endpoint
  returns active types only.
- Frontend vitest: `uploadRoomTypeImage` request shape (mirror
  `guestPortal.service.test.ts`).

## Out of scope

- Landing price cards (RM75–110) stay static.
- Photo reordering UI — delete + re-upload; first entry is always the cover.
- Seeding `room_types.images` — bundled photos are the default; no schema or seed
  change (frozen V1 checksum untouched).
- Non-room gallery photos remain static.
