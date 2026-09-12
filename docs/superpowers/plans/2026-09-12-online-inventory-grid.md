# Online Inventory 14-Day Matrix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-date online-inventory card list with a 14-day
room-type × date matrix supporting single-cell and bulk edits, staged changes,
one atomic commit, and WCAG 2.1 AAA interaction.

**Architecture:** Two backend additions in `modules/guest_booking` (range GET,
atomic bulk PUT with audit + availability events), no schema change. Frontend
feature rewritten around `savedCells` map + `edits` overlay, rendered as a real
ARIA `grid`.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL · React 19/TS/MUI v9/Vitest/jsdom.

## Global Constraints

- Guard is `rooms:update` on every new admin route — reuse
  `require_permission_helper(&pool, &headers, "rooms:update")`.
- SQL stays parameterized (`sqlx::query`, runtime-checked); any new row-mapping
  over date/numeric columns needs one `DATABASE_URL`-gated live test.
- Range cap: `to - from` must be ≤ 30 days (31 dates inclusive), else `400`.
- Bulk cap: `cells.len()` ≤ 500, non-empty, no duplicate `(room_type_id,
  stay_date)` keys.
- Money: `custom_price` must be `> 0` and `scale() <= 2`; client mirrors this.
- FE: `lib: ES2020` — no `.at()`, `Object.groupBy`, `findLast`. Dates via
  `src/utils/date.ts` (`formatLocalDate`) — never `toISOString().split/slice`.
- HTTP via `api` from `src/api/client.ts` only. Hardcoded English strings
  (feature convention — no i18n in `onlineInventory`).
- Cells and controls ≥44×44px; text ≥7:1 contrast; no state by color alone.
- Commit only files this feature touches — the worktree has another session's
  dirty files; never `git add -A`.

---

### Task 1: Backend — range GET with `standard_price` + `is_override`

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs:120-172`
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs:539-546`
- Test: `hotel-app-be/src/modules/guest_booking/service.rs` `#[cfg(test)]` mod (validation is pure)

**Interfaces:**
- Consumes: existing `get_decimal`, `get_opt_decimal` row helpers; `DbPool`.
- Produces:
  - `OnlineInventoryQuery { from: String, to: String }` (was `stay_date`)
  - `OnlineInventoryAllocation` += `standard_price: Decimal`, `is_override: bool`
  - `Repository::list_online_inventory_range(pool, from: NaiveDate, to: NaiveDate) -> Result<Vec<OnlineInventoryAllocation>, ApiError>` (`to` inclusive)
  - `service::MAX_ONLINE_INVENTORY_SPAN_DAYS: i64 = 30`

- [ ] **Step 1: Write failing tests** — append to `service.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_range_over_31_dates() {
        let err = parse_online_inventory_range("2026-09-01", "2026-10-02")
            .expect_err("32-day span must fail");
        assert!(matches!(err, ApiError::BadRequest(_)));
    }

    #[test]
    fn accepts_31_date_span_and_rejects_inverted() {
        assert!(parse_online_inventory_range("2026-09-01", "2026-10-01").is_ok());
        assert!(parse_online_inventory_range("2026-10-01", "2026-09-01").is_err());
    }
}
```

- [ ] **Step 2: Run** `cd hotel-app-be && cargo test --all-features guest_booking` → FAIL (`parse_online_inventory_range` undefined).

- [ ] **Step 3: Implement.**

`models.rs` — replace `stay_date` field:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct OnlineInventoryQuery {
    pub from: String,
    pub to: String,
}
```

Add to `OnlineInventoryAllocation` (before `online_available_rooms`):

```rust
    pub custom_price: Option<Decimal>,
    pub standard_price: Decimal,
    pub is_override: bool,
    pub online_available_rooms: i64,
```

`repository.rs` — rename the body of `list_online_inventory` into
`list_online_inventory_range` with this SQL (single query, `to` inclusive):

```rust
    pub async fn list_online_inventory_range(
        pool: &DbPool,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<OnlineInventoryAllocation>, ApiError> {
        let rows = sqlx::query(r#"
            WITH dates AS (
                SELECT generate_series($1::date, $2::date, interval '1 day')::date AS stay_date
            )
            SELECT rt.id AS room_type_id, rt.code AS room_type_code, rt.name AS room_type_name,
                   d.stay_date,
                   COALESCE(avail.cnt, 0)::bigint AS physical_available_rooms,
                   COALESCE(a.walk_in_reserved_rooms, 0) AS walk_in_reserved_rooms,
                   COALESCE(a.online_booking_enabled, true) AS online_booking_enabled,
                   a.custom_price::text AS custom_price,
                   (a.room_type_id IS NOT NULL) AS is_override,
                   COALESCE(rate.price,
                       CASE WHEN extract(isodow FROM d.stay_date) IN (6, 7)
                            THEN rt.weekend_rate ELSE rt.weekday_rate END,
                       rt.base_price)::text AS standard_price
            FROM room_types rt
            CROSS JOIN dates d
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::bigint AS cnt
                FROM rooms r
                WHERE r.room_type_id = rt.id AND r.is_active = true
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id
                    AND b.status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in',
                                     'pending', 'pending_payment', 'pending_confirmation')
                    AND b.check_in_date < d.stay_date + 1 AND b.check_out_date > d.stay_date)
            ) avail ON true
            LEFT JOIN online_inventory_allocations a
              ON a.room_type_id = rt.id AND a.stay_date = d.stay_date
            LEFT JOIN LATERAL (
                SELECT rr.price
                FROM room_rates rr
                JOIN rate_plans rp ON rp.id = rr.rate_plan_id
                WHERE rr.room_type_id = rt.id
                  AND rp.is_active = true
                  AND rr.effective_from <= d.stay_date
                  AND (rr.effective_to IS NULL OR rr.effective_to >= d.stay_date)
                  AND (rp.valid_from IS NULL OR rp.valid_from <= d.stay_date)
                  AND (rp.valid_to IS NULL OR rp.valid_to >= d.stay_date)
                  AND ((extract(isodow FROM d.stay_date) = 1 AND rp.applies_monday)
                    OR (extract(isodow FROM d.stay_date) = 2 AND rp.applies_tuesday)
                    OR (extract(isodow FROM d.stay_date) = 3 AND rp.applies_wednesday)
                    OR (extract(isodow FROM d.stay_date) = 4 AND rp.applies_thursday)
                    OR (extract(isodow FROM d.stay_date) = 5 AND rp.applies_friday)
                    OR (extract(isodow FROM d.stay_date) = 6 AND rp.applies_saturday)
                    OR (extract(isodow FROM d.stay_date) = 7 AND rp.applies_sunday))
                ORDER BY rp.priority DESC, rr.id DESC LIMIT 1
            ) rate ON true
            WHERE rt.is_active = true
            ORDER BY rt.name, d.stay_date
        "#)
        .bind(from)
        .bind(to)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        // same row-mapping as the old query, plus:
        //   stay_date: row.try_get("stay_date")?,
        //   standard_price: get_decimal(&row, "standard_price"),
        //   is_override: row.try_get("is_override").unwrap_or(false),
        //   online_available_rooms: enabled ? max(0, physical - reserved) : 0
    }
