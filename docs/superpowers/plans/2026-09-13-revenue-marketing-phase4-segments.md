# Revenue & Marketing Phase 4 — Guest Segments + Communications Targeting

> **For agentic workers:** Execute task-by-task with per-task checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic guest segments (`guest_segments` + JSONB rule compiler evaluated at query time, no materialized membership) and wire them into email-campaign audience targeting (`email_campaigns.segment_id` ∩ topic consent ∩ not suppressed), plus a `/segments` workspace page.

**Architecture:** New `src/modules/segments/` domain module (routes→handlers→service→repository→models, plus a pure `rules.rs` whitelist compiler). Communications gains a nullable `segment_id` on `email_campaigns`; the audience expansion query and audience-count endpoint intersect the compiled segment predicate. Frontend gains `features/segments/` + `/segments` route in the `revenue` nav group, and the communications campaign dialog gains a segment picker.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL; React/TS/Vite/MUI; TanStack Query + Router.

## Global Constraints

- Schema changes go into the V1 baseline **and** a new catalog patch (`0022`), registered in all six places: `manifest.tsv` (+sha256), `deploy/deploy.sh`, `deploy/deploy-staging.sh`, `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml`, and four spots in `tests/postgres_patch_lifecycle.rs` (two `BETWEEN 2 AND <N>` bounds, expected-revision list, `revisions.len()`).
- seed.sql additions must update the self-validation tables: `expected_permission_names`, `expected_route_access_policies`, permission insert block, role grants, route policy insert.
- All SQL parameterized — segment rule VALUES are bound, never interpolated. Field/operator names come from a whitelist only.
- `admin`/`super_admin` hold every permission via wildcard grant; `manager` gets an explicit list and does NOT get segments/promotions/comms perms today — keep segments admin-only (consistent with campaigns).
- No materialized segment membership rows; evaluation is always fresh.
- Fail closed: a campaign whose `segment_id` points at a missing/inactive segment expands to zero recipients, never to everyone.
- Frontend HTTP via `src/api/client.ts` only; route page added to BOTH `src/routes/segments.tsx` and `src/navigation/routeRegistry.tsx`; nav labels in en+ms `nav.json`.
- `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`, live PG tests need `DATABASE_URL`; FE gates: `bun run typecheck`, `eslint --max-warnings=0` on touched files, `bun run test`, `bun run build` (build regenerates `routeTree.gen.ts` — the `tsr` CLI is broken under Node 26).

## Design Decisions (from approved spec)

- `guest_segments.rules` is JSONB DNF: `{"groups":[{"conditions":[{"field","op","value"}]}]}` — OR between groups, AND within. ≥1 group, each ≥1 condition.
- Field whitelist (guest alias `g`): `country`, `nationality`, `language_preference`, `communication_preference`, `vip_status` (text: eq/ne/in/is_set/is_not_set); `guest_type` (text via `::text`: eq/ne/in); `marketing_opt_in` (bool: eq); `tags` (text[]: contains/not_contains); `total_stays` (int: eq/gte/lte); `total_spend` (num: gte/lte); `age_years` (derived `EXTRACT(YEAR FROM AGE(g.date_of_birth))::int`, NULL dob never matches: gte/lte); `loyalty_tier_id` (EXISTS loyalty_members⋈loyalty_accounts, active member: eq/in); `has_loyalty_membership` (bool: eq); `days_since_last_stay` (derived `CURRENT_DATE - MAX(bookings.check_out_date)` over `status IN ('checked_out','completed')`; guests with no completed stay never match: gte/lte).
- `CompiledClause { sql: String, binds: Vec<SegmentBind> }` — `sql` is a parenthesized predicate over alias `g` with `$N` placeholders numbered from a caller-supplied `first_param`.
- `email_campaigns.segment_id` is a live reference: expansion evaluates CURRENT rules at schedule time (dynamic-by-design), not a snapshot.
- Preview endpoints: `POST /admin/segments/preview` (unsaved rules → count) and `GET /admin/segments/{id}/preview` (count + ≤10 sample names).

---

