//! OpenAPI drift guard.
//!
//! Keeps `docs/api/openapi.json` in lockstep with the routes actually
//! registered by the backend. Three independent checks:
//!
//! 1. Every `.route(...)` registration in `src/routes/*.rs` and
//!    `src/modules/*/routes.rs` must appear in the spec (with the `/api`
//!    prefix that `routes/mod.rs::create_router` nests them under).
//! 2. Every documented path/method must exist in the source (both directions,
//!    so stale docs fail just as loudly as undocumented routes).
//! 3. Every extracted path must really be routable: the real router is built
//!    over a lazily-connected pool and each path is probed with an OPTIONS
//!    request. A missing route answers 404; an existing one answers anything
//!    else (typically 405). Handlers never run — no database access, no
//!    mutations — so this is safe even against a live `DATABASE_URL`.
//!
//! Regenerating the skeleton after a legitimate route change:
//! `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`

use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// Files whose registrations stay at the root (they are merged into the outer
/// router, not into the `/api`-nested API router).
const ROOT_ROUTE_FILES: &[&str] = &["src/routes/mod.rs"];

const SPEC_RELATIVE_PATH: &str = "../docs/api/openapi.json";

type RouteSet = BTreeSet<(String, String)>;

#[tokio::test]
async fn openapi_spec_matches_registered_routes() {
    let source_routes = collect_source_routes();
    assert!(
        !source_routes.is_empty(),
        "extractor found no routes — parsing logic or repository layout changed"
    );

    if std::env::var("HOTEL_APP_UPDATE_OPENAPI").is_ok_and(|v| v == "1") {
        write_spec_skeleton(&source_routes);
        return;
    }

    let spec_routes = load_spec_routes();

    let undocumented: Vec<_> = source_routes.difference(&spec_routes).collect();
    let stale: Vec<_> = spec_routes.difference(&source_routes).collect();

    let mut failure = String::new();
    if !undocumented.is_empty() {
        failure.push_str("registered routes missing from docs/api/openapi.json:\n");
        for (method, path) in &undocumented {
            failure.push_str(&format!("  {method} {path}\n"));
        }
    }
    if !stale.is_empty() {
        failure.push_str("openapi.json documents routes that are not registered:\n");
        for (method, path) in &stale {
            failure.push_str(&format!("  {method} {path}\n"));
        }
    }
    assert!(failure.is_empty(), "{failure}");

    probe_router_serves_every_path(&source_routes).await;
}

// ---------------------------------------------------------------------------
// Source extraction
// ---------------------------------------------------------------------------

fn collect_source_routes() -> RouteSet {
    let mut routes = RouteSet::new();
    for file in source_files() {
        let content =
            fs::read_to_string(&file).unwrap_or_else(|e| panic!("read {}: {e}", file.display()));
        let prefixed = !ROOT_ROUTE_FILES.contains(&file.to_string_lossy().as_ref());
        for (method, path) in extract_route_registrations(&content) {
            let final_path = if prefixed && !path.starts_with("/api/") {
                format!("/api{path}")
            } else {
                path
            };
            routes.insert((method, final_path));
        }
    }
    routes
}

fn source_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    push_rs_files(Path::new("src/routes"), &mut files);
    for entry in fs::read_dir("src/modules").expect("modules dir") {
        let modules_dir = entry.expect("modules entry").path();
        if modules_dir.is_dir() {
            push_rs_files(&modules_dir.join("routes.rs"), &mut files);
        }
    }
    files.sort();
    files
}

fn push_rs_files(path: &Path, files: &mut Vec<PathBuf>) {
    if path.is_file() {
        files.push(path.to_path_buf());
    } else if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "rs") {
                files.push(entry.path());
            }
        }
    }
}

/// Pull every `(METHOD, path)` out of `.route("<path>", get(h)…)` chains,
/// including multi-line registrations such as the ones in
/// `src/routes/booking_channels.rs`.
fn extract_route_registrations(content: &str) -> Vec<(String, String)> {
    let method_re = Regex::new(r"(^|[^a-zA-Z_])(get|post|put|patch|delete|head|options)\s*\(")
        .expect("static regex");

    let mut routes = Vec::new();
    let bytes = content.as_bytes();
    let mut cursor = 0usize;

    while let Some(found) = content[cursor..].find(".route(") {
        let open_paren = cursor + found + ".route(".len() - 1;
        let region_start = open_paren + 1;
        let Some(region_end) = balanced_paren_close(bytes, open_paren) else {
            cursor = region_start;
            continue;
        };
        let region = &content[region_start..region_end];

        if let Some(path) = first_string_literal(region) {
            for captures in method_re.captures_iter(region) {
                let method = captures[2].to_ascii_uppercase();
                routes.push((method, path.clone()));
            }
        }

        cursor = region_end;
    }

    routes
}