```

Keep the old signature as a wrapper (single-PUT refetch path still uses it):

```rust
    pub async fn list_online_inventory(
        pool: &DbPool,
        stay_date: NaiveDate,
    ) -> Result<Vec<OnlineInventoryAllocation>, ApiError> {
        Self::list_online_inventory_range(pool, stay_date, stay_date).await
    }
```

`service.rs`:

```rust
pub const MAX_ONLINE_INVENTORY_SPAN_DAYS: i64 = 30;

fn parse_online_inventory_range(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), ApiError> {
    let from = NaiveDate::parse_from_str(from.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid 'from' date. Use YYYY-MM-DD".to_string()))?;
    let to = NaiveDate::parse_from_str(to.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid 'to' date. Use YYYY-MM-DD".to_string()))?;
    if to < from {
        return Err(ApiError::BadRequest("'to' must not be before 'from'".to_string()));
    }
    if (to - from).num_days() > MAX_ONLINE_INVENTORY_SPAN_DAYS {
        return Err(ApiError::BadRequest("Date range cannot exceed 31 days".to_string()));
    }
    Ok((from, to))
}

pub async fn list_online_inventory(
    pool: &DbPool,
    query: OnlineInventoryQuery,
) -> Result<Vec<OnlineInventoryAllocation>, ApiError> {
    let (from, to) = parse_online_inventory_range(&query.from, &query.to)?;
    Repository::list_online_inventory_range(pool, from, to).await
}
```

- [ ] **Step 4: Run** `cargo test --all-features guest_booking` → PASS; `cargo check --all-features` clean.

- [ ] **Step 5: Commit** — `git add` the three files; `git commit -m "feat(inventory): range read for online inventory with standard rate"`.

---

### Task 2: Backend — atomic bulk PUT + reset-delete + audit

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs:174-191` (extract tx variant)
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs` (validation + orchestration)
- Modify: `hotel-app-be/src/modules/guest_booking/handlers.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/routes.rs`

**Interfaces:**
- Produces:
  - `OnlineInventoryCellUpdate { room_type_id: i64, stay_date: String, reset: bool, walk_in_reserved_rooms: Option<i32>, online_booking_enabled: Option<bool>, custom_price: Option<Decimal> }`
  - `BulkUpdateOnlineInventoryRequest { cells: Vec<OnlineInventoryCellUpdate> }`
  - `OnlineInventoryAffectedSpan { room_type_id: i64, first_date: NaiveDate, last_date: NaiveDate }`
  - `BulkOnlineInventoryOutcome { allocations: Vec<OnlineInventoryAllocation>, spans: Vec<OnlineInventoryAffectedSpan> }`
  - `Repository::upsert_online_inventory_tx(&mut DbTransaction, …)` and `Repository::delete_online_inventory_tx(&mut DbTransaction, room_type_id, stay_date)`
  - `service::validate_inventory_fields(reserved: i32, custom_price: Option<Decimal>) -> Result<(), ApiError>` — pure, reused by single + bulk
  - `service::bulk_update_online_inventory(pool, request, actor_id) -> Result<BulkOnlineInventoryOutcome, ApiError>`
  - Route `PUT /admin/online-inventory/bulk`

- [ ] **Step 1: Failing tests** — extend `#[cfg(test)] mod tests`:

```rust
    fn cell(id: i64, date: &str) -> OnlineInventoryCellUpdate {
        OnlineInventoryCellUpdate {
            room_type_id: id,
            stay_date: date.to_string(),
            reset: false,
            walk_in_reserved_rooms: Some(1),
            online_booking_enabled: Some(true),
            custom_price: None,
        }
    }

    #[test]
    fn bulk_rejects_empty_over_cap_and_duplicates() {
        assert!(resolve_bulk_cells(vec![]).is_err());
        let too_many = (0..501).map(|i| cell(i, "2026-09-01")).collect();
        assert!(resolve_bulk_cells(too_many).is_err());
        let dup = vec![cell(1, "2026-09-01"), cell(1, "2026-09-01")];
        assert!(resolve_bulk_cells(dup).is_err());
    }

    #[test]
    fn bulk_requires_all_fields_unless_reset_and_validates_values() {
        let mut missing = cell(1, "2026-09-01");
        missing.custom_price = None;
        missing.walk_in_reserved_rooms = None;
        assert!(resolve_bulk_cells(vec![missing]).is_err());

        let mut bad_price = cell(1, "2026-09-01");
        bad_price.custom_price = Some(Decimal::ZERO);
        assert!(resolve_bulk_cells(vec![bad_price]).is_err());

        let mut reset = cell(1, "2026-09-01");
        reset.reset = true;
        reset.walk_in_reserved_rooms = None;
        reset.online_booking_enabled = None;
        assert!(resolve_bulk_cells(vec![reset]).is_ok());
    }

    #[test]
    fn inventory_fields_match_single_put_rules() {
        assert!(validate_inventory_fields(-1, None).is_err());
        assert!(validate_inventory_fields(0, Some(Decimal::ZERO)).is_err());
        assert!(validate_inventory_fields(0, Some(Decimal::new(1001, 2))).is_ok());
        assert!(validate_inventory_fields(0, Some(Decimal::new(10001, 3))).is_err()); // scale 3
    }
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`models.rs` additions:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct OnlineInventoryCellUpdate {
    pub room_type_id: i64,
    pub stay_date: String,
    #[serde(default)]
    pub reset: bool,
    pub walk_in_reserved_rooms: Option<i32>,
    pub online_booking_enabled: Option<bool>,
    pub custom_price: Option<Decimal>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BulkUpdateOnlineInventoryRequest {
    pub cells: Vec<OnlineInventoryCellUpdate>,
}

#[derive(Debug, Clone)]
pub struct OnlineInventoryAffectedSpan {
    pub room_type_id: i64,
    pub first_date: NaiveDate,
    pub last_date: NaiveDate,
}

#[derive(Debug, Clone)]
pub struct BulkOnlineInventoryOutcome {
    pub allocations: Vec<OnlineInventoryAllocation>,
    pub spans: Vec<OnlineInventoryAffectedSpan>,
}
```

`repository.rs` — split `upsert_online_inventory` so the write is tx-scoped:

```rust
    pub async fn upsert_online_inventory_tx(
        tx: &mut DbTransaction<'_>,
        room_type_id: i64,
        stay_date: NaiveDate,
        reserved: i32,
        enabled: bool,
        custom_price: Option<Decimal>,
        updated_by: i64,
    ) -> Result<(), ApiError> {
        Self::lock_room_type_tx(tx, room_type_id).await?;
        sqlx::query("INSERT INTO online_inventory_allocations (room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, custom_price, updated_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (room_type_id, stay_date) DO UPDATE SET walk_in_reserved_rooms = EXCLUDED.walk_in_reserved_rooms, online_booking_enabled = EXCLUDED.online_booking_enabled, custom_price = EXCLUDED.custom_price, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP")
        .bind(room_type_id).bind(stay_date).bind(reserved).bind(enabled)
        .bind(opt_decimal_to_db(custom_price)).bind(updated_by)
        .execute(&mut **tx).await.map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn delete_online_inventory_tx(
        tx: &mut DbTransaction<'_>,
        room_type_id: i64,
        stay_date: NaiveDate,
    ) -> Result<(), ApiError> {
        Self::lock_room_type_tx(tx, room_type_id).await?;
        sqlx::query("DELETE FROM online_inventory_allocations WHERE room_type_id = $1 AND stay_date = $2")
            .bind(room_type_id).bind(stay_date)
            .execute(&mut **tx).await.map_err(ApiError::from)?;
        Ok(())
    }
```

Delete the old `upsert_online_inventory` (its only caller is the service, updated next — grep to confirm).

`service.rs` — extract validation, rework single update, add bulk:

```rust
pub const MAX_BULK_INVENTORY_CELLS: usize = 500;

fn validate_inventory_fields(reserved: i32, custom_price: Option<Decimal>) -> Result<(), ApiError> {
    if reserved < 0 {
        return Err(ApiError::BadRequest("Walk-in reserve cannot be negative".to_string()));
    }
    if let Some(price) = custom_price {
        if price <= Decimal::ZERO {
            return Err(ApiError::BadRequest("Custom online price must be greater than zero".to_string()));
        }
        if price.scale() > 2 {
            return Err(ApiError::BadRequest("Custom online price can have at most two decimal places".to_string()));
        }
    }
    Ok(())
}

enum ResolvedCell {
    Set { room_type_id: i64, stay_date: NaiveDate, reserved: i32, enabled: bool, price: Option<Decimal> },
    Reset { room_type_id: i64, stay_date: NaiveDate },
}

fn resolve_bulk_cells(
    cells: Vec<OnlineInventoryCellUpdate>,
) -> Result<Vec<ResolvedCell>, ApiError> {
    if cells.is_empty() {
        return Err(ApiError::BadRequest("At least one cell is required".to_string()));
    }
    if cells.len() > MAX_BULK_INVENTORY_CELLS {
        return Err(ApiError::BadRequest("Too many cells in one update (max 500)".to_string()));
    }
    let mut seen = std::collections::HashSet::new();
    let mut resolved = Vec::with_capacity(cells.len());
    for cell in cells {
        let stay_date = NaiveDate::parse_from_str(cell.stay_date.trim(), "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid stay date. Use YYYY-MM-DD".to_string()))?;
        if !seen.insert((cell.room_type_id, stay_date)) {
            return Err(ApiError::BadRequest("Duplicate cell for a room type and date".to_string()));
        }
        if cell.reset {
            resolved.push(ResolvedCell::Reset { room_type_id: cell.room_type_id, stay_date });
            continue;
        }
        let (Some(reserved), Some(enabled)) =
            (cell.walk_in_reserved_rooms, cell.online_booking_enabled)
        else {
            return Err(ApiError::BadRequest(
                "walk_in_reserved_rooms and online_booking_enabled are required".to_string(),
            ));
        };
        validate_inventory_fields(reserved, cell.custom_price)?;
        resolved.push(ResolvedCell::Set {
            room_type_id: cell.room_type_id,
            stay_date,
            reserved,
            enabled,
            price: cell.custom_price,
        });
    }
    Ok(resolved)
}

pub async fn bulk_update_online_inventory(
    pool: &DbPool,
    request: BulkUpdateOnlineInventoryRequest,
    actor_id: i64,
) -> Result<BulkOnlineInventoryOutcome, ApiError> {
    let resolved = resolve_bulk_cells(request.cells)?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    for cell in &resolved {
        match *cell {
            ResolvedCell::Set { room_type_id, stay_date, reserved, enabled, price } =>
                Repository::upsert_online_inventory_tx(&mut tx, room_type_id, stay_date, reserved, enabled, price, actor_id).await?,
            ResolvedCell::Reset { room_type_id, stay_date } =>
                Repository::delete_online_inventory_tx(&mut tx, room_type_id, stay_date).await?,
        }
    }
    AuditLog::log_event_tx(&mut tx, AuditEvent {
        user_id: Some(actor_id),
        action: "online_inventory.bulk_updated",
        resource_type: "online_inventory",
        resource_id: None,
        details: Some(serde_json::json!({
            "cell_count": resolved.len(),
        })),
        ip_address: None,
        user_agent: None,
    }).await?;
    tx.commit().await.map_err(ApiError::from)?;

    // spans per room type + bounded refetch
    let mut spans: std::collections::BTreeMap<i64, (NaiveDate, NaiveDate)> = Default::default();
    for cell in &resolved {
        let (id, d) = match *cell {
            ResolvedCell::Set { room_type_id, stay_date, .. } | ResolvedCell::Reset { room_type_id, stay_date } => (room_type_id, stay_date),
        };
        spans.entry(id)
            .and_modify(|e| { e.0 = e.0.min(d); e.1 = e.1.max(d); })
            .or_insert((d, d));
    }
    let (min_date, max_date) = spans.values().fold(
        (NaiveDate::MAX, NaiveDate::MIN),
        |(lo, hi), (a, b)| (lo.min(*a), hi.max(*b)),
    );
    let room_type_ids: std::collections::HashSet<i64> = spans.keys().copied().collect();
    let allocations = Repository::list_online_inventory_range(pool, min_date, max_date)
        .await?
        .into_iter()
        .filter(|a| room_type_ids.contains(&a.room_type_id))
        .collect();
    let spans = spans.into_iter()
        .map(|(room_type_id, (first_date, last_date))| OnlineInventoryAffectedSpan { room_type_id, first_date, last_date })
        .collect();
    Ok(BulkOnlineInventoryOutcome { allocations, spans })
}
```

Add `use crate::models::AuditEvent;` to the service imports (check existing `use` block first — `AuditLog` is already imported at line 31).

`update_online_inventory` — move validation to `validate_inventory_fields`, wrap upsert + audit in one tx:

```rust
pub async fn update_online_inventory(
    pool: &DbPool,
    room_type_id: i64,
    stay_date: &str,
    request: UpdateOnlineInventoryRequest,
    actor_id: i64,
) -> Result<OnlineInventoryAllocation, ApiError> {
    validate_inventory_fields(request.walk_in_reserved_rooms, request.custom_price)?;
    let stay_date = NaiveDate::parse_from_str(stay_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid stay date. Use YYYY-MM-DD".to_string()))?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    Repository::upsert_online_inventory_tx(
        &mut tx, room_type_id, stay_date,
        request.walk_in_reserved_rooms, request.online_booking_enabled,
        request.custom_price, actor_id,
    ).await?;
    AuditLog::log_event_tx(&mut tx, AuditEvent {
        user_id: Some(actor_id),
        action: "online_inventory.updated",
        resource_type: "online_inventory",
        resource_id: None,
        details: Some(serde_json::json!({ "room_type_id": room_type_id, "stay_date": stay_date.to_string() })),
        ip_address: None,
        user_agent: None,
    }).await?;
    tx.commit().await.map_err(ApiError::from)?;
    Repository::list_online_inventory(pool, stay_date)
        .await?
        .into_iter()
        .find(|a| a.room_type_id == room_type_id)
        .ok_or_else(|| ApiError::NotFound("Room type not found".to_string()))
}
```

`handlers.rs`:

```rust
pub async fn bulk_update_online_inventory_handler(
    State(pool): State<DbPool>,
    Extension(actor_id): Extension<i64>,
    Extension(hub): Extension<AvailabilityHub>,
    Json(request): Json<super::models::BulkUpdateOnlineInventoryRequest>,
) -> Result<Json<Vec<super::models::OnlineInventoryAllocation>>, ApiError> {
    let outcome = service::bulk_update_online_inventory(&pool, request, actor_id).await?;
    for span in &outcome.spans {
        hub.publish(super::availability::AvailabilityEvent {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: "availability_changed",
            reason: "online_inventory_changed",
            room_type_id: Some(span.room_type_id),
            check_in_date: Some(span.first_date),
            check_out_date: span.last_date.succ_opt(),
            remaining_rooms: None,
        });
    }
    Ok(Json(outcome.allocations))
}
```

`routes.rs` — add after the existing pair:

```rust
        .route("/admin/online-inventory/bulk", put(bulk_update_online_inventory))
```

```rust
async fn bulk_update_online_inventory(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    hub: axum::extract::Extension<crate::modules::guest_booking::availability::AvailabilityHub>,
    axum::Json(request): axum::Json<super::models::BulkUpdateOnlineInventoryRequest>,
) -> Result<axum::Json<Vec<super::models::OnlineInventoryAllocation>>, crate::core::error::ApiError> {
    let actor_id =
        crate::core::middleware::require_permission_helper(&pool, &headers, "rooms:update").await?;
    handlers::bulk_update_online_inventory_handler(
        State(pool),
        axum::Extension(actor_id),
        hub,
        axum::Json(request),
    )
    .await
}
```

Note `Extension` is consumed positionally in the existing route fn — mirror that style.

- [ ] **Step 4: Run** `cargo test --all-features guest_booking` → PASS; `cargo clippy --all-features -- -D warnings` clean.

- [ ] **Step 5: Commit** — `feat(inventory): atomic bulk update with reset and audit`.

---

### Task 3: Backend — DATABASE_URL-gated repository test + openapi regen

**Files:**
- Create: `hotel-app-be/tests/online_inventory_range.rs`
- Regenerate: `docs/api/openapi.json`

- [ ] **Step 1:** Create the gated test, matching the early-return convention used by the other gated files in `tests/`:

```rust
use sqlx::PgPool;

#[tokio::test]
async fn range_lists_every_room_type_for_every_date_and_bulk_round_trips() {
    let Ok(url) = std::env::var("DATABASE_URL") else { return };
    let pool = PgPool::connect(&url).await.expect("connect");
    // pick a real room type
    let rt: Option<i64> = sqlx::query_scalar("SELECT id FROM room_types WHERE is_active = true LIMIT 1")
        .fetch_optional(&pool).await.expect("query");
    let Some(rt) = rt else { return };
    let from = chrono::NaiveDate::from_ymd_opt(2036, 1, 5).unwrap();
    let to = chrono::NaiveDate::from_ymd_opt(2036, 1, 11).unwrap();

    let rows = hotel_app_be::modules::guest_booking::repository::GuestBookingRepository::list_online_inventory_range(&pool, from, to).await.expect("range");
    assert!(!rows.is_empty());
    assert!(rows.iter().all(|r| r.standard_price > rust_decimal::Decimal::ZERO));
    assert_eq!(rows.iter().filter(|r| r.room_type_id == rt).count(), 7);

    // upsert + reset round-trip inside one tx, then roll back by cleaning up
    let mut tx = pool.begin().await.unwrap();
    hotel_app_be::modules::guest_booking::repository::GuestBookingRepository::upsert_online_inventory_tx(&mut tx, rt, from, 1, true, None, 1).await.unwrap();
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    hotel_app_be::modules::guest_booking::repository::GuestBookingRepository::delete_online_inventory_tx(&mut tx, rt, from).await.unwrap();
    tx.commit().await.unwrap();
}
```

Verify module paths/visibility (`pub` on `repository` mod + `GuestBookingRepository`) — check `modules/guest_booking/mod.rs`; adjust the test to the exported path.

- [ ] **Step 2:** `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` → regenerates `docs/api/openapi.json`; then `cargo test --all-features --test openapi_drift` clean PASS.

- [ ] **Step 3:** `cargo check --all-features && cargo clippy --all-features -- -D warnings && cargo test --all-features` — lib tests pass; report the real pass count (a DB-less run is ~209).

- [ ] **Step 4: Commit** — `test(inventory): live range/bulk round-trip + openapi drift regen`.

---

### Task 4: Frontend — types, api, constants, utils (+tests)

**Files:**
- Modify: `hotel-web-fe/src/features/onlineInventory/types.ts`
- Modify: `hotel-web-fe/src/features/onlineInventory/api.ts`
- Create: `hotel-web-fe/src/features/onlineInventory/constants.ts`
- Create: `hotel-web-fe/src/features/onlineInventory/utils.ts`
- Test: `hotel-web-fe/src/features/onlineInventory/utils.test.ts`

**Interfaces** — produces everything later tasks import:

```ts
// types.ts
export interface OnlineInventoryAllocation {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical_available_rooms: number;
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
  standard_price: string;
  is_override: boolean;
  online_available_rooms: number;
}

export interface EditableCell {
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
}

export type StagedEdit = { type: 'set'; value: EditableCell } | { type: 'reset' };

export type CellKey = string; // `${room_type_id}:${stay_date}`

export interface GridCellView {
  key: CellKey;
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical: number;
  saved: EditableCell;
  current: EditableCell;       // saved ⊕ staged
  standard_price: string;
  effective_price: string;     // current.custom_price ?? standard_price
  online_available: number;    // from current
  changed: boolean;
  is_reset: boolean;
  is_override: boolean;        // server truth
}

export interface CellUpdateInput {
  room_type_id: number;
  stay_date: string;
  reset?: boolean;
  walk_in_reserved_rooms?: number;
  online_booking_enabled?: boolean;
  custom_price?: string | null;
}
```

```ts
// api.ts (replace file)
import { api } from '../../api/client';
import type { CellUpdateInput, OnlineInventoryAllocation } from './types';

export const getOnlineInventoryRange = (from: string, to: string) =>
  api.get('admin/online-inventory', { searchParams: { from, to } })
    .json<OnlineInventoryAllocation[]>();

export const bulkUpdateOnlineInventory = (cells: CellUpdateInput[]) =>
  api.put('admin/online-inventory/bulk', { json: { cells } })
    .json<OnlineInventoryAllocation[]>();
```

```ts
// constants.ts
export const GRID_DAYS = 14;
```

```ts
// utils.ts — implement exactly; all pure, all tested
cellKey(roomTypeId, date) / parseCellKey(key)
shiftDate(date, days)              // moved verbatim from OnlineInventoryPage
dateRange(from, count)             // [shiftDate(from, i)]
weekdayOf(date)                    // 0=Mon..6=Sun
editableOf(a)                      // pick the three editable fields
DEFAULT_EDIT: EditableCell         // {0, true, null}
comparablePrice(v) / editsEqual(a, b)
isRealChange(saved, edit)          // set → !editsEqual(edit.value, editableOf(saved));
                                   // reset → saved.is_override || !editsEqual(editableOf(saved), DEFAULT_EDIT)
buildCellView(saved, edit) → GridCellView
roundMoney(n)                      // Math.round((n + Number.EPSILON) * 100) / 100

type BulkAction =
  | { kind: 'set_enabled'; enabled: boolean }
  | { kind: 'set_hold'; rooms: number }
  | { kind: 'set_price'; price: string }
  | { kind: 'adjust_price_percent'; percent: number }
  | { kind: 'adjust_price_amount'; amount: string }
  | { kind: 'reset' };

interface BulkProjection { edits: Map<CellKey, StagedEdit>; skipped: number }
projectBulkAction(targets: GridCellView[], action, weekdays: ReadonlySet<number> | null)
  // operates on view.current as base; adjust_* uses effective_price;
  // results ≤ 0 are skipped and counted; 'reset' stages {type:'reset'}

toCellUpdateInputs(edits: Map<CellKey, StagedEdit>) → CellUpdateInput[]
rectKeys(a, b, roomTypeIds, dates) → CellKey[]      // rectangle for shift-select/drag

interface SummaryRun { from: string; to: string; lines: string[] }
interface EditSummaryGroup { roomTypeId: number; name: string; code: string; runs: SummaryRun[] }
summarizeEdits(edits, saved: Map<CellKey, OnlineInventoryAllocation>, formatPrice: (v: string) => string)
  // group by room_type (order by name), sort by date, collapse contiguous
  // dates whose StagedEdit is identical (editsEqual / both reset); per run
  // describe the delta vs the first cell's saved state:
  //   reset → 'Reset to standard rules'
  //   enabled flip → 'Close online' | 'Reopen online'
  //   hold change → `Hold ${n} (was ${m})`
  //   price change → `Price ${formatPrice(v)} (was ${…|standard})` | 'Price → standard rate'
```

- [ ] **Step 1: Failing test** `utils.test.ts` — cover: `dateRange` length/ordering across month boundary; `weekdayOf`; `isRealChange` for set/reset/no-op; `buildCellView` fields (effective_price falls back to standard, online_available clamps at 0, changed flags); `projectBulkAction` weekday filtering + `adjust_price_percent` rounding + skip-on-≤0; `toCellUpdateInputs` reset shape; `summarizeEdits` run collapsing across non-contiguous dates.

- [ ] **Step 2:** `bun run test -- onlineInventory` → FAIL.

- [ ] **Step 3:** Implement `utils.ts` per the spec comments above.

- [ ] **Step 4:** tests PASS; `bun run typecheck` clean.

- [ ] **Step 5: Commit** — `feat(inventory): grid domain types and pure helpers`.

---

### Task 5: Frontend — `useOnlineInventory` rework

**Files:**
- Modify: `hotel-web-fe/src/features/onlineInventory/hooks/useOnlineInventory.ts` (rewrite)
- Test: `hotel-web-fe/src/features/onlineInventory/hooks/useOnlineInventory.test.ts`

**Interface:**

```ts
useOnlineInventory(from: string, to: string) → {
  roomTypes: { room_type_id: number; room_type_code: string; room_type_name: string }[]; // order preserved
  dates: string[];                        // sorted unique stay_dates present
  cells: Map<CellKey, GridCellView>;
  edits: Map<CellKey, StagedEdit>;
  changedCount: number;
  isLoading: boolean; isSaving: boolean;
  error: string | null;
  successMessage: string | null;
  clearSuccessMessage(): void;
  stageCell(key: CellKey, edit: StagedEdit): void;          // unstages if !isRealChange
  stageMany(entries: Iterable<[CellKey, StagedEdit]>): void;
  discardChanges(): void;
  saveChanges(): Promise<boolean>;          // true on full success
  reload(): void;
}
```

- [ ] **Step 1: Failing test** — mock `../api` with `vi.mock`; cover: load populates cells/roomTypes/dates; `stageCell` adds an edit and drops a no-op; `discardChanges` restores; `saveChanges` calls `bulkUpdateOnlineInventory` once with `toCellUpdateInputs(edits)`, merges returned rows into `savedCells`, clears edits, sets success message; failure keeps edits and sets error.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `savedCells: Map<CellKey, OnlineInventoryAllocation>` state; `edits` overlay; `cells` memo = `buildCellView(saved, edits.get(key))`; `stageCell`/`stageMany` filter through `isRealChange` against `savedCells`; `saveChanges` → single `bulkUpdateOnlineInventory(toCellUpdateInputs(edits))`, on success merge returned rows + clear edits + `` `${n} cell(s) updated` `` message (n = submitted count), on failure set error and keep edits.

- [ ] **Step 4:** tests PASS.

- [ ] **Step 5: Commit** — `feat(inventory): staged-edit state model for range inventory`.

---

### Task 6: Frontend — `useGridSelection`

**Files:**
- Create: `hotel-web-fe/src/features/onlineInventory/hooks/useGridSelection.ts`
- Test: `hotel-web-fe/src/features/onlineInventory/hooks/useGridSelection.test.ts`

**Interface:**

```ts
useGridSelection(roomTypeIds: number[], dates: string[]) → {
  anchor: CellKey | null;
  focused: CellKey | null;
  selected: ReadonlySet<CellKey>;
  isSelected(key: CellKey): boolean;
  selectCell(key: CellKey, extend: boolean): void;   // extend → rect(anchor,key)
  moveFocus(key: CellKey, extend: boolean): void;
  selectRow(roomTypeId: number): void;              // all `dates` cells of that type
  selectColumn(date: string): void;                 // all room types for that date
  clear(): void;
  setSelected(keys: Iterable<CellKey>): void;
}
```

- [ ] **Step 1: Failing test** — click-select sets anchor+single; shift-select produces the rectangle via `rectKeys`; `selectRow`/`selectColumn` produce the full line; `clear` empties; `moveFocus` extends only with `extend`.

- [ ] **Step 2–5:** fail → implement (state only; rectangles via `rectKeys` from utils) → pass → commit `feat(inventory): grid selection model`.

---

### Task 7: Frontend — `GridCell` + `InventoryGrid` (ARIA grid, keyboard nav)

**Files:**
- Create: `hotel-web-fe/src/features/onlineInventory/components/GridCell.tsx`
- Create: `hotel-web-fe/src/features/onlineInventory/components/InventoryGrid.tsx`
- Test: `hotel-web-fe/src/features/onlineInventory/components/InventoryGrid.test.tsx`

**`GridCell`** — pure render of one `GridCellView` inside a `<td>`:

```tsx
interface GridCellProps {
  view: GridCellView;
  selected: boolean;
  focused: boolean;          // drives roving tabIndex
  domId: string;
  tabIndex: 0 | -1;
  onSelect(key: CellKey, extend: boolean): void;
  onOpen(key: CellKey): void;
  onFocusCell(key: CellKey, extend: boolean): void;
  onDragTo(key: CellKey): void;         // pointer-enter while dragging
  onDragStart(key: CellKey): void;
}
```

Content: bold `view.online_available`; price line — `view.effective_price`,
custom prices in a tinted `Chip`-like pill; `!current.online_booking_enabled` →
`LockOutlinedIcon` + "Closed" text; `online_available === 0 && enabled` →
warning tint + "None left" caption; `changed` → 8px accent dot top-right;
`is_override && !changed` → subtle 4px border-accent marker. `aria-label`:
`"{name}, {weekday day month}: {n} online at {price}{, closed}{, modified}"`.
`aria-selected={selected}`.

**`InventoryGrid`** — `<table role="grid" aria-label="Online inventory by room type and date">`:

- Header `<tr>`: corner `<th>` (empty, scope=col) + one `<th scope="col">` per
  date containing a full-bleed `<button>` (weekday abbrev + day number; today
  gets a "Today" caption) — button `onClick` → `selectColumn`.
- Row: `<th scope="row">` with select-row `<button>` (type name + code chip +
  "{physical} free" caption), then 14 `<td role="gridcell">` rendered via
  `GridCell`.
- Keyboard on each cell: `Arrow*` → `onFocusCell(neighbor)`; `Shift+Arrow*` →
  neighbor + `extend: true`; `Enter`/`Space` → `onOpen(key)`; `Escape` →
  `clear()`. Grid keeps `Map<CellKey, HTMLTableCellElement>` via ref callback;
  `useEffect` focuses the element when `focused` prop changes.
- Pointer drag: `onPointerDown` → `onDragStart(key)` (set anchor+select);
  `onPointerEnter` while a module-level drag flag (grid state, set on
  pointerdown, cleared on window `pointerup`) is set → `onDragTo(key)` →
  `moveFocus(key, true)`.
- Props: `{ roomTypes, dates, cells, selected, focused, onSelectCell, onMoveFocus, onSelectRow, onSelectColumn, onOpenEditor, onClearSelection, formatPrice }`.
- Min cell size 44×44 via `minWidth/height` on the td + padding; visible
  `:focus-visible` outline via `sx`; selected cells get `outlined` accent border
  + tint that keeps text at 7:1 (use `primary.dark` text on light tint, not
  white-on-primary).

- [ ] **Step 1: Failing test** — render a 2×14 fixture via `buildCellView`; assert `role="grid"` + `row`/`gridcell`/`columnheader`/`rowheader` counts; cell `aria-label` text; arrow-key moves `focused`; Enter fires `onOpenEditor`; header buttons call `selectColumn`/`selectRow`; selected cell has `aria-selected="true"`.

- [ ] **Step 2–5:** fail → implement → pass → commit `feat(inventory): accessible 14-day grid`.

---

### Task 8: Frontend — `CellEditorPopover`

**Files:**
- Create: `hotel-web-fe/src/features/onlineInventory/components/CellEditorPopover.tsx`
- Test: `hotel-web-fe/src/features/onlineInventory/components/CellEditorPopover.test.tsx`

MUI `Popover` anchored to the cell element; local draft state initialized from
`view.current`. Contents: `Switch` "Bookable online" (with Online/Offline
caption); hold stepper (− / value / +, ≥0, soft-warn text when `> physical`);
price `TextField` (number, `custom_price ?? ''`, blank→null, `InputAdornment`
currency symbol, helper `"Standard rate for this date: {formatPrice(standard)}"`,
error when `<= 0` or >2dp); Apply + Cancel buttons. Apply → `onApply(key, { type:'set', value: draft })`. Esc/backdrop closes without staging (Popover
default). Focus returns to the cell on close (Popover handles it).

- [ ] **Steps:** failing render/apply/validation test → implement → pass → commit `feat(inventory): cell editor popover`.

---

### Task 9: Frontend — `BulkEditPanel`

**Files:**
- Create: `hotel-web-fe/src/features/onlineInventory/components/BulkEditPanel.tsx`
- Test: `hotel-web-fe/src/features/onlineInventory/components/BulkEditPanel.test.tsx`

Rendered above the grid when `selected.size > 0`. Contents:

- Header: "{n} cells selected" + Clear-selection button.
- Action `ToggleButtonGroup exclusive`: Open online / Close online / Hold… /
  Price… / Adjust… / Reset.
- Conditional inputs: hold `TextField` (int ≥0); price `TextField` (>0 ≤2dp);
  adjust: `ToggleButtonGroup` % vs amount + numeric field.
- "Weekdays" row: seven small toggle chips Mon–Sun; none checked = all days.
- Apply → build the `BulkAction`, call
  `projectBulkAction(selectedViews, action, weekdaySet)` → `onApply(edits)`;
  surface `{skipped} cells skipped (price would be ≤ 0)` inline when > 0.
- `formatPrice` used in labels ("Set price to …" preview).

- [ ] **Steps:** failing test (weekday filter applied to projection call; validation messages; skipped-count render) → implement → pass → commit `feat(inventory): bulk edit panel`.

---

### Task 10: Frontend — `ReviewChangesDialog`, `GridToolbar`, `InventorySummary` rework

**Files:**
- Create: `…/components/ReviewChangesDialog.tsx`
- Create: `…/components/GridToolbar.tsx`
- Modify: `…/components/InventorySummary.tsx` + its test

**`ReviewChangesDialog`** — MUI `Dialog` (`maxWidth="sm" fullWidth`): title
"Review changes"; per `EditSummaryGroup` a section — room type name + code,
then each `SummaryRun` as `"{from}–{to}: line · line · line"` (single date:
just the date); footer Cancel / "Apply N changes" (confirm shows total staged
cell count). `onConfirm` → `saveChanges()`; `isSaving` disables confirm and
shows spinner.

**`GridToolbar`** — props `{ start, onStartChange, onRefresh, refreshing, overridesOnly, onToggleOverrides, selectedCount }`. Contents: `«14` `‹` icon buttons, start-date `TextField type="date"`, `›` `14»`, "Today" button (hidden when start==today), `FilterChip`-style "Overrides only" toggle, Refresh button, selection count caption. All icon buttons get `aria-label`s.

**`InventorySummary`** — props become `{ cells: { physical: number; held: number; online: number }[]; label?: string }`; sums the three fields; helper text says "room-nights"; `label` default "Visible window" (page passes "Selected cells" when a selection exists). Update `InventorySummary.test.tsx` to the new prop shape (same three assertions, new fixtures).

- [ ] **Steps:** failing tests for dialog grouping render + toolbar callbacks + reworked summary → implement → pass → commit `feat(inventory): review dialog, toolbar, window summary`.

---

### Task 11: Frontend — page composition + cleanup + gates

**Files:**
- Modify: `hotel-web-fe/src/features/onlineInventory/pages/OnlineInventoryPage.tsx` (rewrite)
- Delete: `hotel-web-fe/src/features/onlineInventory/components/InventoryRoomCard.tsx`
- Test: `hotel-web-fe/src/features/onlineInventory/pages/OnlineInventoryPage.test.tsx`

**Page composition** (orchestration only):

```tsx
const today = formatLocalDate();
const [start, setStart] = useState(today);
const dates = useMemo(() => dateRange(start, GRID_DAYS), [start]);
const inv = useOnlineInventory(start, dates[GRID_DAYS - 1]);
const sel = useGridSelection(inv.roomTypes.map(r => r.room_type_id), inv.dates);
const [editorKey, setEditorKey] = useState<CellKey | null>(null);
const [editorAnchor, setEditorAnchor] = useState<HTMLElement | null>(null);
const [reviewOpen, setReviewOpen] = useState(false);
const [overridesOnly, setOverridesOnly] = useState(false);
```

- `visibleDates` = `overridesOnly ? dates.filter(d => any cell in column has is_override||changed) : dates` — pass to grid (never collapse to zero columns: if filter empties the set, show all).
- Selected views = `[...sel.selected].map(k => inv.cells.get(k)).filter(Boolean)` → feed `BulkEditPanel` (onApply → `inv.stageMany(edits)`; keep selection after apply).
- Floating bar (existing pattern, kept): "{n} cells changed" → Discard / Review & apply (opens dialog) → on confirm `saveChanges()`; close dialog on success.
- Confirm-discard before window nav/refresh when `changedCount > 0` (existing `confirmDiscard` pattern, kept verbatim).
- Editor: `onOpenEditor(key, el)` stores key+anchor; `CellEditorPopover` gets `view = inv.cells.get(editorKey)`; `onApply` → `inv.stageCell` + close.
- `formatPrice` via `useCurrency().format` — wrap to accept `string` (`Number(v)`), memoized.
- Keep the page header ("Online availability" + subtitle updated to mention the 14-day grid), error `Alert`, loading/empty states, success `Snackbar`, and `aria-live` region for save results.
- Focus management: after editor closes, return focus to the cell (grid's focus effect already handles it via `focused` key).

**Delete** `InventoryRoomCard.tsx` (grep confirms the page was its only importer).

**Test** — `OnlineInventoryPage.test.tsx`: mock `../api`; render; assert grid appears with room-type rows; stage a cell via the editor and assert the floating bar shows "1 cell changed"; confirm path calls bulk endpoint once.

- [ ] **Steps:** failing test → implement → `bun run typecheck && bun run lint && bun run test && bun run build` all green → commit `feat(inventory): 14-day matrix page for online pricing control`.

---

## Self-review notes

- Spec coverage: range GET (T1), bulk PUT+audit+events (T2), live test+openapi (T3), FE types/api/utils (T4), state hook (T5), selection (T6), grid+cell ARIA (T7), editor (T8), bulk panel (T9), review/toolbar/summary (T10), page+cleanup+gates (T11). Overrides filter = Task 11 `overridesOnly`. Single-PUT audit = Task 2.
- Type consistency: `StagedEdit`, `GridCellView`, `BulkAction`, `CellUpdateInput` names are identical across tasks; `projectBulkAction` consumes `GridCellView[]` everywhere.
- Weekday encoding: `weekdayOf` returns 0=Mon..6=Sun everywhere (utils + panel chips).
