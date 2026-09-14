# Room-Type Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff manage room-type photos in the admin panel; those photos render on the landing-page gallery and guest booking portal, with four bundled photos as landing-page defaults.

**Architecture:** `room_types.images` (jsonb `Vec<String>`) already exists and flows to the public booking offers. Add `images` to the admin RoomType read/write path, a `POST /api/room-types/{id}/images` multipart upload writing to `uploads/public/room-types/` (served at `/uploads/...`), and a public `GET /api/booking/room-types`. Admin drawer gets a Photos section; the static landing page fetches the public list and swaps bundled defaults for managed photos.

**Tech Stack:** Rust/Axum/SQLx (PostgreSQL), React/TS + MUI + TanStack Query + ky, static HTML/ES-module landing page, Tauri 2.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-13-room-type-photos-design.md`.
- SQL stays parameterized (`sqlx::query`, runtime-checked — a type mismatch compiles and fails at runtime; add one live-DB test touching `images` jsonb).
- Public URL stored in `images` is `/uploads/room-types/<uuid>.<ext>`; disk path is `uploads/public/room-types/<uuid>.<ext>` (`ServeDir::new("uploads/public")` is nested at `/uploads`).
- Only JPEG/PNG/WebP by magic bytes; 10 MB cap; uuid filenames.
- File deletes are path-guarded to `/uploads/room-types/` and best-effort.
- No schema/seed changes (`images` column already exists; seed checksum frozen).
- New routes drift `docs/api/openapi.json` — regenerate with `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
- Landing-page JS must be an external module (desktop CSP allows no inline scripts).
- Respect the dirty worktree: commit only files this plan touches.
- Photo mapping (bundled defaults): `family-room.jpg`→Family Room, `superior-twin.jpg`→Superior Twin, `deluxe-king.jpg`→Deluxe King, `family-suite.jpg`→Family Suite. Standard Queen has no bundled photo.

---

### Task 1: Backend — `images` on the RoomType admin model + update path

**Files:**
- Modify: `hotel-app-be/src/models/room.rs` (RoomType ~L179, RoomTypeUpdateInput ~L219)
- Modify: `hotel-app-be/src/repositories/rooms_queries.rs` (`ROOM_TYPE_COLUMNS` ~L549, `row_to_room_type` ~L75, `RoomTypeUpdate` ~L634, `update_room_type` ~L651)
- Modify: `hotel-app-be/src/services/rooms.rs` (`update_room_type_handler` ~L485)
- Test: `hotel-app-be/src/services/rooms.rs` `#[cfg(test)]` module (create if absent) or `hotel-app-be/tests/rooms.rs` for the live-DB part

**Interfaces:**
- Produces: `RoomType.images: Vec<String>`; `RoomTypeUpdateInput.images: Option<Vec<String>>`; `rq::RoomTypeUpdate.images: &'a Option<Vec<String>>`; `delete_public_room_image(path: &str)` (file-private helper) — used by Task 2's tests too.

- [ ] **Step 1: Model fields**

In `models/room.rs` add to `RoomType`:
```rust
    pub images: Vec<String>,
```
Add to `RoomTypeUpdateInput`:
```rust
    pub images: Option<Vec<String>>,
```

- [ ] **Step 2: Repository plumbing**

In `rooms_queries.rs` append `, images` to `ROOM_TYPE_COLUMNS`. In `row_to_room_type` add:
```rust
        images: row
            .try_get::<serde_json::Value, _>("images")
            .ok()
            .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
            .unwrap_or_default(),
```
Add to `struct RoomTypeUpdate<'a>`:
```rust
    pub images: &'a Option<Vec<String>>,
```
In `update_room_type` add `images = COALESCE($16, images),` before `updated_at = ...` and append the bind:
```rust
    .bind(input.images.as_ref().map(|v| serde_json::to_value(v).unwrap_or_default()))
```

- [ ] **Step 3: Service — pass images through + delete removed files**