/// Index of the `)` closing the `(` at `open`, ignoring parentheses inside
/// string literals, line comments, and block comments.
fn balanced_paren_close(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => i = skip_string(bytes, i)?,
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i += 2;
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Given the index of an opening `"`, return the index just past its closing
/// quote (handling `\` escapes).
fn skip_string(bytes: &[u8], open: usize) -> Option<usize> {
    let mut i = open + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'"' => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

fn first_string_literal(region: &str) -> Option<String> {
    let bytes = region.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            let end = skip_string(bytes, i)?;
            return Some(region[i + 1..end - 1].to_string());
        }
        i += 1;
    }
    None
}

// ---------------------------------------------------------------------------
// Spec loading / writing
// ---------------------------------------------------------------------------

fn spec_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(SPEC_RELATIVE_PATH)
}

fn load_spec_routes() -> RouteSet {
    let raw = fs::read_to_string(spec_path())
        .unwrap_or_else(|e| panic!("read {}: {e} (generate it with HOTEL_APP_UPDATE_OPENAPI=1)", SPEC_RELATIVE_PATH));
    let value: Value = serde_json::from_str(&raw).expect("docs/api/openapi.json is valid JSON");
    let mut routes = RouteSet::new();
    let Some(paths) = value.get("paths").and_then(Value::as_object) else {
        panic!("docs/api/openapi.json has no paths object");
    };
    for (path, operations) in paths {
        let Some(operations) = operations.as_object() else {
            continue;
        };
        for method in operations.keys() {
            if method.chars().all(|c| c.is_ascii_uppercase()) {
                routes.insert((method.clone(), path.clone()));
            }
        }
    }
    routes
}

fn write_spec_skeleton(routes: &RouteSet) {
    let mut tags: BTreeMap<&str, ()> = BTreeMap::new();
    let mut paths = Map::new();
    for (method, path) in routes {
        let domain = path
            .strip_prefix("/api/")
            .and_then(|rest| rest.split('/').next())
            .filter(|seg| !seg.is_empty())
            .unwrap_or("infra");
        tags.insert(domain, ());
        let entry = paths
            .entry(path.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        entry
            .as_object_mut()
            .expect("fresh object")
            .insert(method.clone(), json!({}));
    }

    let spec = json!({
        "openapi": "3.1.0",
        "info": {
            "title": "Hotel App BE API",
            "version": "1.0.0",
            "description": "Skeleton maintained by tests/openapi_drift.rs. Paths and methods \
             are CI-verified against the registered routes; operation details (summaries, \
             parameters, responses) are filled in by hand over time and never gate CI."
        },
        "tags": tags.keys().map(|name| json!({ "name": name })).collect::<Vec<_>>(),
        "paths": Value::Object(paths),
    });

    let rendered = serde_json::to_string_pretty(&spec).expect("serialize spec") + "\n";
    if let Some(parent) = spec_path().parent() {
        fs::create_dir_all(parent).expect("create docs/api directory");
    }
    fs::write(spec_path(), rendered).expect("write openapi.json");
    println!("wrote {} routes to {}", routes.len(), SPEC_RELATIVE_PATH);
}

// ---------------------------------------------------------------------------
// Live router probe
// ---------------------------------------------------------------------------

/// Build the real application router over a lazily-connected pool and confirm
/// every extracted path is routable (non-404 under OPTIONS).
async fn probe_router_serves_every_path(source_routes: &RouteSet) {
    use tower::Service;

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://drift:nopass@127.0.0.1:1/drift".to_string());
    let pool = hotel_app_be::core::db::DbPool::connect_lazy(&database_url)
        .expect("lazy pool construction cannot fail on URL parse");

    // config::from_env validates that DATABASE_URL is present even though this
    // test never opens a connection (the pool is lazy and probes stop at the
    // router). Supply a syntactically valid placeholder when the developer
    // environment has none.
    if std::env::var("DATABASE_URL").is_err() {
        // SAFETY: single-test test binary; no concurrent environment readers.
        unsafe {
            std::env::set_var(
                "DATABASE_URL",
                "postgres://openapi-drift:not-used@127.0.0.1:1/openapi_drift",
            );
        }
    }

    if std::env::var("JWT_SECRET").is_err() {
        // SAFETY: single-test test binary; config initialisation below is the
        // only environment reader and runs on this same thread.
        unsafe {
            std::env::set_var("JWT_SECRET", "openapi-drift-test-secret-0123456789abcdef");
        }
    }
    hotel_app_be::core::config::init_from_env().expect("test config initialises from env");

    let mut app = hotel_app_be::routes::create_router(pool);

    for (_, path) in source_routes {
        let concrete = replace_params(path);
        let request = axum::http::Request::builder()
            .method(axum::http::Method::OPTIONS)
            .uri(&concrete)
            .body(axum::body::Body::empty())
            .expect("well-formed probe request");
        let response = app
            .call(request)
            .await
            .unwrap_or_else(|e| panic!("probe {concrete}: {e}"));
        assert_ne!(
            response.status(),
            axum::http::StatusCode::NOT_FOUND,
            "path {path} is parsed from source but the router does not serve it"
        );
    }
}

/// Swap `{param}` template segments for a literal so the probe exercises the
/// same route match without pretending to hold a real id.
fn replace_params(path: &str) -> String {
    let re = Regex::new(r"\{[^}/]+\}").expect("static regex");
    re.replace_all(path, "_probe_").into_owned()
}
