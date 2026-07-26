# Reference Staleness Audit — 2026-07-26

Scanner: haiku subagent (refs-staleness dimension)
Target: `.claude/refs/*.md` line anchors + CLAUDE.md path claims

## Summary

Verified 4 refs files + CLAUDE.md. Found **12 stale function anchors** in booking-workflow.md and ledger-workflow.md (all >±15 lines off), **1 missing system file**, and **0 broken repo paths**.

---

## Stale Anchors in booking-workflow.md

| Claimed | Actual | Function | Offset |
|---------|--------|----------|--------|
| lifecycle.rs:1181 | lifecycle.rs:900 | create_booking_handler | -281 lines |
| lifecycle.rs:1613 | lifecycle.rs:1239 | update_booking_handler | -374 lines |
| lifecycle.rs:2492 | lifecycle.rs:1932 | delete_booking_handler | -560 lines |
| lifecycle.rs:2716 | lifecycle.rs:2096 | manual_checkin_handler | -620 lines |
| lifecycle.rs:981 | lifecycle.rs:726 | ensure_checkout_balance_resolved | -255 lines |
| lifecycle.rs:687 | lifecycle.rs:530 | auto_post_company_ledger | -157 lines |
| services/bookings.rs:74 | services/bookings.rs:139 | void_booking | +65 lines |
| services/bookings.rs:176 | services/bookings.rs:241 | manual_checkin | +65 lines |

**Root cause**: Likely a code refactor (e.g., function reordering or insertion above these functions) that shifted their line numbers since the 2026-07-12 rewrite.

---

## Stale Anchors in ledger-workflow.md

| Claimed | Actual | Function | Offset |
|---------|--------|----------|--------|
| ledger.rs:583 | ledger.rs:318 | create_customer_ledger | -265 lines |
| ledger.rs:1354 | ledger.rs:726 | create_ledger_payment | -628 lines |
| ledger.rs:1657 | ledger.rs:931 | void_ledger | -726 lines |
| ledger.rs:1814 | ledger.rs:980 | create_ledger_reversal | -834 lines |
| ledger.rs:2058 | ledger.rs:1079 | update_ledger_payment | -979 lines |

**Root cause**: Systematic off-by-large-offset suggests either a major refactoring, function reordering, or code insertion early in the file.

---

## Verified Inline Line Numbers (±15 tolerance)

Sampled inline references that are within ±15 lines are OK:
- ledger.rs:36 (settings-cache helper) → actual 34 ✓
- ledger.rs:1420-1427 (status logic) — not sampled; function moved so range likely shifted

---

## External Path References

**codex-collab.md claims:**
- `/Applications/Codex.app/Contents/Resources/codex` (verified 2026-07-07)
  - **Status**: ✗ NOT FOUND on this system
  - **Impact**: Code snippet in codex-collab.md will fail if executed; recipe is outdated
  - **Severity**: should-fix (documentation needs update; the CLI may have been removed or installed elsewhere)

**CLAUDE.md path claims** (all verified as existing):
- ✓ `hotel-desktop/BUILD_SPEED.md`
- ✓ `hotel-desktop/UPDATER.md`
- ✓ `docs/architecture/architecture-flow.md`
- ✓ `docs/guides/deployment.md`
- ✓ `docs/architecture/ADRS.md`
- ✓ `docs/ongoing-dev.md`
- ✓ `AGENTS.md`
- ✓ `hotel-app-be/.env.example`
- ✓ `hotel-app-be/README.md`

All `.claude/rules/*.md` files referenced in CLAUDE.md exist and are current.

---

## Recommendations

1. **Urgent**: Rewrite `.claude/refs/booking-workflow.md` line anchors by re-grepping each function name against the current state of lifecycle.rs and services/bookings.rs.

2. **Urgent**: Rewrite `.claude/refs/ledger-workflow.md` line anchors by re-grepping each function name against the current state of ledger.rs.

3. **Should-fix**: Update codex-collab.md to reflect the current location of the Codex CLI (or note it as unavailable).

4. **Process**: Add a pre-commit hook or CI check to validate that every `path:line` anchor in `.claude/refs/*.md` is within ±15 lines of the actual symbol, using a script like:
   ```bash
   for ref in .claude/refs/*.md; do
     grep -oE '[a-zA-Z_/\.]+\.rs:[0-9]+' "$ref" | \
       while IFS=: read -r file line; do
         if [ -f "$file" ]; then
           actual=$(grep -n "^pub\|^fn\|^async fn" "$file" | awk -F: '{if($1>=line-15 && $1<=line+15) print $1}' | head -1)
           if [ -z "$actual" ]; then
             echo "STALE: $file:$line (no symbol within ±15 lines)"
           fi
         fi
       done
   done
   ```

---

## Checked but Empty

- `.claude/rules/` — all files exist and paths in them are valid
- `hotel-app-be/database/` — no broken migrations or baseline SQL path claims
- `hotel-web-fe/src/` — no broken frontend file path claims in refs or CLAUDE.md