In `services/rooms.rs::update_room_type_handler`, before `rq::update_room_type(...)`:
```rust
    let before_images = if input.images.is_some() {
        rq::fetch_room_type_by_id(&pool, id).await?.images
    } else {
        Vec::new()
    };
```
Pass `images: &input.images` in `rq::RoomTypeUpdate { ... }`. After the re-fetch, before the audit log:
```rust
    if let Some(new_images) = &input.images {
        for removed in before_images.iter().filter(|p| !new_images.contains(p)) {
            delete_public_room_image(removed);
        }
    }
```
Add at file scope:
```rust
/// Deletes a file previously stored under the public room-image directory.
/// `path` comes from the database, so it is treated as untrusted: only
/// `/uploads/room-types/<file>` values with a bare filename are touched.
fn delete_public_room_image(path: &str) {
    const PREFIX: &str = "/uploads/room-types/";
    let Some(name) = path.strip_prefix(PREFIX) else { return };
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return;
    }
    let _ = std::fs::remove_file(PathBuf::from("uploads/public/room-types").join(name));
}
```
(`PathBuf` is already imported in services/rooms.rs — verify; add `use std::path::PathBuf;` if not.)

- [ ] **Step 4: Failing tests — path guard**

In a `#[cfg(test)] mod tests` at the bottom of `services/rooms.rs`:
```rust
#[test]
fn delete_public_room_image_rejects_foreign_paths() {
    // None of these may touch the filesystem; the calls must simply return.
    delete_public_room_image("/uploads/room-types/../../etc/passwd");
    delete_public_room_image("uploads/room-types/x.jpg");
    delete_public_room_image("/uploads/room-types/");
    delete_public_room_image("/uploads/room-types/sub/x.jpg");
    delete_public_room_image("/etc/passwd");
}

#[test]
fn delete_public_room_image_removes_guarded_file() {
    let dir = std::path::PathBuf::from("uploads/public/room-types");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("t.jpg"), b"x").unwrap();
    delete_public_room_image("/uploads/room-types/t.jpg");
    assert!(!dir.join("t.jpg").exists());
}
```
Run: `cargo test --all-features delete_public_room_image` → the rejects test passes, the removes test fails until the helper exists (write tests first, watch them fail, then implement).

- [ ] **Step 5: Live-DB test — images round-trip** (DATABASE_URL-gated, follows repo pattern)

In `hotel-app-be/tests/` (find the existing room-type test file first; otherwise add to a new `room_type_images.rs` that early-returns without `DATABASE_URL`): create a room type via `rq::insert_room_type`, PATCH-update `images` to `["/uploads/room-types/a.jpg"]` via `rq::update_room_type`, re-fetch and assert `images == vec!["/uploads/room-types/a.jpg"]`. This is the required live-PostgreSQL check that the jsonb mapping actually fetches (per AGENTS.md SQLx runtime-check rule).

- [ ] **Step 6: Verify + commit**

Run `cargo check --all-features` and `cargo test --all-features delete_public_room_image`. Then:
```bash
git add hotel-app-be/src/models/room.rs hotel-app-be/src/repositories/rooms_queries.rs hotel-app-be/src/services/rooms.rs hotel-app-be/tests/
git commit -m "feat(be): expose room_types.images on admin room-type API"
```

---

### Task 2: Backend — `POST /api/room-types/{id}/images` upload endpoint

**Files:**
- Modify: `hotel-app-be/src/services/rooms.rs` (append handler + helpers + tests)
- Modify: `hotel-app-be/src/handlers/rooms.rs` (thin wrapper)
- Modify: `hotel-app-be/src/routes/rooms.rs` (route + permission)
- Modify: `hotel-app-be/src/repositories/rooms_queries.rs` (`append_room_type_image`)
- Regen: `docs/api/openapi.json`

**Interfaces:**
- Consumes: `delete_public_room_image` guard pattern, `RoomType` from Task 1.
- Produces: `POST /api/room-types/{id}/images` (multipart field `file`) → `200 RoomType`. Frontend Task 4 calls this as `uploadRoomTypeImage`.

- [ ] **Step 1: Repository append**

```rust
pub async fn append_room_type_image(
    pool: &DbPool,
    id: i64,
    path: &str,
) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE room_types SET images = COALESCE(images, '[]'::jsonb) || jsonb_build_array($2::text), updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    )
    .bind(id)
    .bind(path)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}
```

