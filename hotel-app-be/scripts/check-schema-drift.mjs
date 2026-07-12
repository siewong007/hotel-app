#!/usr/bin/env node
// Usage: node hotel-app-be/scripts/check-schema-drift.mjs
// Diffs database/schema.sql (PostgreSQL DDL) against the concatenation of
// database/sqlite_migrations/*.sql (SQLite DDL) and reports, per table, any
// table or column that exists on only one side. Exit 0 = no divergence,
// exit 1 = divergence found. This is a name-set diff via light regex/paren
// scanning, not a real SQL parser — see LIMITATIONS at the bottom of this
// file for what it deliberately does not model.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BE_ROOT = path.resolve(__dirname, '..');
const SCHEMA_SQL_PATH = path.join(BE_ROOT, 'database', 'schema.sql');
const SQLITE_MIGRATIONS_DIR = path.join(BE_ROOT, 'database', 'sqlite_migrations');

const TABLE_CONSTRAINT_KEYWORDS =
  /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i;

// ---------------------------------------------------------------------------
// Low-level scanning helpers (quote/paren aware, so commas and parens inside
// string literals or nested expressions don't confuse the splitter).
// ---------------------------------------------------------------------------

/** Strip "--" line comments, slash-star block comments, and Postgres
 * "DO $$ ... $$;" anonymous blocks. Respects single-quoted strings (with ''
 * escaping) and dollar-quoted strings ($tag$...$tag$) so we never strip
 * inside a literal. */
function stripCommentsAndDoBlocks(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    if (two === '/*') {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }

    if (sql[i] === "'") {
      out += sql[i];
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out += "'";
          i++;
          break;
        }
        out += sql[i];
        i++;
      }
      continue;
    }

    if (sql[i] === '$') {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const precedingMatch = /([a-zA-Z_][a-zA-Z0-9_]*)\s*$/.exec(out);
        const precedingWord = precedingMatch?.[1] ?? '';
        const isDoBlock = precedingWord.toUpperCase() === 'DO';
        const closeIdx = sql.indexOf(tag, i + tag.length);
        const blockEnd = closeIdx === -1 ? n : closeIdx + tag.length;
        if (isDoBlock) {
          // Drop the whole DO $$ ... $$ block, including a trailing ';'.
          // DO blocks are anonymous PL/pgSQL procedures (extension guards,
          // one-time data migrations, conditional ALTERs) — none of the
          // real CREATE TABLE / ALTER TABLE ADD COLUMN statements in this
          // repo live inside one (verified by inspection); dropping them
          // avoids phantom tables from dynamic EXECUTE'd DDL strings.
          //
          // Slice at the regex MATCH INDEX (start of the "DO" word), not
          // `length - word.length`: `out` usually ends with whitespace after
          // the DO, so a length-based slice removed "O\n" and left an orphan
          // "D" glued to the next statement — which then failed the anchored
          // ^CREATE match and silently dropped real tables from the diff.
          out = out.slice(0, precedingMatch.index);
          i = blockEnd;
          while (i < n && /\s/.test(sql[i])) i++;
          if (sql[i] === ';') i++;
          continue;
        }
        // Non-DO dollar-quoted string (CREATE FUNCTION ... AS $$body$$ etc):
        // replace the body with an empty literal instead of keeping it.
        // Function bodies contain semicolons, apostrophes, and unbalanced
        // parens that corrupt the downstream statement splitter — keeping
        // one verbatim once caused every statement after it (including the
        // real `CREATE TABLE guests`) to be mis-split and silently skipped.
        out += "''";
        i = blockEnd;
        continue;
      }
    }

    out += sql[i];
    i++;
  }
  return out;
}

/** Split `text` on `delimiter` (a single character) at paren-depth 0, outside
 * quotes. Returns trimmed, non-empty pieces. */
function splitTopLevel(text, delimiter) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === quote && text[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (c === delimiter && depth === 0) {
      pieces.push(text.slice(start, i));
      i++;
      start = i;
      continue;
    }
    i++;
  }
  pieces.push(text.slice(start));
  return pieces.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Given `text` with `openIdx` pointing at a '(', return the index of its
 * matching ')' (quote-aware). Returns -1 if unbalanced. */
