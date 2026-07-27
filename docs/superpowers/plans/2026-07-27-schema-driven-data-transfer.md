# Schema-Driven Full Database Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export and restore all application-schema PostgreSQL tables through a forward-compatible JSON v2 transfer format while preserving v1 imports.

**Architecture:** Replace the fixed transfer-table registry with catalog-derived table descriptors, dependencies, and safe dynamic identifiers. Normalize v1 flat exports and v2 table maps into one internal representation, then use that representation for preview, export, selection, clear, insert, and sequence reset. The frontend consumes catalog metadata rather than a fixed table catalog.

**Tech Stack:** Rust, Axum, SQLx/PostgreSQL, serde_json, React 19, TypeScript, MUI, ky.

## Global Constraints

- Do not add dependencies.
- Preserve the existing endpoints and accept existing v1 export files.
- Include stored credentials, sessions, audit data, and runtime data exactly as requested.
- Use a single rollback-safe transaction for every import.
- Quote all dynamically derived schema, table, column, and sequence identifiers.

---

### Task 1: Backend v2 payload normalization and catalog metadata

**Files:**
- Modify: `hotel-app-be/src/models/data_transfer.rs`
- Modify: `hotel-app-be/src/repositories/data_transfer.rs`
- Modify: `hotel-app-be/src/services/data_transfer.rs`
- Test: inline Rust unit tests in the modified model/service files

**Interfaces:**
- Produces an internal `TransferData` table map keyed by `schema.table`.
- Produces catalog table descriptors containing name, count, dependencies, primary-key ordering, and partition status.

- [ ] **Step 1: Write failing model tests**

```rust
#[test]
fn v2_payload_keeps_schema_qualified_secret_rows() {
    let payload = json!({"version": "2.0", "exported_at": "2026-07-27T00:00:00Z", "tables": {"public.users": [{"password_hash": "hash"}]}});
    assert_eq!(normalize_transfer_payload(payload).unwrap().tables["public.users"][0]["password_hash"], "hash");
}
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `cargo test data_transfer::tests::v2_payload_keeps_schema_qualified_secret_rows`

- [ ] **Step 3: Implement the smallest v1/v2 normalizer and catalog descriptor types**

```rust
pub struct TransferData { pub tables: BTreeMap<String, Vec<Value>> }
```

- [ ] **Step 4: Run backend unit tests and verify they pass**

Run: `cargo test data_transfer::tests`

### Task 2: Schema-driven export and transactional restore

**Files:**
- Modify: `hotel-app-be/src/repositories/data_transfer.rs`
- Modify: `hotel-app-be/src/services/data_transfer.rs`
- Test: inline Rust unit tests in the modified service/repository files

**Interfaces:**
- Consumes `TransferData` and live catalog descriptors.
- Produces v2 export/preview payloads and restores selected tables in dependency order.

- [ ] **Step 1: Write failing ordering and qualified-name tests**

```rust
#[test]
fn orders_parent_before_child_and_rejects_unqualified_unknown_tables() {
    assert_eq!(topological_order(&graph), vec!["public.users", "public.sessions"]);
    assert!(validate_table_key("evil.table").is_err());
}
```

- [ ] **Step 2: Run targeted tests and verify they fail**

Run: `cargo test data_transfer::tests::orders_parent_before_child_and_rejects_unqualified_unknown_tables`

- [ ] **Step 3: Implement catalog discovery, partition-safe export, dynamic dependency order, clear, insert, trigger restoration, and sequence reset**

```rust
let table = QualifiedTable::parse(key)?;
let query = format!("SELECT row_to_json(t) FROM (SELECT * FROM ONLY {table} ORDER BY {order}) t");
```

- [ ] **Step 4: Run targeted backend tests and verify they pass**

Run: `cargo test data_transfer::tests`

### Task 3: Frontend v2 transport and dynamic table selection

**Files:**
- Modify: `hotel-web-fe/src/types/dataTransfer.types.ts`
- Modify: `hotel-web-fe/src/api/dataTransfer.service.ts`
- Modify: `hotel-web-fe/src/features/admin/components/DataTransferPage.tsx`
- Modify: `hotel-web-fe/src/features/admin/utils/dataTransferDependencies.ts`
- Test: `hotel-web-fe/src/api/dataTransfer.service.test.ts`

**Interfaces:**
- Consumes v2 preview table metadata and transfer maps.
- Produces selected v2 table maps for import and a warning for sensitive full exports.

- [ ] **Step 1: Write failing frontend transport tests**

```typescript
it('posts a v2 schema-qualified tables map for import', async () => {
  await DataTransferService.importData('import', v2Export, ['public.users']);
  expect(postJson).toEqual({ mode: 'import', data: v2Export, tables: ['public.users'] });
});
```

- [ ] **Step 2: Run the focused frontend test and verify it fails**

Run: `npm test -- src/api/dataTransfer.service.test.ts`

- [ ] **Step 3: Update transport types and table UI with metadata-driven labels/dependencies and a sensitive-data warning**

- [ ] **Step 4: Run frontend type-check and production build**

Run: `npx tsc --noEmit && npm run build`
### Task 4: Final verification

**Files:**
- Verify modified backend and frontend files

- [ ] **Step 1: Format Rust**

Run: `cargo fmt`

- [ ] **Step 2: Run backend checks**

Run: `cargo test data_transfer && cargo check --all-features && cargo clippy --all-features -- -D warnings`

- [ ] **Step 3: Run frontend checks**

Run: `npx tsc --noEmit && npm run build`
