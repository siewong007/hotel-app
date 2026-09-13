# Guest Relations Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn guest management into a Guest Relations workspace: wire up the orphaned `guest_notes`/`guest_preferences`/`guest_reviews` tables, expose dormant CRM columns on `guests`, add staff-initiated support conversations, and replace the monolithic `/guest-config` page with a redesigned list plus a tabbed Guest-360 page.

**Architecture:** New backend domain `src/modules/guest_relations/` (module layout per AGENTS.md) serving `/guests/{id}/...` sub-resource endpoints; `modules/support` gains a staff-create route; one additive DB patch (`0019`); new frontend feature `src/features/guestRelations/` with a list page at `/guest-relations/guests` and a 360 page at `/guest-relations/guests/$guestId`. Canonical owners stay canonical: loyalty/vouchers/comms/support/bookings are read-and-link only.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL (runtime-checked queries, `param!`/`AssertSqlSafe` style), React 19/TS/MUI v9/TanStack Query+Router, bun.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-13-guest-relations-design.md` (authoritative boundary table — read it first).
- Backend minimum gate: `cargo check --all-features`; CI gate: `cargo clippy --all-features -- -D warnings`.
- Integration tests need `DATABASE_URL`; judge by run count (~513 pass full suite), never exit code.
- Patch registration is enforced: `manifest.tsv` + `.github/workflows/deploy.yml` + `deploy/deploy.sh` + `.github/workflows/deploy-staging.yml` + `deploy/deploy-staging.sh` + four hardcoded spots in `tests/postgres_patch_lifecycle.rs`.
- Baseline + `seed.sql` must mirror every schema/seed change for fresh installs. Never edit a shipped patch; never recompute the V1 lineage checksum.
- Business-day math uses `hotel_today(executor)` / `core/sql_compat.rs` helpers — never `chrono::Local`/`Utc` dates.
- Parameterized SQL only; free text through `Sanitizer`; mutations logged via `AuditLog::log_event` (details auto-redact sensitive keys — still don't build details from secrets).
- FE: all HTTP via `src/api/client.ts` (`api`), never `fetch`. Dates via `src/utils/date.ts` (`toISOString().split/slice` is lint-banned). New pages go in `src/routes/*.tsx` AND `src/navigation/routeRegistry.tsx`.
- Tree has another session's dirty files (`promotions/repository.rs`, `tests/promotions_admin.rs`, `models/user.rs`, `repositories/user.rs`, `services/users.rs`, `seed_voucher_audit.sql`, `core/auth.rs`, `services/audit.rs`) — never stage/revert them; `git add` only files this plan touched.
- Branch: `guest-relations/2026-09-13` (already created off `insights-admin/2026-09-13`).

---

### Task 1: DB patch `0019_guest_relations.sql` + registration

**Files:**
- Create: `hotel-app-be/database/postgres/patches/0019_guest_relations.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv` (append row)
- Modify: `.github/workflows/deploy.yml`, `deploy/deploy.sh`, `.github/workflows/deploy-staging.yml`, `deploy/deploy-staging.sh` (append `cp`/`apply` lines next to the `0018_*` lines)
- Modify: `hotel-app-be/tests/postgres_patch_lifecycle.rs` — four spots: `BETWEEN 2 AND 18` → `BETWEEN 2 AND 19` at lines ~573 and ~1718; `assert_eq!(revisions.len(), 17)` → `18` at ~657; append `(19, "guest-relations", "<sha256>")` to the expected-revisions list in `assert_expected_revisions`.

**Interfaces:**
- Produces: `guest_notes` columns `subject`, `interaction_type`, `booking_id`, `follow_up_at`, `follow_up_completed_at`, `assigned_to`; unique index `uq_guest_preferences_key` on `(guest_id, category, preference_key)`; expanded `support_conversations_category_check`; `support_categories` setting gains `service_request`/`complaint`; permission `guests:reveal`; route policies `guest-relations` + `guest-relations-detail`.

- [ ] **Step 1: Write the patch file**

Follow the `0010_consent_records.sql` idempotent `DO` pattern. Content:

```sql
-- Guest Relations: interaction log fields on guest_notes, preference upsert
-- key, service_request/complaint support categories, guests:reveal permission,
-- and route policies for the /guest-relations workspace.
--
-- The DDL below is byte-identical to the block added to the V1 baseline for
-- fresh installs. Every step is individually guarded.
DO $guest_relations$
BEGIN
    IF to_regclass('public.guest_notes') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: guest_notes is missing';
    END IF;
    IF to_regclass('public.guest_preferences') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: guest_preferences is missing';
    END IF;
    IF to_regclass('public.support_conversations') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: support_conversations is missing';
    END IF;

    -- guest_notes becomes the guest interaction log.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='subject') THEN
        ALTER TABLE public.guest_notes ADD COLUMN subject character varying(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='interaction_type') THEN
        ALTER TABLE public.guest_notes
            ADD COLUMN interaction_type character varying(50) NOT NULL DEFAULT 'note';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='booking_id') THEN
        ALTER TABLE public.guest_notes ADD COLUMN booking_id bigint;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='follow_up_at') THEN
        ALTER TABLE public.guest_notes ADD COLUMN follow_up_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='follow_up_completed_at') THEN
        ALTER TABLE public.guest_notes ADD COLUMN follow_up_completed_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='assigned_to') THEN
        ALTER TABLE public.guest_notes ADD COLUMN assigned_to bigint;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='guest_notes_interaction_type_check') THEN
        ALTER TABLE public.guest_notes ADD CONSTRAINT guest_notes_interaction_type_check
            CHECK (interaction_type IN ('note','call','email','in_person','follow_up'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='idx_guest_notes_guest_created') THEN
        CREATE INDEX idx_guest_notes_guest_created
            ON public.guest_notes (guest_id, created_at DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='idx_guest_notes_follow_up_open') THEN
        CREATE INDEX idx_guest_notes_follow_up_open
            ON public.guest_notes (follow_up_at)
            WHERE follow_up_at IS NOT NULL AND follow_up_completed_at IS NULL;
    END IF;

    -- Preference upsert key. Dedup defensively before creating the index.
    DELETE FROM public.guest_preferences a
    USING public.guest_preferences b
    WHERE a.guest_id = b.guest_id AND a.category = b.category
      AND a.preference_key = b.preference_key AND a.id < b.id;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='uq_guest_preferences_key') THEN
        CREATE UNIQUE INDEX uq_guest_preferences_key
            ON public.guest_preferences (guest_id, category, preference_key);
    END IF;

    -- Support categories: service_request + complaint ride the same workflow.
    ALTER TABLE public.support_conversations
        DROP CONSTRAINT IF EXISTS support_conversations_category_check;
    ALTER TABLE public.support_conversations
        ADD CONSTRAINT support_conversations_category_check
        CHECK (category IN ('booking','stay','billing','loyalty','technical','other','service_request','complaint'));

    UPDATE public.system_settings
    SET setting_value = '["booking","stay","billing","loyalty","technical","other","service_request","complaint"]'::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE setting_key = 'support_categories'
      AND NOT (setting_value @> '"service_request"'::jsonb);

    -- Sensitive guest field reveal permission; admin/super_admin pick it up via
    -- their all-permissions grant. Manager explicitly.
    INSERT INTO public.permissions (name, resource, action, description, is_system_permission)
    VALUES ('guests:reveal', 'guests', 'reveal',
            'Reveal sensitive guest identification fields', true)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
    WHERE r.name IN ('admin','super_admin','manager') AND p.name = 'guests:reveal'
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Navigation policies for the Guest Relations workspace.
    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
    ) VALUES
        ('guest-relations', '/guest-relations/guests', 'Guest Relations', 'operations',
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
        ('guest-relations-detail', '/guest-relations/guests/$guestId', NULL, NULL,
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, false, true)
    ON CONFLICT (route_id) DO UPDATE SET
        path = EXCLUDED.path,
        nav_label = EXCLUDED.nav_label,
        nav_group = EXCLUDED.nav_group,
        required_permissions = EXCLUDED.required_permissions,
        required_roles = EXCLUDED.required_roles,
        excluded_roles = EXCLUDED.excluded_roles,
        nav_permissions = EXCLUDED.nav_permissions,
        nav_roles = EXCLUDED.nav_roles,
        nav_excluded_roles = EXCLUDED.nav_excluded_roles,
        is_navigation = EXCLUDED.is_navigation,
        is_system_policy = EXCLUDED.is_system_policy,
        updated_at = CURRENT_TIMESTAMP;
END;
$guest_relations$;
```

Verify the exact `permissions`/`role_permissions`/`route_access_policies`/`system_settings` column names against `seed.sql` before committing to them (read the INSERT statements there — `setting_key` vs `key` etc. must match).

- [ ] **Step 2: Register the patch everywhere**

- Append to `manifest.tsv` (tab-separated): `1\t19\tguest-relations\tsha256:<sha256 of file>\t0019_guest_relations.sql`. Compute with `shasum -a 256 hotel-app-be/database/postgres/patches/0019_guest_relations.sql`. Check `postgres_patch_catalog.rs` for whether the checksum covers the file verbatim — match whatever hashing the catalog test uses.
- `deploy.yml` + `deploy.sh` + `deploy-staging.yml` + `deploy-staging.sh`: copy the `0018_*` lines verbatim for `0019_guest_relations.sql`.
- `postgres_patch_lifecycle.rs`: bump both `BETWEEN 2 AND 18` → `2 AND 19`, `revisions.len()` 17 → 18, append `(19, "guest-relations", "sha256:<same>")` to the expected list.

- [ ] **Step 3: Verify**

Run: `cargo test --all-features --test postgres_patch_catalog` (no DB needed — catalog checks are static)
Expected: PASS. If `DATABASE_URL` is set also run `--test postgres_patch_lifecycle` and expect PASS.

- [ ] **Step 4: Commit**

`git add` the patch + manifest + deploy files + lifecycle test. `git commit -m "feat(db): guest relations patch — interaction notes, preference upsert, support categories, guests:reveal"`.

---

### Task 2: Mirror patch into baseline + seed.sql

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Modify: `hotel-app-be/database/postgres/seed.sql`

- [ ] **Step 1: Baseline** — apply the same column additions inside the `CREATE TABLE public.guest_notes` block (lines ~2681-2691) so fresh installs match; add the same CHECK constraint + indexes + unique index after their table definitions; update `support_conversations_category_check` (line ~4740) to the 8-value list.
- [ ] **Step 2: seed.sql** — add `('guests:reveal')` to the permission-name insert (alphabetical, near line ~90); add the detail row `('guests:reveal', 'guests', 'reveal', 'Reveal sensitive guest identification fields', true)` near line ~480; add `'guests:reveal'` to the manager role grant list (~line 558 block); update the `support_categories` setting row (~line 864) to the 8-value array; add the two `route_access_policies` rows to the big policy insert (~line 1114 block).
- [ ] **Step 3: Verify** — `cargo test --all-features --test postgres_patch_lifecycle` (needs `DATABASE_URL`; compares baseline+patch chain). Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat(db): baseline + seed mirror of guest relations patch"`.

---

### Task 3: Guest model + repository field exposure

**Files:**
- Modify: `hotel-app-be/src/models/guest.rs`
- Modify: `hotel-app-be/src/repositories/guest.rs` (`find_by_id`, `update_detailed`, `update_state` selects; NOT `find_paginated` — list payload stays unchanged)
- Modify: `hotel-app-be/src/services/guests.rs` (`update_guest` signature gains `user_id`; `guest_profile` gains reveal gating)
- Modify: `hotel-app-be/src/handlers/guests.rs`, `hotel-app-be/src/routes/guests.rs` (thread `user_id` into update)

**Interfaces:**
- `Guest` gains (all `#[sqlx(default)]` + `#[serde(default, skip_serializing_if = "Option::is_none")]`): `vip_status: Option<String>`, `tags: Option<Vec<String>>`, `job_title: Option<String>`, `notes: Option<String>`, `special_requests: Option<String>`, `marketing_opt_in: Option<bool>`, `communication_preference: Option<String>`, `language_preference: Option<String>`, `is_blacklisted: Option<bool>`, `blacklist_reason: Option<String>`.
- `GuestUpdateInput` gains `Option<>`s: `vip_status`, `tags: Option<Vec<String>>`, `job_title`, `notes`, `special_requests`, `marketing_opt_in`, `communication_preference`, `language_preference`, `is_blacklisted`, `blacklist_reason`, plus sensitive `date_of_birth`, `id_type`, `id_number`, `id_expiry`, `id_country`.
- `GuestProfile` gains `sensitive: Option<GuestSensitiveProfile>` where `GuestSensitiveProfile { date_of_birth, id_type, id_number, id_expiry, id_country }` — populated only when caller holds `guests:reveal`.
- `update_guest(pool, user_id, guest_id, input)` — sensitive fields rejected with `ApiError::Forbidden` unless `guests:reveal`; all extended fields require the existing `guests:update` (enforced at route).

- [ ] **Step 1:** Add the new fields to `Guest`, `GuestUpdateInput`, `GuestUpdateState`, `GuestUpdateValues`, and new `GuestSensitiveProfile` + `GuestProfile.sensitive`. Model the sensitive input fields as `Option<...>`; treat `Some(_)` without `guests:reveal` as Forbidden.
- [ ] **Step 2:** Extend `find_by_id`'s SELECT with the new columns; extend `update_state` + `update_detailed` to round-trip them (include the sensitive columns too — they're written only when permitted). `find_paginated`'s `select_cols` stays as-is (defaults cover the gap).
- [ ] **Step 3:** In `update_guest`, resolve each new field `input.or(existing)`; gate the five sensitive fields behind `AuthService::check_permission(pool, user_id, "guests:reveal")`. Sanitize free text (`Sanitizer::sanitize_text`); bound `tags` (≤20 items, each ≤50 chars after sanitize) and `vip_status` to the existing value vocabulary — check how `vip_status` is consumed in `repositories/guest_portal.rs`/`bookings` first and reuse that vocabulary.
- [ ] **Step 4:** `guest_profile(pool, user_id, guest_id)` — fetch `GuestSensitiveProfile` when `guests:reveal` holds; wire through `get_guest_profile_handler` + route (add `Extension(user_id)`).
- [ ] **Step 5:** Verify — `cargo check --all-features && cargo clippy --all-features -- -D warnings`. Expected: clean.
- [ ] **Step 6:** Commit — `git commit -m "feat(guests): expose CRM profile fields with reveal gating for sensitive identifiers"`.

---

### Task 4: `guest_relations` module — models + validation

**Files:**
- Create: `hotel-app-be/src/modules/guest_relations/mod.rs` (`pub mod routes; pub mod handlers; pub mod service; pub mod repository; pub mod models; pub mod validation;`)
- Create: `hotel-app-be/src/modules/guest_relations/models.rs`
- Create: `hotel-app-be/src/modules/guest_relations/validation.rs`
- Modify: `hotel-app-be/src/modules/mod.rs` (add `pub mod guest_relations;`) — check actual file: module decls may live in `main.rs`/`lib.rs`; grep `pub mod support` to find the right spot.

**Interfaces — `models.rs`:**

```rust
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// A staff-authored guest interaction or note (guest_notes row).
#[derive(Debug, Clone, Serialize)]
pub struct GuestInteraction {
    pub id: i64,
    pub guest_id: i64,
    pub interaction_type: String,   // note|call|email|in_person|follow_up
    pub note_type: String,
    pub subject: Option<String>,
    pub content: String,
    pub booking_id: Option<i64>,
    pub is_alert: bool,
    pub is_private: bool,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub follow_up_completed_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub created_by: Option<i64>,
    pub created_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestInteractionInput {
    pub interaction_type: Option<String>,
    pub subject: Option<String>,
    pub content: String,
    pub booking_id: Option<i64>,
    pub is_alert: Option<bool>,
    pub is_private: Option<bool>,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct GuestInteractionUpdate {
    pub subject: Option<String>,
    pub content: Option<String>,
    pub interaction_type: Option<String>,
    pub is_alert: Option<bool>,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub follow_up_completed: Option<bool>, // sets/clears follow_up_completed_at
    pub assigned_to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub include_completed_followups: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestPreference {
    pub id: i64,
    pub category: String,
    pub preference_key: String,
    pub preference_value: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestPreferenceEntry {
    pub category: String,
    pub preference_key: String,
    pub preference_value: String,
}

#[derive(Debug, Deserialize)]
pub struct GuestPreferencesPut {
    pub entries: Vec<GuestPreferenceEntry>,
    /// When true, keys absent from entries are deleted for the listed categories.
    pub replace_categories: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestReviewRow {
    pub id: i64,
    pub booking_id: Option<i64>,
    pub overall_rating: f64,
    pub title: Option<String>,
    pub content: Option<String>,
    pub response: Option<String>,
    pub response_at: Option<DateTime<Utc>>,
    pub is_published: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestReviewResponseInput {
    pub response: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestLoyaltySummary {
    pub member_number: String,
    pub status: String,
    pub tier_code: String,
    pub tier_name: String,
    pub available_points: i32,
    pub lifetime_points: i32,
    pub qualifying_nights: i32,
    pub recent_redemptions: Vec<GuestRedemptionRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestRedemptionRow {
    pub id: i64,
    pub reward_name: Option<String>,
    pub points: i32,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestVoucherRow {
    pub id: i64,
    pub code: String,
    pub status: String,
    pub source: String,
    pub promotion_id: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub redeemed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestCommunicationsSummary {
    pub marketing_opt_in: bool,
    pub communication_preference: Option<String>,
    pub language_preference: Option<String>,
    pub email_suppressed: bool,
    pub subscriptions: Vec<GuestSubscriptionRow>,
    pub recent_deliveries: Vec<GuestDeliveryRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestSubscriptionRow {
    pub channel: String,
    pub topic: String,
    pub subscribed: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestDeliveryRow {
    pub id: i64,
    pub kind: String,
    pub subject: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}
```

`validation.rs`: `validate_interaction_type` (allowlist, default `note`), `validate_preference_category` (allowlist `room|bed|floor|dietary|communication|occasion|other`, lowercase-normalized), `validate_key` (non-empty ≤100), `validate_value` (non-empty ≤2000, `Sanitizer::sanitize_text`). Unit tests inline (`#[cfg(test)]`) like `modules/support/validation.rs`.

- [ ] **Steps:** create files → `cargo check` → commit `feat(guest-relations): module models + validation`.

---

### Task 5: `guest_relations` repository

**Files:** Create `hotel-app-be/src/modules/guest_relations/repository.rs`.

Functions (all parameterized, `AssertSqlSafe` where dynamic):

- `list_interactions(pool, guest_id, viewer_user_id, can_manage, page, page_size) -> Result<(Vec<GuestInteraction>, i64)>` — `SELECT` notes joined to `users` twice (created_by→name, assigned_to→name); filter `guest_id`, and `is_private` rows only when `created_by = viewer OR can_manage`; order `created_at DESC, id DESC`; count with same visibility clause.
- `insert_interaction(pool, guest_id, input cols..., created_by) -> Result<i64>`
- `update_interaction(pool, note_id, GuestInteractionUpdate resolved cols) -> Result<bool>` — scoped `WHERE id = $n AND guest_id = $m`.
- `delete_interaction(pool, note_id, guest_id) -> Result<bool>`
- `interaction_exists_for_guest`, `booking_belongs_to_guest(pool, booking_id, guest_id) -> Result<bool>` (mirror `SupportRepository::booking_belongs_to_guest`)
- `list_preferences(pool, guest_id) -> Result<Vec<GuestPreference>>`
- `upsert_preference_tx(tx, guest_id, cat, key, value)` — `INSERT ... ON CONFLICT (guest_id, category, preference_key) DO UPDATE SET preference_value, updated_at` (requires the `uq_guest_preferences_key` index from Task 1 — on PG, `ON CONFLICT` matches the unique index).
- `delete_preferences_not_in_tx(tx, guest_id, categories, keep_keys)` for `replace_categories` semantics.
- `list_reviews(pool, guest_id) -> Result<Vec<GuestReviewRow>>`
- `respond_to_review(pool, review_id, guest_id, response, responder_id) -> Result<bool>` — sets `response/response_at/response_by`.
- `loyalty_summary(pool, guest_id)` — delegate: `crate::modules::loyalty::repository::LoyaltyRepository::member_by_guest(pool, guest_id)` + `redemptions_for_member(pool, member_id, 5)` (check exact signature at call site).
- `list_vouchers(pool, guest_id) -> Result<Vec<GuestVoucherRow>>` — straight select on `vouchers`.
- `list_subscriptions` — reuse `communications::repository::CommsRepository::list_subscriptions_for_guest` (check the struct name at call site).
- `list_recent_deliveries(pool, guest_id, limit)` — new small query on `email_deliveries` (add `AND guest_id = $1`, order `id DESC`).
- `is_email_suppressed` — reuse `communications` repo fn.
- `list_support_for_guest(pool, guest_id, limit)` — `SELECT` from `support_conversations` summary columns `WHERE guest_id = $1 ORDER BY last_activity_at DESC`. Reuse the summary row-mapping if it's `pub(crate)`; otherwise a compact local mapping.

- [ ] **Steps:** implement → `cargo check` → commit `feat(guest-relations): repository over guest notes/prefs/reviews + read joins to loyalty/vouchers/comms/support`.

---

### Task 6: `guest_relations` service + handlers + routes

**Files:** `service.rs`, `handlers.rs`, `routes.rs`; modify `routes/mod.rs::create_router` (`.merge(crate::modules::guest_relations::routes::routes())` next to the support merge).

Handler/RBAC table (mirror support handler style — `require_permission_helper` in route layer, `Extension(user_id)` into service):

| Route | Permission |
|---|---|
| `GET /guests/{id}/interactions` | `guests:read` |
| `POST /guests/{id}/interactions` | `guests:update` |
| `PATCH /guests/{id}/interactions/{nid}` | `guests:update` (+ author-or-manage for `is_private` rows) |
| `DELETE /guests/{id}/interactions/{nid}` | `guests:update` (+ same private rule) |
| `GET /guests/{id}/preferences` | `guests:read` |
| `PUT /guests/{id}/preferences` | `guests:update` |
| `GET /guests/{id}/reviews` | `reviews:read` |
| `POST /guests/{id}/reviews/{rid}/response` | `reviews:update` |
| `GET /guests/{id}/loyalty` | `guests:read` |
| `GET /guests/{id}/vouchers` | `guests:read` |
| `GET /guests/{id}/communications` | `communications:read` |
| `GET /guests/{id}/support` | `support:read` |

Service rules:
- Guest must exist (`GuestRepository::exists`) → 404 otherwise.
- `insert_interaction`: validate `booking_id` belongs to guest when present; sanitize subject/content; `interaction_type` via validation; audit `guest_interaction_created`.
- Private-note rule: when `is_private`, read/edit/delete allowed only to `created_by` or `guests:manage` — the repository already filters list; service re-checks on single-row mutations by fetching the row's `is_private`/`created_by`.
- Preferences PUT runs in a transaction; audit `guest_preferences_updated`.
- Review response: non-empty ≤2000, sanitize; audit `guest_review_responded`.
- Wrap list endpoints in `serde_json::json!`/`Json` responses shaped `{ data, total, page, page_size }` for interactions; plain arrays for the rest.

- [ ] **Steps:** implement → `cargo check && cargo clippy -D warnings` → commit `feat(guest-relations): endpoints for interactions/preferences/reviews/loyalty/vouchers/comms/support`.

---

### Task 7: Staff-initiated support conversation

**Files:**
- Modify: `hotel-app-be/src/modules/support/models.rs` — add `CreateStaffConversationRequest { guest_id: i64, category: String, subject: Option<String>, message: String, booking_id: Option<i64>, priority: Option<String>, assignee_id: Option<i64> }`.
- Modify: `service.rs` — add `create_staff_conversation(pool, hub, actor_user_id, request, ip, ua) -> Result<SupportConversationDetail>`: validate category (allow the extended list, still honor enabled `support_categories`), validate booking↔guest, sanitize message, `priority` validated against `low|normal|high|urgent` (default normal), `subject` default `subject_for_category`; transaction: `insert_conversation` (status `waiting_for_staff` — it lands in the staff queue), first `insert_message` with `author_type='staff'`/`author_user_id=Some(actor)`, `insert_event` `created`/`to_status=waiting_for_staff`, optional `assigned_to_user_id` via existing assign path (or set column directly in `insert_conversation` — check `NewConversation` fields; if no assignee field, follow with the existing assign action inside the same tx pattern); commit → `hub.publish` → audit `staff_support_conversation_created` → return staff detail.
- Modify: `handlers.rs` — `create_staff_conversation_handler` gated by `support:write` (use `require_permission_helper`); needs `Extension<SupportHub>` + `ConnectInfo` like the other staff handlers.
- Modify: `routes.rs` — `.route("/support/conversations", post(create_staff_conversation_handler))` added to the existing `get(...)` route (combine: `get(list).post(create)`).

- [ ] **Steps:** implement → `cargo check && clippy` → commit `feat(support): staff-initiated conversation creation`.

---

### Task 8: Guest list filters (`vip`, `blacklisted`, `has_open_support`)

**Files:** `models/guest.rs` (`GuestPaginationParams` += `vip: Option<bool>, blacklisted: Option<bool>, has_open_support: Option<bool>`), `repositories/guest.rs` `find_paginated`, FE service params (Task 11).

In `find_paginated`, extend `filter_clause`:
```rust
if params.vip.unwrap_or(false) {
    filter_clause.push_str(" AND vip_status IS NOT NULL AND vip_status <> ''");
}
if params.blacklisted.unwrap_or(false) {
    filter_clause.push_str(" AND is_blacklisted = true");
}
if params.has_open_support.unwrap_or(false) {
    filter_clause.push_str(
        " AND EXISTS (SELECT 1 FROM support_conversations sc \
         WHERE sc.guest_id = guests.id AND sc.status IN ('waiting_for_staff','waiting_for_guest'))");
}
```

- [ ] **Steps:** implement + unit test for clause construction if a pattern exists nearby → `cargo check` → commit `feat(guests): vip/blacklisted/open-support list filters`.

---

### Task 9: Backend integration tests `tests/guest_relations.rs`

Pattern: copy setup from `tests/guest_portal_postgres.rs` or `guests_rates_loyalty.rs` (check how they build `DATABASE_URL` pool + auth token). Cover:

- interactions CRUD + `interaction_type` validation + `is_private` visibility (author vs other staff vs `guests:manage`)
- follow-up complete/clear
- preferences PUT upsert + `replace_categories` delete
- reviews list + response (sets response_at/by)
- loyalty summary returns member/tier/points for a seeded member guest; 200-with-null/empty for non-member
- vouchers list shape
- communications summary (subscriptions + suppressed flag)
- support list filtered to guest + staff create (category `service_request`, `complaint` accepted post-patch; `waiting_for_staff` status; event row written)
- `guests:reveal` gating: profile sensitive fields absent for a `guests:read`-only user, present for admin; PATCH sensitive field forbidden without reveal
- new list filters (`vip`, `blacklisted`, `has_open_support`)

- [ ] **Steps:** write tests → run `DATABASE_URL=... cargo test --all-features --test guest_relations` → commit `test(guest-relations): integration coverage`.

---

### Task 10: OpenAPI drift + backend gates

- [ ] `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` (regenerates `docs/api/openapi.json`)
- [ ] `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`, full `cargo test --all-features` (verify run count ~513+)
- [ ] Commit `chore(api): openapi drift for guest relations endpoints`.

---

### Task 11: FE types + API service + hooks

**Files:**
- Modify: `hotel-web-fe/src/types/guest.types.ts` — extend `Guest`/`GuestUpdateRequest` with the new optional fields (`vip_status`, `tags`, `job_title`, `notes`, `special_requests`, `marketing_opt_in`, `communication_preference`, `language_preference`, `is_blacklisted`, `blacklist_reason`); new `GuestSensitiveProfile`; `GuestProfile.sensitive?: GuestSensitiveProfile | null`.
- Create: `hotel-web-fe/src/types/guestRelations.types.ts` — mirror the backend models (`GuestInteraction`, `GuestInteractionInput`, `GuestPreference`, `GuestReview`, `GuestLoyaltySummary`, `GuestVoucher`, `GuestCommunicationsSummary`, `GuestSupportConversationSummary` — reuse support feature's types if exported from `features/support/types.ts`).
- Modify: `hotel-web-fe/src/types/index.ts` barrel if types are re-exported there.
- Create: `hotel-web-fe/src/api/guestRelations.service.ts` — `GuestRelationsService` mirroring `guests.service.ts` style (`api.get/post/patch/put/delete`, `withRetry`, `toApiError`): `getInteractions`, `createInteraction`, `updateInteraction`, `deleteInteraction`, `getPreferences`, `putPreferences`, `getReviews`, `respondToReview`, `getLoyalty`, `getVouchers`, `getCommunications`, `getSupportConversations`, `createSupportConversation` (POST `support/conversations`).
- Modify: `src/api/queryKeys.ts` — add `guests.interactions(id)`, `guests.preferences(id)`, `guests.reviews(id)`, `guests.loyalty(id)`, `guests.vouchers(id)`, `guests.communications(id)`, `guests.support(id)`; add `guestRelations` root if cleaner.
- Modify: `src/api/guests.service.ts` — `getGuestsPage` params += `vip?: boolean; blacklisted?: boolean; has_open_support?: boolean`.
- Create: `src/features/guestRelations/hooks/useGuestRelationsQueries.ts` — `useGuestInteractions`, `useCreateInteraction`, `useUpdateInteraction`, `useDeleteInteraction`, `useGuestPreferences`, `usePutGuestPreferences`, `useGuestReviews`, `useRespondToReview`, `useGuestLoyalty`, `useGuestVouchers`, `useGuestCommunications`, `useGuestSupportConversations`, `useCreateSupportConversation`. Invalidate via `invalidateGuestDependencies(queryClient)` + the specific detail key.

- [ ] **Steps:** implement → `bun run typecheck` → commit `feat(fe): guest relations api layer + hooks`.

---

### Task 12: Guest list page `features/guestRelations/pages/GuestRelationsPage.tsx`

Replaces `GuestConfigurationPage` at a new route. Components:
- `pages/GuestRelationsPage.tsx` — search field (debounced via `useDebouncedValue`), filter chips row (All / Members / Non-members / Tourists / Missing info / Missing tourism / VIP / Blacklisted / Open requests — chips map to query params via a `segments.ts` util extending the existing `utils.ts` mapping), `DataTable`, pagination, `GuestFormDialog` (moved), `GuestProfileDialog` retained for quick peek? **No** — rows navigate to the 360 page; keep `GuestFormDialog` for create/edit.
- Columns: Guest (avatar initials + nick_name + legal name when different + id), Contact (email, phone), Type (Member chip, VIP chip), Last stay, Next stay, Alerts (open support count badge, blacklist icon, alert-note dot), Account (portal username active), Actions (View, Edit, New booking, ⋮ menu → tourism conversion, portal account, credits, eKYC, delete — preserve existing capabilities).
- States: skeleton rows while `isPending`, `EmptyState` for no guests, no-results-with-search variant, `Alert`+retry on error.
- Preserve from the monolith: stat tiles row (reuse `StatCard`/`StatStrip`), CSV export, tourism-conversion action, `MembershipPointsScanner` mount point if it's invoked from this page — check `GuestConfigurationPage` wiring and port what's still reachable.

- [ ] **Steps:** implement page + components → `bun run typecheck && bun run lint` → commit `feat(fe): guest relations list page`.

---

### Task 13: Guest 360 page shell + Overview + Stays

**Files:** `features/guestRelations/pages/GuestProfilePage.tsx`, `components/GuestProfileHeader.tsx`, `components/tabs/OverviewTab.tsx`, `components/tabs/StaysTab.tsx`.

- Route param `guestId` via `Route.useParams()`. Fetch `useGuestProfile(guestId)`.
- Header: avatar initials, display name (legal name when `first_name && last_name`, else nick_name — mirror `display_guest_name` semantics in FE), chips: Member / VIP (`vip_status`) / Returning (`summary.completed_stays>0`) / Blacklisted (error chip + reason tooltip) / Duplicate-review warning; contact row (email/phone/alt); last stay + next stay; quick-action buttons: Edit (form dialog), New Booking (`UnifiedBookingModal` — check its props for a preselected-guest mode; if unsupported, deep-link to `/bookings`), Add Note / Record Interaction (opens the Interactions tab + focuses form — simplest: switch tab), Open Support Conversation (dialog → `createSupportConversation`).
- Tabs (MUI `Tabs`, `TabPanel` shared component): Overview, Stays, Preferences, Interactions, Loyalty & Vouchers, Support & Feedback, Communication. Permission-gated: derive from `useAuth()` permission set (check how existing pages read permissions — `useAuth` exposes permissions; gate Support tab on `support:read`, Communication on `communications:read`, etc.).
- OverviewTab: metric tiles (reuse `Metric`-style layout: completed stays, nights, lifetime room revenue via `useCurrency`, outstanding balance), current/upcoming stay card (from `summary.active_booking_*` + reservations), alerts panel (blacklist, `is_alert` notes — needs latest alerts: use `useGuestInteractions` first page), preferences summary (top entries), open items (open support count, pending follow-ups, unanswered reviews), duplicates warning card.
- StaysTab: the existing `ReservationsTab` table from `GuestProfileDialog` — extract to shared component; add "Open in Bookings" link per row (`/bookings` deep-link — check bookings page query-param support for focusing a booking; if none, link to `/bookings` plainly).

- [ ] **Steps:** implement → typecheck/lint → commit `feat(fe): guest 360 profile page shell + overview + stays`.

---

### Task 14: Preferences + Interactions tabs

- `components/tabs/PreferencesTab.tsx` — grouped editor: category sections (Room, Bed, Floor, Dietary, Communication, Occasion, Other) with key/value rows; add-row per category; save → `usePutGuestPreferences` with `replace_categories` for edited categories. Also renders `guest.special_requests` and `guest.notes` as read-only "from booking/profile" panels — visually distinct from confirmed preferences (per spec: confirmed vs staff-note vs inferred separation; no inferred data exists, so none is shown).
- `components/tabs/InteractionsTab.tsx` — timeline list (type icon/badge, subject, content, actor name, timestamp, linked booking chip, follow-up chip w/ complete button, private badge), inline add form (type select, subject, content, related booking select from profile reservations, follow-up date picker via `ModernDatePicker`, private toggle, alert toggle, assignee select — assignee options need a staff list: check `useSupportQueries`/agents endpoint `GET /support/agents` (requires `support:assign`) — degrade to no-assignee when permission absent), edit/delete on own-or-manage basis, pagination ("load more").
- `components/InteractionDialog.tsx` if the inline form gets tall — prefer inline.

- [ ] **Steps:** implement → typecheck/lint → commit `feat(fe): preferences editor + interactions timeline`.

---

### Task 15: Loyalty & Vouchers + Support & Feedback + Communication tabs

- `LoyaltyTab.tsx` — member number, status, tier chip, points tiles (available/lifetime/qualifying nights), recent redemptions mini-table; "Manage in Loyalty" link (`/loyalty`). Empty state "Not enrolled" when `loyalty_summary` null.
- `VouchersTab.tsx` (or merged into Loyalty tab — merge them; tab label "Loyalty & Vouchers") — vouchers table (code, status chip, expiry, redeemed_at), link to `/promotions`. Read-only.
- `SupportTab.tsx` — conversation list (number, category chip, status chip, priority, assignee, last activity, SLA-risk badge using `is_sla_at_risk/breached`), "Open in Support" link (`/support` — check support page for a conversation deep-link param; if none, plain link), "New conversation/request" button → `CreateSupportDialog` (category select incl. `service_request`/`complaint`, subject, booking link, priority, message).
- `FeedbackTab.tsx` (or inside SupportTab sections — keep as one "Support & Feedback" tab with two sections) — reviews list: rating stars, title, content, related booking, published state, response box (view or inline respond form → `useRespondToReview`).
- `CommunicationTab.tsx` — consent summary (`marketing_opt_in`, `communication_preference`, `language_preference`, email suppressed badge), subscriptions grid (channel/topic/subscribed), recent deliveries table (kind, subject, status, date), "Edit consent" → calls existing `POST /admin/communications/guests/{id}/consent` via a small service method (add to `guestRelations.service.ts`); note transactional-vs-marketing distinction in copy.

- [ ] **Steps:** implement → typecheck/lint → commit `feat(fe): loyalty/vouchers/support/feedback/communication tabs`.

---

### Task 16: Routing, navigation, legacy page retirement

**Files:**
- Create: `src/routes/guest-relations.tsx` → `RouteById id="guest-relations"`; `src/routes/guest-relations.guests.tsx` → `RouteById id="guest-relations"` (same page; `/guest-relations` redirects or renders list — pick one: make `guest-relations.tsx` a `<Navigate to="/guest-relations/guests" replace />`); `src/routes/guest-relations.guests.$guestId.tsx` → renders `GuestProfilePage` directly (param routes render directly per `help.$slug.tsx` precedent).
- Modify: `src/navigation/routeRegistry.tsx` — replace `guest-config` entry: `id: 'guest-relations'`, `path: '/guest-relations/guests'`, `navLabel: 'Guest Relations'`, `breadcrumbLabel: 'Guest Relations'`, same group/icon/perms. Keep `guest-config` entry? No — delete it; add redirect: `src/routes/guest-config.tsx` becomes `createFileRoute('/guest-config')` rendering `<Navigate to="/guest-relations/guests" replace />` (check redirect conventions — TanStack `redirect` in `beforeLoad` is idiomatic; use whichever the codebase uses for redirects).
- `GuestConfigurationPage.tsx` → delete after porting all still-reachable features into the new feature (form dialog, credits panel, portal-account transfer, tourism conversion, eKYC entry point, booking modal, CSV export, stat tiles). `GuestsPage.tsx` → delete (dead). `features/guests/` keeps: `GuestFormDialog`, `MembershipPointsScanner`, hooks (re-export or move into `guestRelations`), `utils.ts` segments logic (move + extend), `constants.ts` palette. If other features import from `features/guests`, keep the barrel exporting moved symbols to avoid churn — grep imports first.
- Old route policy `guest-config` row remains in DBs (harmless; the registry no longer renders it). New rows added by patch.

- [ ] **Steps:** implement → `bun run typecheck && bun run lint && bun run test` → commit `feat(fe): guest relations routing + retire guest-config page`.

---

### Task 17: FE tests + full gates + docs

- `guestRelations` tests (Vitest + Testing Library): list renders + filter chips produce right params; interactions tab create flow (mock service); preferences save payload; permission-gated tab hidden without `support:read`; 360 header chips (VIP/blacklisted). Service test: URL/params for each method (mirror `guests.service.test.ts`).
- Update docs: `docs/api/openapi.json` (done Task 10); add Guest Relations section to `docs/architecture/architecture-flow.md` or a short `docs/architecture/guest-relations.md` covering boundary table, identity model, endpoints; append a line to `docs/ongoing-dev.md` if that's the convention for finished work.
- Full gates: `bun run typecheck && bun run lint && bun run test && bun run build`; `cargo check/clippy/test --all-features`; patch catalog + lifecycle tests.

- [ ] Commit `docs + test: guest relations`.

---

## Self-review notes (done)

- Spec coverage: Phase-1 items all map to tasks 1-17; Phase-2 (dashboard, segments, follow-up queue) explicitly deferred per spec §8.
- The `support_conversations_category_check` CHECK constraint must be altered (categories are hardcoded in the constraint, not just the settings row) — covered in Task 1.
- `guests:reveal` uses allowed action `reveal`; admin/super_admin auto-grant via their all-permissions `CROSS JOIN`; manager explicit.
- Sensitive fields never enter the list payload (`find_paginated` untouched) or audit details.
- `GuestsPage.tsx` is dead code — deleted in Task 16.
- Follow-ups due: `idx_guest_notes_follow_up_open` supports the Phase-2 queue.