function findMatchingParen(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === quote && text[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function unquoteIdent(token) {
  const t = token.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1);
  }
  return t;
}

function lastSegment(qualifiedName) {
  const parts = qualifiedName.split('.');
  return unquoteIdent(parts[parts.length - 1]);
}

// ---------------------------------------------------------------------------
// DDL -> Map<tableName, Set<columnName>>
// ---------------------------------------------------------------------------

function parseDdl(rawSql) {
  const cleaned = stripCommentsAndDoBlocks(rawSql);
  const statements = splitTopLevel(cleaned, ';');
  if (process.env.DRIFT_DEBUG_FIND) {
    statements.forEach((s, idx) => {
      if (s.includes(process.env.DRIFT_DEBUG_FIND)) {
        console.error(`[debug] fragment #${idx} (${s.length} chars) starts: ${JSON.stringify(s.slice(0, 160))}`);
      }
    });
  }
  const tables = new Map();

  const createRe =
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][\w.]*)"?\s*\(/i;
  const alterRe = /^ALTER\s+TABLE\s+(?:ONLY\s+)?"?([a-zA-Z_][\w.]*)"?\s+([\s\S]+)$/i;
  const addColumnRe =
    /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][\w]*)"?/i;

  for (const stmt of statements) {
    const createMatch = createRe.exec(stmt);
    if (createMatch) {
      const tableName = lastSegment(createMatch[1]).toLowerCase();
      const openIdx = stmt.indexOf('(', createMatch[0].length - 1);
      const closeIdx = findMatchingParen(stmt, openIdx);
      if (openIdx === -1 || closeIdx === -1) continue;
      const body = stmt.slice(openIdx + 1, closeIdx);
      const clauses = splitTopLevel(body, ',');
      const columns = new Set();
      for (const clause of clauses) {
        if (TABLE_CONSTRAINT_KEYWORDS.test(clause)) continue;
        const tokenMatch = /^"?([a-zA-Z_][\w]*)"?/.exec(clause);
        if (tokenMatch) columns.add(tokenMatch[1].toLowerCase());
      }
      // CREATE TABLE (re)defines the table from scratch — overwrite, which
      // also correctly models a preceding DROP TABLE IF EXISTS / RENAME TO
      // for the same name (the table's final shape is whatever the last
      // CREATE TABLE for that name says).
      if (process.env.DRIFT_DEBUG_TABLE === tableName) {
        console.error(`[debug] CREATE for "${tableName}" -> ${columns.size} cols`);
        console.error(`[debug] stmt head: ${stmt.slice(0, 300)}`);
      }
      tables.set(tableName, columns);
      continue;
    }

    const alterMatch = alterRe.exec(stmt);
    if (alterMatch) {
      const tableName = lastSegment(alterMatch[1]).toLowerCase();
      const rest = alterMatch[2];
      const actions = splitTopLevel(rest, ',');
      for (const action of actions) {
        const addMatch = addColumnRe.exec(action);
        if (!addMatch) continue; // ADD CONSTRAINT / DROP ... / RENAME ... etc: ignored
        if (!tables.has(tableName)) tables.set(tableName, new Set());
        tables.get(tableName).add(addMatch[1].toLowerCase());
      }
    }
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

function loadPostgresDdl() {
  return readFileSync(SCHEMA_SQL_PATH, 'utf8');
}

function loadSqliteDdl() {
  const files = readdirSync(SQLITE_MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return files
    .map((f) => readFileSync(path.join(SQLITE_MIGRATIONS_DIR, f), 'utf8'))
    .join('\n;\n');
}

// ---------------------------------------------------------------------------
// Diff + report
// ---------------------------------------------------------------------------

function diffAndReport(pgTables, sqliteTables) {
  const allTableNames = [...new Set([...pgTables.keys(), ...sqliteTables.keys()])].sort();

  const pgOnlyTables = [];
  const sqliteOnlyTables = [];
  const columnDivergences = [];

  for (const name of allTableNames) {
    const inPg = pgTables.has(name);
    const inSqlite = sqliteTables.has(name);
    if (inPg && !inSqlite) {
      pgOnlyTables.push(name);
      continue;
    }
    if (inSqlite && !inPg) {
      sqliteOnlyTables.push(name);
      continue;
    }
    const pgCols = pgTables.get(name);
    const sqliteCols = sqliteTables.get(name);
    const pgOnlyCols = [...pgCols].filter((c) => !sqliteCols.has(c)).sort();
    const sqliteOnlyCols = [...sqliteCols].filter((c) => !pgCols.has(c)).sort();
    if (pgOnlyCols.length > 0 || sqliteOnlyCols.length > 0) {
      columnDivergences.push({ table: name, pgOnlyCols, sqliteOnlyCols });
    }
  }

  const hasDivergence =
    pgOnlyTables.length > 0 || sqliteOnlyTables.length > 0 || columnDivergences.length > 0;

  console.log('Schema drift check: database/schema.sql (PostgreSQL) vs database/sqlite_migrations/*.sql (SQLite)');
  console.log('='.repeat(90));
  console.log(`PostgreSQL tables found: ${pgTables.size}`);
  console.log(`SQLite tables found:     ${sqliteTables.size}`);
  console.log('');

  if (!hasDivergence) {
    console.log('No divergence found: every table name and column set matches on both sides.');
    return 0;
  }

  if (pgOnlyTables.length > 0) {
    console.log(`Tables present ONLY in PostgreSQL (${pgOnlyTables.length}):`);
    for (const t of pgOnlyTables) console.log(`  - ${t}`);
    console.log('');
  }

  if (sqliteOnlyTables.length > 0) {
    console.log(`Tables present ONLY in SQLite (${sqliteOnlyTables.length}):`);
    for (const t of sqliteOnlyTables) console.log(`  - ${t}`);
    console.log('');
  }

  if (columnDivergences.length > 0) {
    console.log(`Tables with column-set divergence (${columnDivergences.length}):`);
    for (const { table, pgOnlyCols, sqliteOnlyCols } of columnDivergences) {
      console.log(`  ${table}:`);
      if (pgOnlyCols.length > 0) {
        console.log(`      PostgreSQL-only columns: ${pgOnlyCols.join(', ')}`);
      }
      if (sqliteOnlyCols.length > 0) {
        console.log(`      SQLite-only columns:     ${sqliteOnlyCols.join(', ')}`);
      }
    }
    console.log('');
  }

  return 1;
}

function main() {
  const pgTables = parseDdl(loadPostgresDdl());
  const sqliteTables = parseDdl(loadSqliteDdl());
  if (process.env.DRIFT_DEBUG_TABLE) {
    const t = process.env.DRIFT_DEBUG_TABLE;
    console.error(`[debug] pg["${t}"]: ${[...(pgTables.get(t) ?? [])].sort().join(',')}`);
    console.error(`[debug] sqlite["${t}"]: ${[...(sqliteTables.get(t) ?? [])].sort().join(',')}`);
  }
  const exitCode = diffAndReport(pgTables, sqliteTables);
  process.exit(exitCode);
}

main();

// ---------------------------------------------------------------------------
// LIMITATIONS (intentional, given this is a name-set diff, not a full parser)
// ---------------------------------------------------------------------------
// - Column TYPES and constraints (NOT NULL, DEFAULT, CHECK, FK) are not
//   compared — only column NAME presence per table.
// - `ALTER TABLE ... RENAME TO`, `RENAME COLUMN`, and `DROP COLUMN` are not
//   modeled. A CREATE TABLE for a given name always overwrites any prior
//   tracked definition for that name (correctly modeling DROP+CREATE /
//   sequential-migration patterns already used in this repo), but a rename
//   with no follow-up CREATE TABLE under the old name will make the old name
//   look "missing" rather than "renamed" — which is usually the right signal
//   for a drift check anyway.
// - Postgres `DO $$ ... $$` anonymous blocks are stripped entirely before
//   parsing (verified against the current schema.sql: none of them contain
//   the authoritative definition of a table's column set — the one block
//   that dynamically recreates `audit_logs` for partitioning defines the
//   same columns as the table's top-level CREATE TABLE).
// - Views, sequences, indexes, triggers, functions, and enum types are
//   ignored entirely.
