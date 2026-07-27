# Schema-Driven Full Database Transfer Design

## Goal

Make data transfer export and restore every application table in the live PostgreSQL schema, including credentials, sessions, audit records, and runtime data, without requiring a code change for each new table.

## Format and compatibility

New exports use version `2.0` and contain a `tables` object keyed by schema-qualified table names, for example `public.users` and `app.invalid_data_quarantine`. Each value is an array of raw JSON rows. The export also records the current schema revision when available.

The import endpoint accepts both formats. Existing version `1.0` flat payloads are normalized to their existing `public.<table>` entries. New clients use table metadata returned by the preview endpoint instead of a hard-coded list. Exported rows preserve every stored value, including password hashes, passkeys, recovery data, refresh tokens, sessions, and audit history.

## Discovery and ordering

The backend discovers ordinary tables and partition leaves from PostgreSQL catalog metadata. It excludes system schemas only; `public` and application-owned schemas are included. Partitioned parents are queried with `ONLY` so rows are never duplicated with their leaf partitions.

The backend obtains the foreign-key graph from PostgreSQL and topologically orders selected tables for insertion. Overwrite clears the same graph in reverse. Cycles are reported before mutating data unless the database defines deferrable constraints that can be deferred for the transaction.

## Restore safety

Every destination table and column is validated against the live schema and quoted before dynamic SQL. Import uses one transaction; an invalid table, row, column, FK graph, or insert rolls back the entire request. It preserves source rows exactly, suppresses user triggers only for tables that need it, restores trigger state on every exit path, and resets owned sequences after successful insertion.

The UI keeps selective export/import, derives its table list and dependencies from preview metadata, and warns that exports contain active credential and session material. Existing permissions and audit logging remain in place.

## Testing

Unit tests cover v1-to-v2 normalization, qualified table validation, partition query behavior, FK ordering and reverse clear ordering, and the rejection of unknown destination tables. Existing frontend tests are updated for the v2 request and response contracts. Backend compilation, linting, frontend type-checking, and frontend production build provide final verification.