- [ ] **Step 2: Service handler + helpers** (mirror `receipt_upload_bytes` in `handlers/guest_portal.rs` and `receipt_extension`/`save_payment_receipt` in `services/payments.rs`)

```rust
const ROOM_IMAGE_UPLOAD_DIR: &str = "uploads/public/room-types";
const ROOM_IMAGE_URL_PREFIX: &str = "/uploads/room-types";
pub(crate) const MAX_ROOM_IMAGE_BYTES: usize = 10 * 1024 * 1024;

fn room_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

async fn image_upload_bytes(mut multipart: Multipart) -> Result<Vec<u8>, ApiError> {
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("Unable to read image upload.".to_string()))?
    {
        if field.name() == Some("file") {
            let mut bytes = Vec::new();
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|_| ApiError::BadRequest("Unable to read image upload.".to_string()))?
            {
                if bytes.len() + chunk.len() > MAX_ROOM_IMAGE_BYTES {
                    return Err(ApiError::BadRequest(
                        "Image file size must be between 1 byte and 10MB".to_string(),
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(bytes);
        }
    }
    Err(ApiError::BadRequest("Select an image file to upload.".to_string()))
}

pub async fn upload_room_type_image_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    multipart: Multipart,
) -> Result<Json<RoomType>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;
    let bytes = image_upload_bytes(multipart).await?;
    if bytes.is_empty() {
        return Err(ApiError::BadRequest("Image file size must be between 1 byte and 10MB".to_string()));
    }
    let extension = room_image_extension(&bytes).ok_or_else(|| {
        ApiError::BadRequest("Image must be a JPEG, PNG, or WebP file.".to_string())
    })?;
    let directory = PathBuf::from(ROOM_IMAGE_UPLOAD_DIR);
    fs::create_dir_all(&directory)
        .map_err(|_| ApiError::Internal("Unable to prepare image storage.".to_string()))?;
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    let disk_path = directory.join(&filename);
    fs::write(&disk_path, &bytes)
        .map_err(|_| ApiError::Internal("Unable to save the image.".to_string()))?;
    let url_path = format!("{}/{}", ROOM_IMAGE_URL_PREFIX, filename);
    if let Err(e) = rq::append_room_type_image(&pool, id, &url_path).await {
        let _ = fs::remove_file(&disk_path);
        return Err(e);
    }
    let room_type = rq::fetch_room_type_by_id(&pool, id).await?;
    let _ = AuditLog::log_event(&pool, AuditEvent {
        user_id: Some(user_id),
        action: "room_type_image_added",
        resource_type: "room_type",
        resource_id: Some(id),
        details: Some(serde_json::json!({"path": url_path})),
        ..Default::default()
    }).await;
    Ok(Json(room_type))
}
```
Check imports in services/rooms.rs: needs `axum::extract::Multipart`, `std::fs`, `std::path::PathBuf`, `uuid` (uuid crate is already a dependency — used in payments.rs via `uuid::Uuid`).

- [ ] **Step 3: Handler + route**

`handlers/rooms.rs`:
```rust
pub async fn upload_room_type_image_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    multipart: axum::extract::Multipart,
) -> Result<Json<RoomType>, ApiError> {
    room_service::upload_room_type_image_handler(State(pool), headers, Path(id), multipart).await
}
```
`routes/rooms.rs`, in the room-types block:
```rust
        .route("/room-types/{id}/images", post(upload_room_type_image))
```
with a wrapper like the others that delegates to the handler (no extra permission here — the service checks `rooms:update`, same as `update_room_type`).

- [ ] **Step 4: Tests**

Unit tests in `services/rooms.rs::tests` mirroring `handlers/guest_portal.rs` tests: build a `Multipart` via `Multipart::from_request` (copy the `receipt_multipart` harness), assert:
- `image_upload_bytes` accepts a small file and rejects a missing `file` field;
- `room_image_extension` returns `Some("jpg")`/`Some("png")`/`Some("webp")` for the magic prefixes and `None` for `b"%PDF-1.7"` and `b"GIF89a"`.

Run: `cargo test --all-features image_upload` / `room_image_extension` → write failing first, then implement.

