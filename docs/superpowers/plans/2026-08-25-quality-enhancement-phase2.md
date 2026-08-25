# Quality Enhancement — Phase 2 (OpenAPI Drift Guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make API documentation self-verifying: a committed OpenAPI skeleton must exactly match the paths/methods actually registered by the backend router, enforced by a CI test that runs without a database.

**Architecture:** A source-level extractor parses every `.route(...)` registration out of `src/routes/*.rs` and `src/modules/*/routes.rs`, derives final public paths (`/api` prefix for domain routers, bare root paths for `src/routes/mod.rs`), compares them against `docs/api/openapi.json` in both directions, and live-probes each path against the real `create_router()` with safe OPTIONS requests (404 ⇒ fail; no handler ever runs, so no DB access and no mutations). An env-flag update mode regenerates the skeleton when routes legitimately change.

**Tech Stack:** Existing deps only — `regex` (already a backend dep), `serde_json`, axum 0.8.9's own `Service` impl on `Router<()>` for probing, sqlx `connect_lazy` so no live PostgreSQL is needed.

## Global Constraints

Spec: `docs/superpowers/specs/2026-08-25-quality-enhancement-design.md`.
- No new crates; adding a *feature* to an existing dep also avoided (`tower::Service` trait import suffices, no `util` feature).
- Test must pass with **no `DATABASE_URL`** set (joins the 15 non-gated integration tests; CI BE job runs it automatically via `cargo test --all-features`).
- No route paths/methods/status codes may change — this phase only observes them.
- Probes must never mutate data: OPTIONS only, no Authorization header, parameter segments replaced with `_probe`.
- `docs/api/openapi.json` records operation entries as empty objects initially (`{}`); the guard compares key sets only, never summaries — humans enrich later without breaking CI.
- Backend gates: `cargo check --all-features` minimum; `cargo clippy --all-features -- -D warnings` is what CI runs (copy verbatim); `cargo test --all-features`.

---

### Task 1: The drift test `hotel-app-be/tests/openapi_drift.rs`

**Files:**
- Create: `hotel-app-be/tests/openapi_drift.rs`

**Interfaces:**
- Consumes: `hotel_app_be::routes::create_router(DbPool) -> Router<()>`; `hotel_app_be::core::config::{init_from_env}`; `DbPool` from `hotel_app_be::core::db`.
- Produces: `collect_source_routes() -> BTreeSet<(String, String)>` of `(METHOD, final_path)`; env flag `HOTEL_APP_UPDATE_OPENAPI=1` rewrites the spec file.

- [ ] **Step 1: Implement the extractor**

Core pieces (full code in test file):

```rust
const ROUTE_FILES_NO_PREFIX: &[&str] = &["src/routes/mod.rs"];
const METHOD_RE: &str = r"\b(get|post|put|patch|delete|head|options)\s*\(";

fn source_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = glob("src/routes/*.rs")…chain(glob("src/modules/*/routes.rs")…)…
}

fn extract_routes(content: &str) -> Vec<(String /*method*/, String /*path*/)> {
    // scan for ".route(", then:
    //  - balanced-paren walk to find the region (respecting nothing inside strings
    //    except that the FIRST quoted literal is the path)
    //  - path = first `"..."` after the opening paren
    //  - methods = Regex::new(METHOD_RE).captures_iter over region
}
```

Final path rule: prefix `/api` unless the file is `src/routes/mod.rs` (its `/health`, `/ws/status` stay at the root; its `nest_service("/uploads", …)` is deliberately NOT a `.route(` site and stays out of the spec).

- [ ] **Step 2: Spec load + two-way comparison**

```rust
fn spec_paths() -> BTreeMap<String, BTreeSet<String>> {
    // serde_json::from_str(include_str!("../docs/api/openapi.json")) — no, read from
    // CARGO_MANIFEST_DIR/../docs/api/openapi.json at runtime so the update mode can rewrite it
}
```

Failures print sorted diffs: `route registered but missing from openapi.json: …` / `documented in openapi.json but no such route: …`.

- [ ] **Step 3: Safe live probe**

```rust
let url = std::env::var("DATABASE_URL")
    .unwrap_or_else(|_| "postgres://drift:nopass@127.0.0.1:1/drift".into());
let pool = DbPool::connect_lazy(&url)?;          // no connection attempt
std::env::set_var("JWT_SECRET", "drift-test-secret-0123456789abcdef0123");
config::init_from_env()?;                        // OnceLock per test binary
let mut app = routes::create_router(pool);
// per path: replace "{param}" segments with "_probe", OPTIONS request,
// assert status != StatusCode::NOT_FOUND (404 ⇒ route not really registered)
```

- [ ] **Step 4: Update mode**

When `HOTEL_APP_UPDATE_OPENAPI=1`: skip comparisons/probe, write `{openapi:"3.1.0", info:{title:"Hotel App BE API", version:"1.0.0"}, tags:[…one tag per domain…], paths:{ "<path>": { "GET": {}, … } }}` pretty-printed to `../docs/api/openapi.json` (path relative to `CARGO_MANIFEST_DIR`).

- [ ] **Step 5: Compile clean**

Run: `cargo check --all-features --tests`
Expected: no errors.

### Task 2: Generate and commit the skeleton

- [ ] **Step 1: Generate** — Run: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`
- [ ] **Step 2: Sanity-check output** — expect ~326 paths total (324 `.route(` sites incl. `/health`, `/ws/status`, minus none), all under `/api` except `/health`, `/ws/status`; spot-check `/health`, `/api/auth/login`, `/api/booking-channels` (the one chained `get().post()` site yields TWO methods).
- [ ] **Step 3: Green run** — `cargo test --all-features --test openapi_drift` (no env flag) ⇒ PASS.
- [ ] **Step 4: Commit**

```bash
git add hotel-app-be/tests/openapi_drift.rs docs/api/openapi.json
git commit -m "test(api): openapi drift guard over registered routes"
```

### Task 3: Negative verification (prove the guard bites)

- [ ] **Step 1:** Temporarily add `.route("/drift-canary", get(f))` (+ dummy async fn f) to `src/routes/auth.rs`; run the test.
Expected: FAIL naming `/api/drift-canary` as missing from openapi.json.
- [ ] **Step 2:** Revert the canary; re-run ⇒ PASS. Do NOT commit the canary.

### Task 4: README points at the spec

**Files:** Modify: `README.md` (API Endpoint Documentation section)

- [ ] Replace the hand-maintained table with: pointer to `docs/api/openapi.json` as the exhaustive, CI-verified endpoint list; keep the `/api` prefix explanation, bearer-token/RBAC note, and health-check example links. Delete the 22-row table.

- [ ] Commit: `docs(readme): delegate endpoint list to ci-verified openapi.json`

### Task 5: Gates + tracker

- [ ] `cargo clippy --all-features -- -D warnings` (verbatim CI command)
- [ ] `cargo test --all-features` WITHOUT `DATABASE_URL` — suite must exit 0 with only lib tests + non-gated files running (expect ~209 passing baseline + the new drift test); confirm openapi_drift ran (`running N tests`).
- [ ] Update `docs/ongoing-dev.md`: delete the "Documentation: no OpenAPI schema" P2 bullet.
- [ ] Commit: `docs(dev): retire shipped openapi-drift item`