### Task 1: Schema — `guest_segments` + `email_campaigns.segment_id` + patch 0022

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Create: `hotel-app-be/database/postgres/patches/0022_guest_segments.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: `hotel-app-be/database/postgres/seed.sql`
- Modify: `deploy/deploy.sh`, `deploy/deploy-staging.sh`, `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml`
- Modify: `hotel-app-be/tests/postgres_patch_lifecycle.rs` (4 spots)
- Modify: `hotel-app-be/tests/postgres_patch_catalog.rs` (object snapshot whitelist — the one extended in 0021)

**Baseline edits** (pg_dump section ordering — tables alphabetical near `guests`, then PK/unique/index/FK sections):

```sql
CREATE TABLE public.guest_segments (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(160) NOT NULL,
    description text,
    rules jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    updated_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guest_segments_name_not_blank CHECK ((length(btrim(name::text)) > 0)),
    CONSTRAINT guest_segments_rules_shape CHECK ((jsonb_typeof(rules) = 'object'))
);
ALTER TABLE public.guest_segments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (...);  -- mirror sibling seq block
ALTER TABLE public.email_campaigns ADD COLUMN segment_id bigint;
-- PK section: ALTER TABLE ONLY public.guest_segments ADD CONSTRAINT guest_segments_pkey PRIMARY KEY (id);
-- Unique: guest_segments_slug_key UNIQUE (slug)
-- Index: CREATE INDEX idx_email_campaigns_segment ON public.email_campaigns USING btree (segment_id) WHERE (segment_id IS NOT NULL);
-- FK: ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.guest_segments(id);
```

**seed.sql edits:**
1. `expected_permission_names` (alphabetical, near `services:`/`settings:` block): `('segments:manage')`, `('segments:read')`, `('navigation_segments:read')`.
2. `expected_route_access_policies` (~line 236 route_id list): add `('segments')`.
3. Permission inserts (near the communications block ~line 471):
```sql
('segments:read', 'segments', 'read', 'View guest segments and segment previews', true),
('segments:manage', 'segments', 'manage', 'Create and manage guest segments', true),
('navigation_segments:read', 'navigation:segments', 'read', 'Show Segments navigation', true),
```
4. Route policy — extend the multi-row backfill `VALUES` list (~line 1121) with:
```sql
    ('segments', '/segments', 'Segments', 'revenue', '["segments:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, '["navigation_segments:read","segments:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
```
   Also add a standalone `INSERT ... ON CONFLICT (route_id) DO UPDATE` block like the campaigns one (~line 748) so re-applied seeds refresh it — actually the backfill VALUES list already has ON CONFLICT DO UPDATE; just add the row there.
5. No explicit role grant needed beyond admin/super_admin wildcard — verify there IS a wildcard grant for admin/super_admin (seed line ~553 `CROSS JOIN permissions` with no name filter). If it is wildcard, done; do NOT add segments to `manager` (manager lacks promotions/comms perms — consistent).

**Patch 0022** — mirror `0021_campaign_targeting.sql`'s DO-block style: preflight role check, CREATE TABLE IF NOT EXISTS via `information_schema` guards (see how 0021 creates `promotion_channels`), `ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS segment_id`, constraints via `pg_constraint` existence checks, `CREATE INDEX IF NOT EXISTS`, permission inserts ON CONFLICT, admin/super_admin grants, route policy upsert.

**Registrations:** `manifest.tsv` new line `0022<TAB>0022_guest_segments.sql<TAB><sha256 of file>` (compute `shasum -a 256`); the two deploy scripts' patch arrays; both workflows' patch lists; lifecycle test bounds `BETWEEN 2 AND 22`, revision list entry, `revisions.len()` count.

**Steps:**
- [ ] Baseline edits + seed edits + patch file + all six registrations.
- [ ] `cargo test --all-features --test postgres_patch_catalog` → all pass (expect 26 now or +1 over current count).
- [ ] `cargo test --all-features --test postgres_patch_lifecycle` (live PG; `DATABASE_URL` set) → 10 pass.
- [ ] Commit `feat(segments): guest_segments schema, campaign segment_id, and patch 0022`.

---

### Task 2: `modules/segments/` — models + rules compiler

**Files:**
- Create: `src/modules/segments/mod.rs` (`pub mod rules; pub mod models;` — repo/service/handlers/routes land in Task 3; add them to mod.rs there)
- Create: `src/modules/segments/models.rs`
- Create: `src/modules/segments/rules.rs`
- Modify: `src/modules/mod.rs` (add `pub mod segments;` — alphabetical, after `revenue`… actually list is alphabetical: communications, consent, ekyc, guest_booking, loyalty, promotions, realtime, revenue, settings, support, teams → insert `segments` after `revenue`, before `settings`)

**models.rs:**
```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Serialize)]
pub struct GuestSegment {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SegmentInput {
    pub name: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SegmentListQuery {
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SegmentListResponse { pub items: Vec<SegmentSummary>, pub total: i64, pub page: i64, pub page_size: i64 }

#[derive(Debug, Serialize)]
pub struct SegmentSummary {
    pub id: i64, pub name: String, pub slug: String, pub description: Option<String>,
    pub rules: JsonValue, pub is_active: bool, pub member_count: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SegmentPreviewInput { pub rules: JsonValue }

#[derive(Debug, Serialize)]
pub struct SegmentPreview {
    pub count: i64,
    pub sample: Vec<SegmentSampleGuest>, // GET /{id}/preview only; POST preview returns empty sample
}

#[derive(Debug, Serialize)]
pub struct SegmentSampleGuest { pub id: i64, pub name: String }

#[derive(Debug, Serialize)]
pub struct SegmentFieldOptions {
    pub loyalty_tiers: Vec<LoyaltyTierOption>,
    pub guest_types: Vec<String>,                 // ["member","non_member"] — enum, constant
    /// Observed distinct values on guests — powers selects with real data.
    pub distinct_values: SegmentDistinctValues,
}

#[derive(Debug, Serialize)]
pub struct SegmentDistinctValues {
    pub countries: Vec<String>,
    pub nationalities: Vec<String>,
    pub languages: Vec<String>,
    pub communication_preferences: Vec<String>,
    pub vip_statuses: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LoyaltyTierOption { pub id: i64, pub name: String }
```

**rules.rs** — the compiler. Core types + whitelist:

```rust
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use crate::core::error::ApiError;

#[derive(Debug, Clone)]
pub enum SegmentBind {
    Text(String), Texts(Vec<String>), Int(i64), Ints(Vec<i64>), Num(Decimal), Bool(bool),
}

#[derive(Debug, Clone)]
pub struct CompiledClause { pub sql: String, pub binds: Vec<SegmentBind> }

#[derive(Deserialize)]
struct RawRules { groups: Vec<RawGroup> }
#[derive(Deserialize)]
struct RawGroup { conditions: Vec<RawCondition> }
#[derive(Deserialize)]
struct RawCondition { field: String, op: String, value: Option<JsonValue> }

/// Parse + validate the stored JSONB into the typed rule tree. Also used by
/// validation on write — invalid rules can never be persisted.
pub fn parse_rules(rules: &JsonValue) -> Result<RawRules, ApiError> {
    let parsed: RawRules = serde_json::from_value(rules.clone())
        .map_err(|_| ApiError::BadRequest("Segment rules must be an object with groups".into()))?;
    if parsed.groups.is_empty() {
        return Err(ApiError::BadRequest("Segment needs at least one rule group".into()));
    }
    for g in &parsed.groups {
        if g.conditions.is_empty() {
            return Err(ApiError::BadRequest("Rule groups need at least one condition".into()));
        }
    }
    Ok(parsed)
}
```

Field spec table (static). Each entry: `name`, `kind`, allowed ops, and a `clause` builder producing SQL with one `$N` slot per bind:

```rust
enum FieldKind { Text(&'static str /*column*/), Int(&'static str /*expr*/), Num(&'static str), Bool(&'static str), Tags, TierId, LoyaltyMember }

const FIELDS: &[(&str, FieldKind, &[&str])] = &[
    ("country", FieldKind::Text("g.country"), &["eq","ne","in","is_set","is_not_set"]),
    ("nationality", FieldKind::Text("g.nationality"), &[...same]),
    ("language_preference", FieldKind::Text("g.language_preference"), &[...]),
    ("communication_preference", FieldKind::Text("g.communication_preference"), &["eq","in","is_set","is_not_set"]),
    ("vip_status", FieldKind::Text("g.vip_status"), &["eq","ne","in","is_set","is_not_set"]),
    ("guest_type", FieldKind::Text("g.guest_type::text"), &["eq","ne","in"]),
    ("marketing_opt_in", FieldKind::Bool("g.marketing_opt_in"), &["eq"]),
    ("tags", FieldKind::Tags, &["contains","not_contains"]),
    ("total_stays", FieldKind::Int("g.total_stays"), &["eq","gte","lte"]),
    ("total_spend", FieldKind::Num("g.total_spend"), &["gte","lte"]),
    ("age_years", FieldKind::Int("EXTRACT(YEAR FROM AGE(g.date_of_birth))::int"), &["gte","lte"]),
    ("loyalty_tier_id", FieldKind::TierId, &["eq","in"]),
    ("has_loyalty_membership", FieldKind::LoyaltyMember, &["eq"]),
    ("days_since_last_stay", FieldKind::Int("(CURRENT_DATE - (SELECT MAX(b.check_out_date) FROM bookings b WHERE b.guest_id = g.id AND b.status IN ('checked_out','completed')))"), &["gte","lte"]),
];
```

`compile_rules(rules: &JsonValue, first_param: usize) -> Result<CompiledClause, ApiError>`:
- `parse_rules`, then for each condition: look up field → check op ∈ allowed → emit clause + push bind(s), numbering params `first_param + binds.len()`.
- Value coercion: text→`as_str` (reject non-string, reject >200 chars); int→`as_i64`; num→Decimal from number/string (reject NaN); bool→`as_bool`; `in`→non-empty array of the field's scalar type (Texts for text fields, Ints for `loyalty_tier_id`); `is_set`/`is_not_set`/`contains` semantics below need no value except `contains` (text scalar).
- Clause fragments (p = placeholder):
  - Text: `expr = $p` / `expr <> $p` / `expr = ANY($p)` / `expr IS NOT NULL AND length(btrim(expr)) > 0` / `expr IS NULL OR length(btrim(expr)) = 0`
  - Int/Num: `expr = $p` / `expr >= $p` / `expr <= $p` (expr as written; for Int also allow eq)
  - Bool: `expr IS $p` — wait, `= $p` binds bool fine: `expr = $p`
  - Tags contains: `$p = ANY(g.tags)`; not_contains: `NOT ($p = ANY(COALESCE(g.tags, '{}'::text[])))`
  - TierId eq: `EXISTS (SELECT 1 FROM loyalty_members lm JOIN loyalty_accounts la ON la.member_id = lm.id WHERE lm.guest_id = g.id AND lm.status = 'active' AND la.current_tier_id = $p)`; in: same with `= ANY($p)`
  - LoyaltyMember eq true: `EXISTS (SELECT 1 FROM loyalty_members lm WHERE lm.guest_id = g.id AND lm.status = 'active')`; false: `NOT EXISTS (...)`
- Group → `("c1 AND c2 ...")`; groups joined ` OR `; result wrapped `( ... )`.

Binder helper for repositories (sqlx `query()` returns `Query<Postgres, PgArguments>`):
```rust
pub fn apply_binds<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    binds: &'q [SegmentBind],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    for b in binds {
        q = match b {
            SegmentBind::Text(v) => q.bind(v.clone()),
            SegmentBind::Texts(v) => q.bind(v.clone()),
            SegmentBind::Int(v) => q.bind(*v),
            SegmentBind::Ints(v) => q.bind(v.clone()),
            SegmentBind::Num(v) => q.bind(*v),
            SegmentBind::Bool(v) => q.bind(*v),
        };
    }
    q
}
```
(`Decimal` binds directly — the revenue module binds Decimal; verify `rust_decimal::Decimal` is the crate's Decimal type. `Vec<String>`/`Vec<i64>` bind to `text[]`/`bigint[]` which `= ANY($p)` accepts.)

- [ ] Write `rules.rs` unit tests in-file (`#[cfg(test)] mod tests`): every field compiles each allowed op; param numbering honors `first_param`; unknown field/op rejected; empty groups rejected; `in` with empty array rejected; wrong value type rejected; multi-group OR shape (`(a) OR (b AND c)`); binds order matches placeholder order.
- [ ] `cargo test --all-features segments::rules` → pass; `cargo check --all-features` clean (mod.rs wired).
- [ ] Commit `feat(segments): rule whitelist compiler + models`.

---

### Task 3: segments repository/service/handlers/routes

**Files:**
- Create: `src/modules/segments/repository.rs`, `service.rs`, `handlers.rs`, `routes.rs`
- Modify: `src/modules/segments/mod.rs` (add `pub mod repository; pub mod service; pub mod handlers; pub mod routes;`)
- Modify: `src/routes/mod.rs` (`.merge(crate::modules::segments::routes::routes())` after the revenue merge ~line 404)

**repository.rs** — `SEGMENT_COLUMNS`, `segment_from_row` (try_get style like siblings), and:
- `list(pool, search, is_active, page, page_size) -> (Vec<GuestSegment>, i64)` — `WHERE ($1 IS NULL OR name ILIKE '%'||$1||'%' OR slug ILIKE ...)` etc.
- `find_by_id(pool, id) -> Option<GuestSegment>`
- `slug_exists(pool, slug, exclude_id) -> bool`
- `insert_tx(tx, draft, actor) -> i64`; `update_tx(tx, id, draft) -> bool`; `delete(pool, id) -> bool`
- `campaign_count(pool, segment_id) -> i64` (for delete guard)
- `count_matching(pool, clause: &CompiledClause) -> i64`: `format!("SELECT COUNT(*) FROM guests g WHERE g.is_active IS TRUE AND {}", clause.sql)` via `AssertSqlSafe` + `apply_binds`.
- `sample_matching(pool, clause, limit) -> Vec<SegmentSampleGuest>`: `SELECT g.id, COALESCE(NULLIF(btrim(concat_ws(' ', g.first_name, g.last_name)), ''), g.nick_name) AS name FROM guests g WHERE g.is_active IS TRUE AND {clause} ORDER BY g.id LIMIT $N` — limit is the LAST param: compile clause with `first_param=1`, binds first, then `.bind(limit)`.
- `list_for_summary` needs `member_count` — run `count_matching` per row? N+1 for ≤50 rows is acceptable BUT simpler + cheaper: page-size cap 50, sequential counts (same pattern tolerance as before). Actually cheaper: skip member_count in list query; compute in service by looping `count_matching` — max page_size clamp 50, fine for admin UI.
- `loyalty_tier_options(pool) -> Vec<LoyaltyTierOption>`: `SELECT id, name FROM loyalty_tiers ORDER BY sort_order, id`.
- `distinct_values(pool) -> SegmentDistinctValues`: five `SELECT DISTINCT <col> FROM guests WHERE <col> IS NOT NULL AND length(btrim(<col>)) > 0 ORDER BY <col> LIMIT 200` queries (country, nationality, language_preference, communication_preference, vip_status) — real observed values for UI selects.

**service.rs:**
- `validate_input(input) -> SegmentDraft {name, slug, description, rules: JsonValue, is_active}` — slug = slugified name (lowercase, non-alnum→`-`, collapse, trim `-`, max 160, fallback `segment`); `rules::parse_rules(&rules)?` validates before persist; description `sanitize_optional_text`-style trim+length cap 2000.
- `create/update`: slug uniqueness check (`slug_exists`), tx + AuditLog `segment.created`/`segment.updated` (details: name, is_active), return fresh row.
- `delete`: `campaign_count > 0` → `ApiError::Conflict("Segment is used by email campaigns")`; else delete + audit `segment.deleted`.
- `preview_saved(pool, id)` → compile `first_param=1`, count + sample(10). `preview_rules(pool, input.rules)` → count only.
- `compiled_clause(pool, segment_id, first_param) -> Result<Option<CompiledClause>, ApiError>` — **the cross-module API communications uses**: `None` if `segment_id` none; segment missing or `!is_active` → `Some(CompiledClause { sql: "(false)".into(), binds: vec![] })` (fail closed); else `Some(compile_rules(&seg.rules, first_param)?)`.
- `field_options(pool)` → `{ loyalty_tiers: repo::loyalty_tier_options, guest_types: vec!["member","non_member"] (the enum), distinct_values: repo::distinct_values }`.
- `list` — enrich rows into `SegmentSummary` with `member_count` via `count_matching` loop.

**handlers.rs** — thin; permission map: `segments:read` for list/get/preview/field-options, `segments:manage` for create/update/delete. Actor via `require_permission_helper` + `client_ip`/`user_agent` (copy comms handlers' helpers or import shared ones — check where `require_permission_helper`/`client_ip` are defined; they're local fns in comms handlers.rs — copy the pattern or extract to module-local copies).

**routes.rs** — static routes BEFORE `{id}`:
```rust
Router::new()
    .route("/admin/segments", get(list).post(create))
    .route("/admin/segments/field-options", get(field_options))
    .route("/admin/segments/preview", post(preview_rules))
    .route("/admin/segments/{id}", get(get_one).put(update).delete(remove))
    .route("/admin/segments/{id}/preview", get(preview_saved))
```

- [ ] Implement + `cargo check --all-features` clean.
- [ ] Commit `feat(segments): admin segment CRUD, preview, and field options`.

---

### Task 4: communications integration — `email_campaigns.segment_id`

**Files:**
- Modify: `src/modules/communications/models.rs` (`EmailCampaign.segment_id`, `CampaignInput.segment_id`)
- Modify: `src/modules/communications/validation.rs` (`CampaignDraft.segment_id` pass-through)
- Modify: `src/modules/communications/repository.rs` (`CAMPAIGN_COLUMNS` + `campaign_from_row` + insert/update column lists; `audience_batch` + `count_audience` clause params)
- Modify: `src/modules/communications/service.rs` (segment existence/active check on create+update; `audience_count` signature; `preview_campaign` passes segment clause)
- Modify: `src/modules/communications/scheduler.rs` (`expand_campaign` loads clause once before the batch loop)
- Modify: `src/modules/communications/handlers.rs` (`AudienceQuery.segment_id`, thread to service)

**Cross-module contract** (defined in `modules/segments/models.rs`):

```rust
pub enum SegmentScope {
    Unrestricted,          // no segment on the campaign
    Empty,                 // segment referenced but missing/inactive — fail closed
    Rules(JsonValue),      // active segment's stored rules
}
```

`segments::service::audience_scope_for(pool, segment_id: Option<i64>) -> Result<SegmentScope, ApiError>` resolves it (None → `Unrestricted`; missing/inactive → `Empty`; else `Rules(seg.rules)`).

**Repository signature changes** — repo fns take the scope and compile internally (clause numbering is query-position-dependent, so compile must happen inside each query fn via `crate::modules::segments::rules::compile_rules(rules, FIRST_FREE_PARAM)`):

```rust
pub async fn audience_batch(
    pool: &DbPool, topic: &str, campaign_id: i64,
    scope: &SegmentScope, limit: i64,
) -> Result<Vec<AudienceGuest>, ApiError>
```

In `audience_batch`: existing params are `$1 topic, $2 campaign_id, $3 limit`. Compile rules with `first_param=4` and inject `AND {clause.sql}` before `ORDER BY g.id` (string is built with `format!`/`AssertSqlSafe` like the existing `{COLS}` pattern). sqlx binds positionally in call order, so call `.bind(topic).bind(campaign_id).bind(limit)` FIRST, then `rules::apply_binds` for the clause's `$4..` — bind order is by placeholder NUMBER (1,2,3 then 4..), not text position. `SegmentScope::Empty` → inject `AND false`, no binds. `Unrestricted` → no injection.

Same for `count_audience` (renamed from `count_audience_for_topic`, signature `(pool, topic, scope: &SegmentScope)`): `topic` stays `$1`, clause compiled with `first_param=2`, injected into the `eligible` subselect; add a sixth bucket `excluded_segment` = guests who are active ∧ emailable ∧ consenting ∧ unsuppressed but fail the segment (`AND NOT ({clause})` — for `Empty` that subselect equals the otherwise-eligible count; for `Unrestricted` emit `0` literal, no extra bind). `AudienceCount` gains `excluded_segment: i64` (additive, serde-safe). Update the two callers (`service::audience_count`, `preview_campaign`).

**service.rs:**
- `create_campaign`/`update_campaign`: `if let Some(sid) = draft.segment_id` → `segments::service::require_active_segment(pool, sid)` (new helper: exists ∧ `is_active`, else `ApiError::BadRequest("Unknown or inactive segment")`). Add `segment_id` to audit details json.
- `audience_count(pool, topic, segment_id: Option<i64>)`: `let scope = segments::service::audience_scope_for(pool, segment_id).await?;` then `Repo::count_audience(pool, topic, &scope)`.
- `preview_campaign`: resolve scope from `campaign.segment_id` (missing/inactive → `Empty` — preview honestly shows eligible 0).

- `preview_campaign`: resolve scope from `campaign.segment_id` (missing/inactive → `Empty` — preview shows eligible 0, honest).

**scheduler.rs `expand_campaign`:** before the loop:
```rust
let scope = crate::modules::segments::service::audience_scope_for(pool, campaign.segment_id).await?;
```
then `Repo::audience_batch(pool, &campaign.topic, campaign.id, &scope, EXPANSION_BATCH)`. One pool query per expansion, none inside tx — no starvation issue (expand is single-threaded per campaign anyway).

**models/validation:** `EmailCampaign.segment_id: Option<i64>`; `CampaignInput.segment_id: Option<i64>`; `CampaignDraft.segment_id: Option<i64>` (validate: `> 0` else BadRequest). `CAMPAIGN_COLUMNS` += `segment_id`; insert/update column lists + binds; `campaign_from_row` reads it.

- [ ] Implement + `cargo check --all-features` clean + comms unit tests pass.
- [ ] OpenAPI regen: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` → green (new `/admin/segments/*` routes + `segment_id` fields land in spec).
- [ ] Commit `feat(segments): segment targeting in campaign audiences`.

---

### Task 5: live PostgreSQL tests — `tests/segments.rs`

New file (don't touch dirty/shared test files). Follow `tests/promotion_performance.rs` fixture patterns: `database_url()` early-return guard, insert guests directly, clean up by ids.

Tests:
1. `segment_rules_match_guests_dynamically` — insert guests: A(country='Malaysia', tags=['vip'], marketing_opt_in=true, total_stays=5), B(country='Singapore', total_stays=1), C(no email/inactive). Segment `{groups:[{conditions:[{field:"country",op:"eq",value:"Malaysia"},{field:"tags",op:"contains",value:"vip"}]}]}` → `count_matching`==1; OR-group adding `{country eq Singapore}` → 2. `days_since_last_stay` gte on guest with old completed booking matches; never-stayed guest doesn't.
2. `campaign_audience_intersects_segment_and_consent` — segment country=Malaysia; guests with `notification_subscriptions(topic='promotion', channel='email', subscribed=true)` — one in-segment, one out. `audience_batch` with `SegmentScope::Rules` returns only in-segment; `SegmentScope::Empty` → 0; `Unrestricted` → all consenting.
3. `inactive_segment_fails_closed_and_delete_guard` — create+link campaign with segment_id → deactivate segment → `audience_scope_for` returns `Empty` → batch 0; `delete` returns Conflict.
4. `segment_crud_and_preview` — service create → preview count/sample; update rules changes count without writes to membership (nothing to clean up — proof of dynamic evaluation); slug conflict → BadRequest.

- [ ] `cargo test --all-features --test segments` → all pass against live PG.
- [ ] Commit `test(segments): live coverage for rules, targeting, and lifecycle`.

---

### Task 6: frontend `features/segments/` + `/segments` route

**Files:**
- Create: `src/features/segments/types.ts`, `constants.ts`, `api/segmentsApi.ts`, `hooks/useSegments.ts`, `components/SegmentRulesEditor.tsx`, `components/SegmentsTable.tsx`, `pages/SegmentsPage.tsx`, `index.ts`
- Create: `src/routes/segments.tsx`
- Modify: `src/navigation/routeRegistry.tsx` (entry after `campaigns`: id `segments`, path `/segments`, nav group `revenue`, icon `GroupsIcon`/`PeopleAltOutlined` — check icons already imported; `accessControlled`, breadcrumb `Segments`)
- Modify: `src/i18n/resources/en/nav.json` (`"segments": "Segments"`), `ms/nav.json` (`"Segmen"`)
- Regenerate: `src/routeTree.gen.ts` via `bun run build`

**types.ts** mirrors backend: `GuestSegment`, `SegmentSummary`, `SegmentRules {groups: RuleGroup[]}`, `RuleCondition {field, op, value}`, `SegmentInput`, `SegmentPreview`, `SegmentFieldOptions`, `SegmentListParams/Response`.

**constants.ts** — `SEGMENT_FIELDS` mirroring backend whitelist (comment: "mirror of hotel-app-be modules/segments/rules.rs — keep in sync"):
```ts
export const SEGMENT_OPS = {
  eq: 'is', ne: 'is not', in: 'is one of', gte: 'at least', lte: 'at most',
  contains: 'includes tag', not_contains: 'excludes tag',
  is_set: 'is set', is_not_set: 'is not set',
} as const;
// kind 'suggest' = free-text input with Autocomplete options from
// fieldOptions.distinct_values[optionsFrom]; 'select' = fixed options list.
export const SEGMENT_FIELDS: Array<{field, label, kind: 'suggest'|'number'|'bool'|'tags'|'tier'|'select', ops: Op[], optionsFrom?: keyof SegmentDistinctValues, options?: string[]}> = [
  { field: 'country', label: 'Country', kind: 'suggest', optionsFrom: 'countries', ops: ['eq','ne','in','is_set','is_not_set'] },
  { field: 'nationality', label: 'Nationality', kind: 'suggest', optionsFrom: 'nationalities', ops: same },
  { field: 'language_preference', label: 'Language', kind: 'suggest', optionsFrom: 'languages', ops: ['eq','in','is_set','is_not_set'] },
  { field: 'communication_preference', label: 'Preferred contact', kind: 'suggest', optionsFrom: 'communication_preferences', ops: ['eq','in','is_set','is_not_set'] },
  { field: 'vip_status', label: 'VIP status', kind: 'suggest', optionsFrom: 'vip_statuses', ops: ['eq','ne','in','is_set','is_not_set'] },
  { field: 'guest_type', label: 'Guest type', kind: 'select', options: ['member','non_member'], ops: ['eq','ne','in'] },
  { field: 'marketing_opt_in', label: 'Marketing opt-in', kind: 'bool', ops: ['eq'] },
  { field: 'tags', label: 'Guest tags', kind: 'tags', ops: ['contains','not_contains'] },
  { field: 'total_stays', label: 'Total stays', kind: 'number', ops: ['eq','gte','lte'] },
  { field: 'total_spend', label: 'Total spend', kind: 'number', ops: ['gte','lte'] },
  { field: 'age_years', label: 'Age', kind: 'number', ops: ['gte','lte'] },
  { field: 'loyalty_tier_id', label: 'Loyalty tier', kind: 'tier', ops: ['eq','in'] },
  { field: 'has_loyalty_membership', label: 'Loyalty member', kind: 'bool', ops: ['eq'] },
  { field: 'days_since_last_stay', label: 'Days since last stay', kind: 'number', ops: ['gte','lte'] },
];
```

**api/segmentsApi.ts** — `list`, `get`, `create`, `update`, `remove`, `previewSaved`, `previewRules` (POST), `fieldOptions` — all via `api` client, `toSearchParams` like siblings.

**SegmentRulesEditor.tsx** — props `{value: SegmentRules, onChange}`. Renders groups (Paper blocks joined by an "OR" divider chip), each condition row = field Select → op Select (filtered by field) → value input by kind (TextField / number / bool toggle as Select yes-no / tier Select from `fieldOptions` / tags TextField / multi-value for `in` as comma-separated TextField → array). "+ condition" per group, "+ OR group" at bottom, delete icons per row/group (prevent deleting last condition/group). Pure controlled component, no fetch inside.

**SegmentsPage.tsx** — `PageHeader` title "Guest Segments" + "New segment" button (gate on `hasPermission('segments:manage')`); `SegmentsTable` columns: Name, Description, Matching guests (member_count), Rules summary (chips `field op value`, max ~3 + "+n"), Active chip, Updated, actions (Preview/Edit/Delete with `useConfirm`). Editor dialog embeds `SegmentRulesEditor` + a "Preview matches" button calling `previewRules` → shows count inline. Table preview action → GET `/{id}/preview` → dialog with count + sample names list.

**routes/segments.tsx** — `createFileRoute('/segments')` lazy → `SegmentsPage` (mirror `routes/campaigns.tsx`).

- [ ] `bun run typecheck` clean; `eslint --max-warnings=0` on touched files clean.
- [ ] Component test `SegmentsPage.test.tsx` or `SegmentRulesEditor.test.tsx` (testing-library): renders a condition row, changes field→op options update, add/remove group, emits correct `SegmentRules` JSON. Follow `BulkRateDialog.test.tsx` conventions (combobox role for MUI Select, substring match for required-label ` *`).
- [ ] `bun run test` green for touched files; `bun run build` green + routeTree regenerated.
- [ ] Commit `feat(segments): /segments workspace with rule builder`.

---

### Task 7: communications UI — segment picker + audience wiring

**Files:**
- Modify: `src/features/communications/types.ts` (`EmailCampaign.segment_id`, `CampaignInput.segment_id`, `AudienceCount.excluded_segment`)
- Modify: `src/features/communications/api/communicationsApi.ts` (`audienceCount(topic, segmentId?)` param)
- Modify: `src/features/communications/pages/CommunicationsPage.tsx` (campaign dialog segment Select; row chip; preview shows excluded_segment)

- Campaign dialog: Select "Audience segment" with `(none — all eligible)` + active segments from `segmentsApi.list({is_active:true,page_size:100})`; fetch only when `hasPermission('segments:read')` (else hide select; if campaign already has segment_id show its id as text). Enabled only in draft create/edit (already the case).
- Campaign row: small chip with segment name when `segment_id` set (lookup from the loaded list; fall back to `#id`).
- `audienceCount` gains optional `segmentId`; if the page calls it anywhere, pass dialog selection. Preview dialog audience breakdown adds `, outside segment: {excluded_segment}` when >0.

- [ ] typecheck/lint/test on touched files; commit `feat(communications): segment targeting picker`.

---

### Task 8: checkpoint + docs

- [ ] `cargo clippy --all-features -- -D warnings` clean; `cargo test --all-features` affected files (`segments`, `promotion_performance`, `postgres_patch_catalog`, `postgres_patch_lifecycle`, comms-related).
- [ ] FE full `bun run test` green; build green.
- [ ] `docs/FEATURES.md`: add Segments row (dynamic rules, communications targeting) + update Communications row (segment audiences).
- [ ] Commit `docs(features): guest segments and segmented campaign audiences`.

## Explicit non-goals

- No materialized membership table or refresh job.
- No guest-facing segment visibility; segments are staff-only.
- No segment targeting of promotions (voucher claiming) in this phase — `promotion_channels`/`promotion_loyalty_tiers` remain the promotion gates.
- No push/SMS channels; email only.
- No fabricated engagement metrics.