- [ ] **Step 5: Regenerate OpenAPI + commit**

```bash
cd hotel-app-be
HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift
git add src/ ../docs/api/openapi.json
git commit -m "feat(be): POST /room-types/{id}/images upload endpoint"
```

---

### Task 3: Backend — public `GET /api/booking/room-types`

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs` (add `PublicRoomType`)
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs` (`list_public_room_types`; `json_string_list` helper already exists ~L41)
- Modify: `hotel-app-be/src/modules/guest_booking/handlers.rs` (`public_room_types_handler`)
- Modify: `hotel-app-be/src/modules/guest_booking/routes.rs` (route)
- Regen: `docs/api/openapi.json`

**Interfaces:**
- Produces: `GET /api/booking/room-types` → `200 PublicRoomType[]` `{id, name, code, description, images: string[], sort_order}` for `is_active = true`, ordered `sort_order, name`. Landing page Task 5 consumes this; no auth.

- [ ] **Step 1: Model**

```rust
/// Public marketing-facing room type — no pricing or availability fields.
#[derive(Debug, Serialize)]
pub struct PublicRoomType {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub images: Vec<String>,
    pub sort_order: i32,
}
```

- [ ] **Step 2: Repository** (assoc fn on `Repository`, matching existing style)

```rust
pub async fn list_public_room_types(pool: &DbPool) -> Result<Vec<PublicRoomType>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, code, description, images, sort_order FROM room_types WHERE is_active = true ORDER BY sort_order, name",
    )
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    Ok(rows
        .iter()
        .map(|row| PublicRoomType {
            id: row.get("id"),
            name: row.get("name"),
            code: row.get("code"),
            description: row.try_get("description").ok(),
            images: json_string_list(row, "images"),
            sort_order: row.try_get("sort_order").unwrap_or(0),
        })
        .collect())
}
```
(Verify the existing error-mapper/`row.get` style in that file and match it — e.g. `sqlx::Row` import, `db_err` vs `ApiError::from`.)

- [ ] **Step 3: Handler + route**

```rust
pub async fn public_room_types_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<PublicRoomType>>, ApiError> {
    Ok(Json(Repository::list_public_room_types(&pool).await?))
}
```
Route in `routes.rs` public block:
```rust
        .route("/booking/room-types", get(handlers::public_room_types_handler))
```

- [ ] **Step 4: Live-DB test** — DATABASE_URL-gated: seed/ensure an active type with images and an inactive type, assert the endpoint returns the active one with `images` populated and excludes the inactive one. Follow the skip-early pattern used by the existing guest_booking tests.

- [ ] **Step 5: Regen OpenAPI + commit** (same commands as Task 2 Step 5).

---

### Task 4: Frontend — types, service, Room Configuration Photos UI

**Files:**
- Modify: `hotel-web-fe/src/types/room.types.ts`
- Modify: `hotel-web-fe/src/api/rooms.service.ts`
- Modify: `hotel-web-fe/src/features/rooms/components/RoomConfigurationPage.tsx` (room-type Drawer — read the drawer JSX ~L598-end first)
- Test: `hotel-web-fe/src/api/rooms.service.test.ts` (create; mirror `guestPortal.service.test.ts` mocking style)

**Interfaces:**
- Consumes: `POST /api/room-types/{id}/images` → `RoomType`; `PATCH /api/room-types/{id}` `{images}` → `RoomType` (Task 1/2).
- Produces: `RoomType.images?: string[]`; `RoomsService.uploadRoomTypeImage(id: number, file: File): Promise<RoomType>`.

- [ ] **Step 1: Types**

`room.types.ts`: add `images?: string[];` to `RoomType` and `RoomTypeUpdateInput`.

- [ ] **Step 2: Service**

`rooms.service.ts` (match its existing `api.post(...).json<T>()` style; check how `ekyc.service.ts` posts FormData with ky first):
```ts
static async uploadRoomTypeImage(id: number, file: File): Promise<RoomType> {
  const body = new FormData();
  body.append('file', file);
  return await api.post(`room-types/${id}/images`, { body }).json<RoomType>();
}
```

- [ ] **Step 3: Failing service test**

`rooms.service.test.ts`: mock `api` like `guestPortal.service.test.ts` does, call `uploadRoomTypeImage(7, new File([bytes], 'r.jpg', { type: 'image/jpeg' }))`, assert `api.post` was called with `room-types/7/images` and a `FormData` body containing the file. Run `bun run test rooms.service` → fails → implement.

- [ ] **Step 4: Photos section in the room-type drawer**

Read the drawer JSX in `RoomConfigurationPage.tsx` first, then add a "Photos" block (inside the Drawer, above the save actions) matching the file's `C`-token styling:

- When `editingType` is null (create mode): render a disabled hint `Typography` — "Save the room type to add photos."
- Otherwise render thumbnail grid + upload button:

```tsx
<Typography sx={{ fontSize: 11, fontWeight: 600, color: C.ink3, letterSpacing: '0.6px', textTransform: 'uppercase', mt: 2 }}>
  Photos
</Typography>
<Typography sx={{ fontSize: 12, color: C.ink3, mb: 1 }}>
  Shown on the website and guest booking. The first photo is the cover.
</Typography>
<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
  {(editingType?.images ?? []).map((path, i) => (
    <Box key={path} sx={{ position: 'relative', width: 96, height: 64 }}>
      <Box component="img" src={apiUrl(path)} alt={`${editingType?.name} photo ${i + 1}`}
        sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 1, border: `1px solid ${C.border}` }} />
      {i === 0 && <Chip label="Cover" size="small" sx={{ position: 'absolute', left: 4, bottom: 4, height: 18, fontSize: 10 }} />}
      <IconButton size="small" aria-label="Remove photo" disabled={photoBusy}
        onClick={() => handleRemovePhoto(path)}
        sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.75)' }, width: 20, height: 20 }}>
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  ))}
  <Button component="label" variant="outlined" size="small" disabled={photoBusy || !editingType}
    startIcon={photoBusy ? <CircularProgress size={14} /> : <AddIcon />}>
    Upload
    <input hidden type="file" accept="image/jpeg,image/png,image/webp"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleUploadPhoto(f); }} />
  </Button>
</Box>
```

Handlers on the page component:
```ts
const [photoBusy, setPhotoBusy] = useState(false);

const handleUploadPhoto = async (file: File) => {
  if (!editingType) return;
  try {
    setPhotoBusy(true);
    const updated = await RoomsService.uploadRoomTypeImage(editingType.id, file);
    setEditingType(updated);
    emitApiNotification({ message: 'Photo uploaded', severity: 'success' });
    await roomTypesQuery.refetch();
  } catch (err) {
    emitApiNotification({ message: errorMessage(err, 'Failed to upload photo'), severity: 'error' });
  } finally {
    setPhotoBusy(false);
  }
};

const handleRemovePhoto = async (path: string) => {
  if (!editingType) return;
  try {
    setPhotoBusy(true);
    const images = (editingType.images ?? []).filter((p) => p !== path);
    const updated = await RoomsService.updateRoomType(editingType.id, { images });
    setEditingType(updated);
    emitApiNotification({ message: 'Photo removed', severity: 'success' });
    await roomTypesQuery.refetch();
  } catch (err) {
    emitApiNotification({ message: errorMessage(err, 'Failed to remove photo'), severity: 'error' });
  } finally {
    setPhotoBusy(false);
  }
};
```
Add `apiUrl` import: `import { apiUrl } from '../../../desktop/runtimeApi';` and `RoomsService` import matching how the page's hooks/services import (check existing imports; the page uses `useRoomQueries` hooks — service fns are called via `../../../api/rooms.service` as `RoomsService` elsewhere; match that).

- [ ] **Step 5: Verify + commit**

`cd hotel-web-fe && bun run typecheck && bun run lint && bun run test` then:
```bash
git add hotel-web-fe/src/types/room.types.ts hotel-web-fe/src/api/rooms.service.ts hotel-web-fe/src/api/rooms.service.test.ts hotel-web-fe/src/features/rooms/components/RoomConfigurationPage.tsx
git commit -m "feat(fe): manage room-type photos in Room Configuration"
```

---

### Task 5: Landing page photos + dynamic binding + desktop URL resolution

**Files:**
- Create: `hotel-web-fe/public/salim-inn/rooms/{family-room,superior-twin,deluxe-king,family-suite}.jpg` (copy from the pasted-image temp files)
- Modify: `hotel-web-fe/salim-inn/index.html` (gallery cards + script tag)
- Create: `hotel-web-fe/salim-inn/room-photos.js`
- Modify: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx` (`offerImage` → `apiUrl`)
- Modify: `hotel-desktop/src-tauri/tauri.conf.json` (CSP `img-src`)

**Interfaces:**
- Consumes: `GET /api/booking/room-types` (Task 3); `apiUrl` from `src/desktop/runtimeApi.ts` (`apiUrl('uploads/x.jpg')` → `/uploads/x.jpg` on web, `http://127.0.0.1:PORT/uploads/x.jpg` on desktop).
- Produces: gallery cards keyed by `data-room-name` / `data-room-code`.

- [ ] **Step 1: Copy the four photos**

```bash
mkdir -p "hotel-web-fe/public/salim-inn/rooms"
cp "/var/folders/40/bp6kllln673286dl1hr15hfc0000gn/T/devin-pasted-images/1789308103685822000-14269-6-pasted.jpg" "hotel-web-fe/public/salim-inn/rooms/family-room.jpg"
cp "/var/folders/40/bp6kllln673286dl1hr15hfc0000gn/T/devin-pasted-images/1789308103686995000-14269-7-pasted.jpg" "hotel-web-fe/public/salim-inn/rooms/superior-twin.jpg"
cp "/var/folders/40/bp6kllln673286dl1hr15hfc0000gn/T/devin-pasted-images/1789308103687623000-14269-8-pasted.jpg" "hotel-web-fe/public/salim-inn/rooms/deluxe-king.jpg"
cp "/var/folders/40/bp6kllln673286dl1hr15hfc0000gn/T/devin-pasted-images/1789308103688010000-14269-9-pasted.jpg" "hotel-web-fe/public/salim-inn/rooms/family-suite.jpg"
```
(Verify the temp files still exist first; if cleaned up, re-export the four photos.)

- [ ] **Step 2: index.html gallery**

Replace the 3 hotlinked room `<figure class="photo-card">` elements (keep bathroom/Farley/frontage cards) with 4 keyed cards — bundled src as the default:

```html
<figure class="photo-card" data-room-name="Deluxe King"><img src="/salim-inn/rooms/deluxe-king.jpg" alt="Salim Inn Deluxe King room" loading="lazy"><figcaption><strong>Deluxe King</strong><span>A larger bed and practical floor plan</span></figcaption></figure>
<figure class="photo-card" data-room-name="Superior Twin"><img src="/salim-inn/rooms/superior-twin.jpg" alt="Salim Inn Superior Twin room with two separate beds" loading="lazy"><figcaption><strong>Superior Twin</strong><span>Separate beds for a flexible stay</span></figcaption></figure>
<figure class="photo-card" data-room-name="Family Room"><img src="/salim-inn/rooms/family-room.jpg" alt="Salim Inn family room with multiple beds" loading="lazy"><figcaption><strong>Family Room</strong><span>Space to stay together</span></figcaption></figure>
<figure class="photo-card" data-room-name="Family Suite"><img src="/salim-inn/rooms/family-suite.jpg" alt="Salim Inn family suite" loading="lazy"><figcaption><strong>Family Suite</strong><span>Room to spread out</span></figcaption></figure>
```
Add before the existing scripts at the end of `<body>`:
```html
<script type="module" src="./room-photos.js"></script>
```

- [ ] **Step 3: `salim-inn/room-photos.js`**

External module (CSP). Keep it dependency-free:

```js
// Landing gallery room photos. Bundled images under /salim-inn/rooms/ are the
// defaults; when the public room-type API returns managed images they replace
// the defaults, so admin updates propagate without a site edit.
const ENDPOINT = '/api/booking/room-types';

async function apiBase() {
  const tauri = window.__TAURI_INTERNALS__;
  if (!tauri) return '';
  try {
    const status = await tauri.invoke('get_status');
    return (status && status.backend_url ? status.backend_url : '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function imageUrl(base, path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function bindCard(card, type, base) {
  const src = imageUrl(base, type.images && type.images[0]);
  if (!src) return;
  const img = card.querySelector('img');
  img.src = src;
  img.alt = `${type.name} room at Salim Inn`;
  const strong = card.querySelector('figcaption strong');
  if (strong) strong.textContent = type.name;
}

function matches(card, type) {
  const code = card.getAttribute('data-room-code');
  const name = card.getAttribute('data-room-name');
  if (code && type.code && code.toLowerCase() === type.code.toLowerCase()) return true;
  return Boolean(name && type.name && name.toLowerCase() === type.name.toLowerCase());
}

async function applyRoomPhotos() {
  const grid = document.querySelector('.photo-grid');
  if (!grid) return;
  const base = await apiBase();
  let types;
  try {
    const res = await fetch(`${base}${ENDPOINT}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    types = await res.json();
  } catch {
    return; // Offline/API down: bundled photos stay.
  }
  if (!Array.isArray(types)) return;
  const cards = [...grid.querySelectorAll('.photo-card[data-room-name], .photo-card[data-room-code]')];
  const bound = new Set();
  for (const card of cards) {
    const type = types.find((t) => matches(card, t));
    if (type) { bound.add(type); bindCard(card, type, base); }
  }
  // Types with photos but no card (e.g. a type added later) get appended ahead
  // of the static site cards.
  const staticCards = [...grid.querySelectorAll('.photo-card:not([data-room-name]):not([data-room-code])')];
  for (const type of types) {
    if (bound.has(type) || !imageUrl(base, type.images && type.images[0])) continue;
    const card = cards[0] ? cards[0].cloneNode(true) : null;
    if (!card) break;
    card.removeAttribute('data-room-code');
    card.setAttribute('data-room-name', type.name);
    bindCard(card, type, base);
    const span = card.querySelector('figcaption span');
    if (span) span.textContent = type.code;
    grid.insertBefore(card, staticCards[0] ?? null);
  }
}

applyRoomPhotos();
```

- [ ] **Step 4: Desktop URL resolution for offer images**

`PortalBookingPage.tsx`: `offerImage` returns the raw path; resolve it so `/uploads/...` hits the backend on desktop:
```ts
import { apiUrl } from '../../../desktop/runtimeApi';
// ...
function offerImage(offer: GuestBookingOffer): string | null {
  const image = offer.images?.find((i) => typeof i === 'string' && i.trim().length > 0);
  return image ? apiUrl(image) : null;
}
```

- [ ] **Step 5: Tauri CSP**

`tauri.conf.json` `img-src`: add `http://127.0.0.1:* http://localhost:*` (connect-src already allows them). This is a security-relevant config — call it out in the final summary.

- [ ] **Step 6: Manual smoke**

`bun run start` + backend up: landing page shows the 4 bundled photos; upload a photo in Room Configuration → gallery card swaps on reload; guest portal offer shows the image. Commit:
```bash
git add hotel-web-fe/public/salim-inn/rooms hotel-web-fe/salim-inn/index.html hotel-web-fe/salim-inn/room-photos.js hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx hotel-desktop/src-tauri/tauri.conf.json
git commit -m "feat(site): room-type photos on landing gallery, managed from admin"
```

---

### Task 6: Verification gates

- [ ] `cd hotel-app-be && cargo check --all-features && cargo clippy --all-features -- -D warnings`
- [ ] `cargo test --all-features` (note pass count — ~209 without DATABASE_URL means only lib tests ran)
- [ ] `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test && bun run build`
- [ ] `cd hotel-desktop/src-tauri && cargo check` (desktop CI gate is a cargo check)
- [ ] Confirm openapi_drift committed; no stray changes to dirty worktree files.

## Self-review notes

- Spec coverage: admin write path (T1/T2), public read (T3), admin UI (T4), landing dynamic gallery + bundled defaults + desktop CSP + portal URL fix (T5), openapi regen (T2/T3 step 5). Seed/checksum untouched as required.
- `data-room-code` override documented in spec; cards ship with `data-room-name` only — production codes unknown, name-match is the primary binding.
