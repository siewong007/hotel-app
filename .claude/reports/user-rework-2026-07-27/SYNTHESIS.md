# SYNTHESIS — user-domain rework

Adjudicated 2026-07-27 from 8 auditor reports + 8 adversarial verifier reports in this
directory, plus `commander-findings.md` (main-session evidence) and `TEAMS-DESIGN.md`.

**This is the document an implementation session works from.** Everything below is either
(a) a finding with a verifier verdict, (b) my own re-check, or (c) explicitly labelled
UNVERIFIED. Nothing in this workflow was *executed* — see §5.

Path warning: the volume name has a trailing space (`/Volumes/APPLE EXTERNAL SSD /`).
Quote every shell path.

Counts: **41 confirmed · 6 refuted-or-materially-corrected · 9 unverified**
(a "finding" here = a deduplicated row in §1; source findings merged into one row count once).

---

## 1. VERDICT TABLE

Severity is my final call. `Sources` lists the auditor ids merged into the row; where two
dimensions found the same defect from different angles that is stated. `V` = verifier verdict
(C = confirmed, P = partial/corrected, R = refuted as stated, — = never sent to a verifier).

### 1.1 Blockers

| id | title | sev | V | sources | evidence (file:line) | note |
|---|---|---|---|---|---|---|
| **S-01** | Role-grant guard is priority-only, never permission-superset — a `manager` can self-assign `senior_reviewer` and gain `ekyc:override` | blocker | C | RBAC-1; rbac-verify add'l #2 | `src/services/rbac.rs:332-357` (**re-read by me this session**: body is exactly `if role_priority >= actor_priority { Forbidden }`); route `POST /users/roles` gated only by `users:update` (`routes/users.rs:25,97`); seed priorities manager 80 / senior_reviewer 75 (`data.sql:389,396`) | Same root cause in a **second** path: `assign_permission_to_role`/`remove_permission_from_role`/`replace_role_permissions` (`services/rbac.rs:111-149`) check only role priority, never whether the actor holds the permission being granted. Merge the fix. |
| **S-02** | `audit_logs.ip_address` is `inet`, decoded into `Option<String>` with no cast — any non-null row makes `GET /audit-logs` and the CSV export 500 | blocker | C | sql #1 | `models/audit.rs:72` (**re-read by me**: `pub ip_address: Option<String>`); `repositories/audit.rs:112-113,198-199` (**re-read**: `SELECT … a.ip_address …` no `host()`/`::text`); `migrations/0001_v1_baseline.sql:1154` `ip_address inet`; poison rows already written by `handlers/webhooks.rs:93,121` (merged commit 214305432) | The codebase already knows the fix: `core/auth.rs:396` uses `host(ip_address) AS ip_address` for the sibling `refresh_tokens.ip_address`. Verifier traced sqlx 0.8.6 source to prove the decode path (`String::compatible` has no INET). |
| **S-03** | `loyalty:manage` is declared expected but never inserted — 7 live loyalty endpoints are permanently 403 for **everyone incl. super_admin** on a fresh V1 install | blocker | C | RBAC-2 | `data.sql:101-102` (expected) vs the real `INSERT INTO permissions` `data.sql:414-517` (absent); 7 call sites `modules/loyalty/routes.rs:117,130,172,190,200,219,230` | `:manage` fallback cannot rescue it — deriving manage from `loyalty:manage` yields itself (`core/rbac_cache.rs:122-132`). Present in `upgrade/pg18_4_to_v1.sql:4865`, so upgraded DBs hide the bug. |
| **S-04** | `audit:export` is declared expected but never inserted — the audit CSV export route is unreachable by any role on a fresh install | blocker | C | RBAC-3 (rated high); audit-trail #1 (rated blocker) | `data.sql:58` expected vs `:414-517` absent (only `audit:read` at `:498`); gate `routes/audit.rs:81` on the literal `"audit:export"` | **Merged from two dimensions.** I take audit-trail's blocker over rbac's high: no `audit:manage` exists even in the *expected* list, so there is no theoretical rescue, and this is a compliance feature. |
| **S-05** | X-Forwarded-For spoof: the shipped nginx recipe **appends** XFF while `extract_client_ip` takes the **first** (client-controlled) entry — every IP-keyed limiter is bypassable once `TRUST_PROXY_HEADERS=true` | blocker | P | R-1; rate-limit-verify missed #2 | `routes/mod.rs:56-73` (`.split(',').next()` at :64); `docs/guides/deployment.md:190` `$proxy_add_x_forwarded_for`; `SECURITY.md:53` says to enable it only behind a proxy that **overwrites** — the repo contradicts itself | **Impact corrected:** password guessing is *not* unlimited (per-account DB lockout at `services/auth.rs:75,82-113` fires regardless of IP). The blocker rating survives on the 2FA/recovery-code path (S-18), which has no account-side backstop at all. Caddy path is clean (verified: no `trusted_proxies` ⇒ Caddy discards inbound XFF). |

### 1.2 High

| id | title | sev | V | sources | evidence | note |
|---|---|---|---|---|---|---|
| **S-06** | `data.sql`'s own `missing_seed_count` guard is computed and then discarded — the root cause of S-03/S-04/S-27 | high | C | sql #2; rbac-verify add'l #1; audit-trail-verify add'l #4 | `data.sql:1091` declare, `:1144-1162` compute, **no `IF … RAISE`** anywhere in the DO block `:1087-1222`; siblings `invalid_count` (:1138), `unknown_route_permission_count` (:1176), `unknown_route_role_count` (:1195) all raise | Blast radius measured twice independently: **26 of 129** expected permissions (rbac-verify) / 25 (audit-trail-verify) are declared-but-not-inserted. Only 3 are load-bearing today (S-03, S-04, S-27); the rest are `navigation_*`/`permissions:*` and currently inert. Fix the guard, not the instances. |
| **S-07** | Passkey login never consults `two_factor_enabled` — complete 2FA bypass | high | C | AUTH-01 | `services/passkey.rs:243-337` `login_finish`; `grep -n "two_factor" src/services/passkey.rs` → no matches | Aggravating detail from the verifier: `repositories/passkey.rs:77-88` **selects** `two_factor_enabled/secret/recovery_codes` into the `User` and then never reads them. |
| **S-08** | Passkey login never consults `is_locked`/`locked_until` — account-lockout bypass | high | C | AUTH-02 | `repositories/passkey.rs:82` WHERE is exactly `username = $1 AND is_active = true AND deleted_at IS NULL` | |
| **S-09** | The entire passkey subsystem writes zero audit rows — register, delete, rename, login success, and every login failure | high | C | AUTH-03; audit-trail #3; structure-verify missed #2 | `grep -n "AuditLog" src/services/passkey.rs` → no matches (723-line file); `login_finish` mints refresh token + JWT at `:313-323` with no audit call | **Merged from three dimensions.** An attacker-registered passkey is durable account takeover with no trace. |
| **S-10** | Every login audit row hardcodes `ip_address`/`user_agent` to `None` although both are threaded into the service | high | C | AUTH-15; audit-trail #5 | 8 sites `services/auth.rs:37,42,56,99,116,130,198,248` all pass `None, None`; the real values are used once, at `:228` (`store_refresh_token`); signatures accept them (`services/audit.rs:60-65,88-93`) | **Merged.** Nuance: for *successful* logins IP/UA survive indirectly in `refresh_tokens`; for *failed* logins nothing is created, so they are unrecoverable — that is the real teeth. Also `log_password_changed(pool, user_id)` (`services/audit.rs:316`) has no ip/ua params at all. |
| **S-11** | 9 of 13 mutating functions in `services/rbac.rs` write no audit row — incl. `replace_role_permissions`, `delete_role`, `create/update/delete_permission` | high | P | RBAC-5 (stated "8 of 11"); audit-trail #4; structure-verify missed #1; tests-verify missed #3 | Unaudited: `:15-17, :72-84, :111-120, :122-132, :134-149, :192-216, :218-241, :243-267, :269-291`. Audited: `:57, :93, :106, :171/174` | **Count corrected to 9 of 13** (RBAC-5's own evidence listed 9 names; the title's arithmetic was wrong). Actor id *is* already threaded to the route layer for 5 of them (`routes/rbac.rs:153,168,180,197,208`) — it is simply unused. |
| **S-12** | Self-service profile update needs no re-auth and writes no audit row — including the email change, which is the account-recovery channel | high | C | AUTH-16; audit-trail-verify add'l #2; structure-verify missed #5 | `services/profile.rs:23-97` (zero `AuditLog::` in the function; the same file audits `update_password` at `:133` and `revoke_session` at `:169`); `models/user.rs:118-131` has no current-password field; repo-wide `grep -rn "step_up\|reauth\|fresh_auth"` → nothing but `require_auth` substrings | **Merged from three dimensions.** There is no step-up-auth mechanism anywhere in the backend. |
| **S-13** | System roles are protected from rename/delete but **not** from permission-membership mutation | high | C | RBAC-4 | `services/rbac.rs:111-120,122-132,134-149` call only `ensure_actor_can_manage_roles`, never `RbacRepository::role_system_status` — contrast `update_role` (:192-216) and `delete_role` (:218-241) which do | Gated behind `permissions:manage`, which in the shipped seed only admin/super_admin hold (`data.sql:534`) — so it is not a *new* capability today, but the RBAC UI exists precisely to grant that permission to custom roles. |
| **S-14** | A rate-limit rejection is never logged, counted, or audited anywhere — a credential-stuffing run is invisible after the fact | high | C | R-7; commander C6 | `grep -rniE "log::(warn\|info\|error).*rate.?limit"` → exit 1, zero matches; 429 branch `routes/auth.rs:68-76` returns `ApiError` only; same shape `routes/two_factor.rs:32-52` | |
| **S-15** | Zero rate limiting on `/users` (create/update/delete/roles), all of `/rbac/*`, and all authenticated profile/session/passkey-management routes; `RateLimiters::api` is dead code | high | C | R-3; rate-limit-verify missed #3 | `routes/users.rs` (127 lines, no limiter reference); `routes/rbac.rs` same; `routes/profile.rs:22-40` — only `/profile/password` and profile-2FA use `limiters.sensitive`; `core/rate_limiter.rs:208-210,245-262` both `#[allow(dead_code)]`, zero external callers | **Merged.** |
| **S-16** | Default `TRUST_PROXY_HEADERS=false` behind any reverse proxy collapses every per-IP limit into one whole-site bucket (self-inflicted login DoS) | high | P | R-2 | `routes/mod.rs:57-58`; `.env.example:79`; peer addr comes from `into_make_service_with_connect_info::<SocketAddr>()` (`main.rs:262`) | **Citation corrected:** the flag lives at `docker-compose.yml:40`, not :33 (:33 is the port mapping). Substance holds. Note S-05 and S-16 are the two horns of the same dilemma — fix both together with a trusted-proxy-hop design. |
| **S-17** | `AuditLog::log_event` swallows DB errors and returns `Ok(())`; the user domain is the **only** domain group still on it — every other domain uses `log_event_tx` | high | P | audit-trail #2 (rated blocker) | `services/audit.rs:28-48` (unconditional `Ok(())` at :47) vs `log_event_tx` `:50-57` which propagates; 24 call sites across auth/rbac/users/profile/two_factor all route through `log_event`; `log_event_tx` has 29 call sites in bookings/payments/housekeeping and **all 7 migrated modules** | **Downgraded blocker→high** by the verifier: conditional on a DB failure, and the code comments it as a deliberate fail-open. Whether it should stay fail-open is a policy question (§4 Q2). |
| **S-18** | 2FA/TOTP/recovery-code guessing during login has **no account-level lockout at all** — only the per-IP limiter, which S-05 defeats | high | C | rate-limit-verify missed #1; AUTH-06 (rated medium) | `services/auth.rs:123-210`: the wrong-code branch returns `Unauthorized` at :206 with no `update_failed_login_attempts`/`lock_user_after_failure`; those fire only in the earlier password branch (:81-121) | **Merged and promoted** from AUTH-06's medium: the verifier showed it is materially more exploitable than the password path, and it is the reason S-05 keeps blocker rating. |
| **S-19** | `route_access_policies` changes — the authorization config itself — are audited with only `{"route_id": …}`, no old or new values | high | C | audit-trail-verify add'l #3 | `services/rbac.rs:49-70` is the only mutation path (`repositories/rbac.rs:301-339` is a blind UPDATE with no prior SELECT); audit call at :57-68 | |
| **S-20** | Failed 2FA verify/disable/regenerate attempts are unaudited; `verify_2fa_code` has zero audit on success *or* failure | high | C | audit-trail-verify add'l #1 | `services/two_factor.rs:220-246` (no AuditLog on either branch); invalid-code branches at `:87-89, :173-177, :269-271` all return `Err` with no audit | Asymmetric with the password-login path, which audits every failure. |
| **S-21** | `settings:update` writes no audit row, although `AuditLog::log_settings_changed` (with a full before/after diff) already exists and has **zero callers** | high | C | structure #1 | `modules/settings/service.rs:19-30` calls only the repository + cache invalidation; `services/audit.rs:332-357` defines the helper; `grep -rwo log_settings_changed src tests` → the definition line only | Outside the user domain strictly, but the audit module is being reworked and this is a one-line fix in the same pass. |
| **S-22** | `user_roles.assigned_by` and `role_permissions.granted_by` are never written — "who granted this account admin?" is unanswerable from the authorization tables | high | — | commander C2 | All 4 insert sites are `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`: `repositories/rbac.rs:161,466`, `repositories/user.rs:127`, `repositories/auth.rs:266`; `grep -rn "assigned_by\|granted_by" --include="*.rs" src/` → one hit, a JSON detail key at `services/audit.rs:126` | Columns already exist ⇒ code-only fix, no patch needed. Verified by the main session, not by a dimension verifier. |
| **S-23** | `users.is_super_admin` is enforced nowhere; `require_super_admin_helper` is `#[allow(dead_code)]` with zero call sites | high | — | commander C4; structure-verify missed #4; tests-verify add'l #4 | `core/middleware.rs:129-152`; `grep -rn "require_admin_helper\|require_super_admin_helper" src/` → definitions + re-exports (`lib.rs:19-20`, `core/mod.rs:32-33`) only | Nothing distinguishes the bootstrap administrator from any holder of `users:manage`. This is what makes S-01 and S-13 unbounded at the top. §4 Q6. |
| **S-24** | eKYC module defines its own `client_ip()` that reads `X-Forwarded-For`/`X-Real-IP` with **no** `trust_proxy_headers` gate and no peer fallback | high | — | commander C5 | `src/modules/ekyc/routes.rs:395-405`; used at `:136,179,197,215,235,255,280,315,334,381`; correct pattern already in `modules/promotions/handlers.rs:22-24` (**re-read by me**: delegates to `crate::routes::extract_client_ip`) | Identity-verification audit events attributed to a client-chosen string. Independent of S-05: this one is spoofable even when `TRUST_PROXY_HEADERS=false`. |
| **S-25** | Test coverage: user CRUD 0/5, passkey service 0/7, permission CRUD 0/3, profile service 0/2, audit repository 0/6; **no HTTP-level 401/403 test exists anywhere** | high | C | tests: user-crud-zero-test-coverage, passkey-service-zero-coverage, no-http-level-401-403-test, audit-repo-list-export-uncovered; tests-verify add'l #1,#2 | `grep -rn "create_user(\|update_user(\|delete_user(" tests/*.rs` → zero; the 7-name passkey grep → zero; `grep -rln "reqwest\|oneshot\|TestServer\|tower::ServiceExt" tests/*.rs` → zero files | This is *why* S-02 shipped. Promoted to high because it is the gate that would have caught three of the blockers. |
| **F1** | Four pages render destructive controls to read-only users (route policies OR read+write permissions; no component re-checks the write permission) | high | C | frontend F1 | `NightAuditPage.tsx:813-821` (0 `hasPermission` in file) vs `routes/night_audit.rs:43` `night_audit:execute`; `PaymentApprovalsPage.tsx:323,347,430` vs `routes/payments.rs:227,237,248` `payments:approve`; `ComplimentaryManagementPage.tsx:185-193,696-712`; `RBACManagementPage.tsx` (842 lines, 0 hasPermission) + `UsersTab.tsx:325-332,373-379`; gate semantics `ProtectedRoute.tsx:44` `.some(...)` | UX/correctness, not a security hole (backend re-validates). Correct pattern already exists: `SettingsPage.tsx:149-150` (`disabled={!isAdmin}` ×24), `DataTransferPage.tsx:300-306`. |
| **F2** | The whole parallel Roles/Permissions tab tree (~1859 lines, 12 files) is dead, and consequently there is **no live UI** to edit route access policies **or to create/update/delete a permission** | high | C | frontend F2; frontend-verify add'l #2 | `rbac/index.ts:15,18` is the only referrer; `routeRegistry.tsx:63` imports `RBACManagementPage` directly; `useUpdatePermission`/`useDeletePermission` have zero callers; `useCreatePermission`'s only caller is the dead `PermissionsTab.tsx:61`; `AdminService.updateRouteAccessPolicy` (`admin.service.ts:52-60`) zero production callers | **Merged.** Today an operator must edit the database by hand to add a permission. Line count corrected 1877→1859. |

### 1.3 Medium

| id | title | sev | V | sources | evidence | note |
|---|---|---|---|---|---|---|
| **S-26** | `user_roles.expires_at` is never read and never written — temporary role grants are permanent by construction | medium | P | commander C1 (rated blocker); sql #3 (rated high) | Column at `baseline:4790`; 8 expiry-blind resolution queries: `core/rbac_cache.rs:90-101,103-113`, `core/auth.rs:459,475`, `repositories/rbac.rs:228,393,489`, `repositories/user.rs:422,441,464`; 4 insert sites omit the column | **Explicit disagreement recorded.** The commander rated this blocker; the sql verifier downgraded to medium because *nothing today writes a non-null value*, so the risk is 100% prospective. I side with the verifier **for today** — and note it becomes blocker-class the moment Teams ships (`TEAMS-DESIGN.md` honours `team_members.expires_at`), so it must be fixed *in the same phase* as the resolution-query rewrite, not deferred. |
| **S-27** | `rooms:write` (8 call sites) is never seeded — silently degrades to full `rooms:manage` | medium | C | RBAC-6 | `routes/rooms.rs:97,116`; `routes/rates.rs:57,94,113,150`; `services/rooms.rs:425,556`; `data.sql:164` expected, absent from `:414-517`; rescued by `rooms:manage` (`data.sql:430`, granted to manager at `:540`) | Every caller works today but at a wider privilege than the code claims to require. Closes with S-06. |
| **S-28** | The `<resource>:manage` fallback is implemented three times over, and the middleware copy is provably inert | medium | C | RBAC-7; RBAC-8; sql #5; commander C3 | `core/rbac_cache.rs:122-132` already ORs the derived manage; `core/middleware.rs:43-53` derives and re-checks it (can never flip a false to true); `routes/users.rs:21-25` const arrays add a third loop | **Merged from four sources.** Worst case 4 permission resolutions for one denied request. |
| **S-29** | The permissions/roles join query exists in **three** independent copies | medium | C | structure #2; structure-verify missed #3 | `core/auth.rs:450-468,470-484`; `repositories/rbac.rs:223-237,480-498`; `core/rbac_cache.rs:90-113` (its own comment at :89 admits it is a deliberate copy) | Three places to fix for S-26/Teams. Must collapse to one before the resolution query changes. |
| **S-30** | Duplicate 2FA route surface: `/auth/2fa/*` (6 routes) and `/profile/2fa/*` (5 routes), both merged, both delegating to the same handlers | medium | P/R | structure #3 (C); AUTH-18 (**REFUTED as stated**) | `routes/mod.rs:226,239` (**re-read by me**: both merges present); `routes/profile.rs:35-39`; `routes/two_factor.rs:21-29`; FE splits across both (`auth.service.ts:95,103,108,112,116`) | **AUTH-18's claim that `/auth/2fa/*` is "built but never merged" is false** — I confirmed the merge at `routes/mod.rs:239` myself. The verifier further showed the impact claim (a fix landing in only one surface) is false for anything inside the shared handler; only the route wrapper boilerplate duplicates. Security severity: **low**. Migration severity: **medium** — it is a product decision (§4 Q4) that must be made before the move. |
| **S-31** | `GET /users` has no pagination and no cap | medium | C | R-8 | `routes/users.rs:42-48` (no `Query` extractor) → `repositories/user.rs:48-55` `SELECT … FROM users WHERE deleted_at IS NULL ORDER BY username`, no LIMIT/OFFSET | |
| **S-32** | `PUT /users/{id}/roles` accepts an unbounded `role_ids` array, inserted one row at a time inside one held transaction, on an unthrottled route | medium | C | R-9 | `models/rbac.rs:66-69` (`UserRoleIdsInput`, no `Validate` derive at all); `repositories/rbac.rs:448-478` per-element loop; no `DefaultBodyLimit` override on this router | Compounds with S-15. |
| **S-33** | Rate-limiter maps have no size cap between 5-minute prunes | medium | C | R-4 | `core/rate_limiter.rs:76,130` HashMaps; prune loops `:87-103,141-156` sleep 300s; no max-size check in the 328-line file | Only matters given S-05 or a botnet. |
| **S-34** | `hotel-desktop/src-tauri/database/postgres/patches/` is missing 11 of the 12 patches | medium | C | sql #4 | `diff -rq` between the two patch dirs → 11 "Only in hotel-app-be/…" lines, covering 2026-07-21 through 2026-07-27; baseline/data/seed are byte-identical | Exactly the class of gap lesson 2026-07-26j already hit. Any new patch this rework ships must land in both trees. |
| **S-35** | Dead schema surface: `user_permissions` (table+PK+2 CASCADE FKs+index), `user_sessions` (table) and `cleanup_expired_sessions()` (function), and 5 WebAuthn attestation columns on `passkeys` | medium | C | sql #7; sql-verify missed #1, #2 | `grep -rn "FROM/INTO/UPDATE user_permissions" src/` → zero; `grep -rn "user_sessions" src/ data.sql seed.sql` → zero; `grep -rn "cleanup_expired_sessions" src/` → zero; `passkeys.transports/device_type/aaguid/backup_eligible/backup_state` (`baseline:3716-3721`) never in the `Passkey` struct (`models/auth.rs:209-219`) or the INSERT (`repositories/passkey.rs:148`) | **Merged.** Real session tracking is `refresh_tokens` (`core/auth.rs:391-404`), so `user_sessions` is superseded, not half-built. Needs a keep-or-drop decision during the move. |
| **S-36** | `roles.display_name` is set once at creation and never updated — and in fact **never read by any query** | medium | P | sql #6 | `repositories/rbac.rs:104` derives it; `:525-545` `update_role` omits it; `grep -rn "display_name" src/` → only those write sites (+ an unrelated night_audit field); FE `types/rbac.types.ts:4-9` has no such field | **Impact refuted:** the auditor claimed an admin sees a stale display name in the RBAC UI. No read path exists, so nothing is user-visible. Reframed as a dead column needing a keep-or-drop decision. |
| **S-37** | `audit_logs` monthly partitions are pre-created for 12 months at install and never again; no Rust caller of `ensure_audit_logs_partition`, no pg_cron, no retention policy | medium | C | commander C8; audit-trail #8; sql-verify missed #3 | `baseline:275-319` (function + its own "pre-create during maintenance" comment at :319); one-time loop `baseline:9595-9607`; `grep -rn "ensure_audit_logs_partition" src/ --include="*.rs"` → zero; only 3 schedulers spawn at `main.rs:211-225` | **Merged from three sources.** ~12 months after install, rows silently land in `audit_logs_default`; fixing it later needs an exclusive-lock `SPLIT PARTITION`. `night_audit_scheduler` is the already-wired place to call it. |
| **S-38** | Audit content quality: `user_updated` records only changed *field names* (activate and deactivate are indistinguishable); role assignment records no role name or permission snapshot and files under `resource_id = user_id`; `create_user` records no `role_ids` | medium | C | audit-trail #6, #7; audit-trail-verify add'l #5 | `services/users.rs:234-272` returns `Vec<&'static str>`; audit call `:154-165`; `services/audit.rs:117-141,144-168` details are ids only, `resource_id: Some(user_id)` at :135 and :162; `services/users.rs:61,63-74` | **Merged.** |
| **S-39** | Duplicated primitives across the domain: two byte-identical `password_hash` queries (one with `deleted_at IS NULL`, one without), 17 copy-pasted rate-limit boilerplate blocks, and refresh-cookie builders imported handler→handler | medium | P | structure #5, #6, #4 | `repositories/auth.rs:85-91` vs `repositories/user.rs:296-303`; `check_with_retry` at profile.rs ×5, two_factor.rs ×5, passkey.rs ×4, auth.rs ×3 = **17** (auditor said 16; passkey uses `.auth` at **two** sites, :82,:104, not one); `handlers/passkey.rs:7,86` imports `handlers::auth::build_refresh_cookie` | **Merged**, counts corrected. |
| **S-40** | `routes/profile.rs` owns three domains — 8 of its 13 route closures delegate outside `handlers::profile` | medium | C | structure #7 | `handlers::profile::` at :49,58,81,93,102; `handlers::passkey::` at :112,121,131; `handlers::two_factor::` at :156,178,200,208,230 | Strongest-evidenced structural finding; drives the module split. |
| **S-41** | The `backend` CI job's "Cargo test" step sets no `DATABASE_URL`, so every `postgres_*` test silently returns early there | medium | P | tests: ci-backend-job-test-step-no-op (rated high) | `ci.yml:108`; early-return guards `tests/rbac_profile.rs:55-61`, `tests/auth_session.rs:119-126` | **Downgraded high→medium:** job `backend-postgres-smoke` (`ci.yml:134-233`) runs the *same* test set against a real `postgres:19beta2` on the same triggers, so CI is not blind — the step is a misnamed no-op, not a hole. **UNVERIFIED:** whether `backend-postgres-smoke` is a *required* status check is a GitHub branch-protection setting, not visible in-repo. |
| **S-42** | Kubernetes/Swarm scale-out silently multiplies every rate limit; docs suggest `Deployment` with no caveat | medium (latent) | C | R-6 | `core/rate_limiter.rs:4` doc comment; `routes/mod.rs:200,256` (one shared instance); `grep -n "deploy:\|replicas:" docker-compose.yml` → zero; `docs/guides/deployment.md:205-214` | Correctly self-labelled latent — no k8s manifest exists in-repo. |
| **S-43** | Login response text distinguishes no-such-user / wrong-password / unverified / inactive — user enumeration | medium | P | AUTH-04 (rated blocker) | `services/auth.rs:34-46` (inactive at :39, none at :44), `:68-71` (unverified, returns before the password hash is even fetched at :74), `:117-120` (wrong password, plus a remaining-attempts count) | **Downgraded blocker→medium:** grants no access by itself and is throttled by the 5/60s `auth` limiter. Related: registration is a *stronger* oracle (`services/auth.rs:395-399` returns "Username or email already exists") — fixing login alone leaves it live. §4 Q5. |
| **S-44** | No password-reuse/history check on any change path | medium | C | AUTH-10 | `grep -rniE "password_history\|previous_password\|password_reuse" src/ database/` → zero hits | |
| **S-45** | Passkey registration requires only `require_auth` — no step-up, although the credential it mints bypasses 2FA (S-07) | medium | C | AUTH-17 | `routes/passkey.rs:46,69`; contrast `services/two_factor.rs:84-96` which requires a fresh TOTP **and** a single-use setup challenge before enabling 2FA | Chains with S-07 into a persistent bypass; the verifier declined to raise the severity but flagged the chain. |
| **F3** | `AuthContext.user` is never refreshed after a profile edit — the nav header shows the stale name until a full reload | medium | C | frontend F3 | `useProfileQueries.ts:28-36` (only `setQueryData`); `AuthContext.tsx:33-44` exposes no `updateUser`/`setUser`; 9 `setAuthState` sites (100,113,134,148,178,266,284,329,573) none reachable from a profile edit; consumer `NavigationTabs.tsx:81-83` | |
| **F4** | RBAC/user mutations never invalidate `queryKeys.audit.all`, unlike all 6 other domains | medium | C | frontend F4 | `useRBACQueries.ts:21-23` invalidates `rbacQueryKeys.all` only, across 11 call sites; `queryInvalidation.ts:13,24,36,46,57,70` all invalidate audit; no `invalidateRbacDependencies` exists | |
| **F5** | `AuditLogPage` uses browser-local date handling both to **render** and to **filter** — the naive filter strings are reinterpreted in the *hotel's* timezone by the backend, returning the wrong window of rows | medium | C | frontend F5; frontend-verify add'l #3 | Render: `AuditLogPage.tsx:118-149` raw `new Date()` getters instead of `utils/date.ts:109,122`. Filter: `toLocalInput` at `:142-143` → `:309-310` → `audit.service.ts:23-24` → `repositories/audit.rs:315,319` binds the zone-less string to `::timestamptz`, resolved in the session (hotel) timezone | **Merged; the filter half is a data-correctness bug, not a label bug** — and it was not in the original finding. |
| **F6** | 6 single-item RBAC/user API methods are dead (superseded by bulk "replace" endpoints) | medium | C | frontend F6 | `admin.service.ts:52-60,112-114,116-118,124-126`; `users.service.ts:86,90` — each has exactly 2 hits: its definition and its own test file | |
| **F7** | The RBAC UI's "built-in role" protection is a client-side name regex, because the roles API never exposes `is_system_role` | medium | — | frontend-verify add'l #1 | `RBACManagementPage.tsx:101-102` regex, consumed at :579; `types/rbac.types.ts:4-9` and `models/rbac.rs:9-16` both lack the field; the column exists at `baseline:4189` and is read only via `RbacRepository::role_system_status` at delete time | False positives ("Front Desk Lead" undeletable) and false negatives (round-trip rejection). Fix by adding the field to the API response. |

### 1.4 Low / nit

| id | title | sev | V | source | evidence |
|---|---|---|---|---|---|
| S-46 | `src/routes/loyalty.rs` (191 lines) is fully orphaned — declared `pub mod loyalty` but never merged | low | — (**re-checked by me**) | RBAC-9 | `routes/mod.rs:23` declares it; `:221` merges `crate::modules::loyalty::routes::routes()` instead; `routes/mod.rs:19` comment acknowledges it |
| S-47 | Dead authorization helpers: `require_admin_helper` → `check_admin_role` → `AuthService::check_role`, and `require_super_admin_helper`; plus `UserRepository::get_roles/get_permissions/has_permission` | low | C | RBAC-10; structure-verify missed #4; sql #10 | `core/middleware.rs:82,123,131` all `#[allow(dead_code)]`; only real `check_role` caller is `services/search.rs:14` (a guest check); `repositories/user.rs:417-475` zero callers |
| S-48 | Login timing oracle: bcrypt is skipped entirely for nonexistent/inactive users | low | P | AUTH-05 (rated blocker) | `services/auth.rs:33-46` returns before `:74`/`:77-79`. **Downgraded blocker→low**: S-43 leaks the same fact for free over the response body. |
| S-49 | Failed-login counter is read-then-write, not `= failed_login_attempts + 1` — a narrow lockout-evasion race | low | — | auth-verify add'l #2 | `services/auth.rs:48-49,82-92`; `repositories/auth.rs:97-127` flat `SET failed_login_attempts = $1` |
| S-50 | `POST /auth/resend-verification` and `POST /auth/verify-email` are completely unthrottled | low | P | R-(resend); rate-limit-verify missed #5 | `routes/auth.rs:142-147,149-154`. **Impact refuted:** the "email bomb"/"provider cost" framing is false — `create_email_verification_token` (`core/auth.rs:515-538`) only does an `UPDATE users`, and no code path in this backend dispatches verification email at all (`find … -iname "*mail*"` → empty; the communications module has zero "verif" hits). Real residual impact: unthrottled writes + rotating a legitimate outstanding token on every call. `verify-email` is safe regardless (256-bit token, `core/auth.rs:508-512`). |
| S-51 | The `auth` limiter is one un-keyed bucket shared by `/auth/login`, `/auth/passkey/login/start`, `/auth/passkey/login/finish` | low | — | rate-limit-verify missed #4 | `routes/auth.rs:67`; `routes/passkey.rs:82,104` |
| S-52 | Login is keyed by IP only — no username/user-id bucket exists on the staff side, although `KeyedRateLimiter` is used 7× by the guest portal | low→see S-18 | — | commander C6 | `core/rate_limiter.rs` (328 lines read by the main session): 11 guest-portal buckets, zero staff-side keyed bucket |
| S-53 | `delete_permission`/`delete_role` don't check for dangling references in `route_access_policies`' JSONB name arrays | low | — | rbac-verify add'l #3 | `services/rbac.rs:269-291`; in-use checks at `repositories/rbac.rs:230-236,280-286` cover only the relational tables |
| S-54 | `audit_logs` has no DB-level protection against UPDATE/DELETE; the whole schema has no privilege separation | low | — | audit-trail-verify add'l #6 | `baseline:1147-1158`; `grep -c "^GRANT\|^REVOKE"` on the baseline → 0. No code path mutates audit rows today. |
| S-55 | `users.created_at/updated_at` nullable in DDL but decoded as non-`Option`; 3 redundant single-column indices; one literal `NOW()` in `repositories/rbac.rs:534` | nit | — | sql #8, #9, #11 | `baseline:3493,3495` vs `models/user.rs:25-26,111-112`; `baseline:7580,7321,7566`; CLAUDE.md Leak #2 convention |
| F8 | `features/rbac/` and `features/audit-log/` are `export {};` stubs; `AccountDeactivation.tsx` (222 lines) is dead with no matching backend endpoint; self-delete has no client-side warning | low | C | frontend F7, F8, F9 | backend correctly rejects self-delete at `services/users.rs:172-176` |

### 1.5 Refuted as stated, or materially corrected (do not implement as written)

| source claim | status | what is actually true |
|---|---|---|
| AUTH-18: "`routes/two_factor.rs`'s `/auth/2fa/*` endpoints are built but never merged into the router" | **REFUTED** — I re-read `routes/mod.rs:239` myself; they are merged | Real issue is duplication with `/profile/2fa/*` → S-30, low security severity |
| R-(resend): "can be used to email-bomb any address / drive up email provider cost" | **REFUTED** | No outbound email exists for verification anywhere in the backend → S-50 |
| sql #6: "renaming a role leaves a stale display name visible to admins" | **REFUTED** | `roles.display_name` is never read by any query or surfaced by any API → S-36 |
| RBAC-5 title: "8 of 11 RBAC mutation functions" | **CORRECTED** | 9 of 13 (the auditor's own evidence listed 9 names) → S-11 |
| R-1 impact: "unlimited password guessing, lockout never triggers" | **CORRECTED** | Per-account DB lockout is IP-independent and still fires; the bypass bites on the 2FA/recovery-code path → S-05 + S-18 |
| tests: "the CI backend job's test step is an actual verification hole" | **CORRECTED** | `backend-postgres-smoke` runs the same tests on a live DB on the same triggers → S-41 |
| Minor citation/count drift, substance unaffected | logged, not re-litigated | `docker-compose.yml:40` not :33; `routes/mod.rs:226` not :225; 17 rate-limit sites not 16; 9-of-13 not 8-of-11; 1859 lines not 1877; 20 files not 18; `services/audit.rs:47` not :46; several ±1-line frontend citations |

### 1.6 UNVERIFIED — carried forward as leads, not facts

These were never sent to a verifier (the auth verifier received only a subset) or were
self-labelled unverifiable. Do **not** treat them as established.

| id | claim | why unverified |
|---|---|---|
| U-1 | AUTH-09 — `req.username` reaches the audit log unsanitized; downstream XSS risk | stored-not-executed; the auditor itself labelled the downstream risk unverified |
| U-2 | AUTH-08 — passkey `login_start` distinguishes "no such user" from "no passkeys registered" | not in the verifier's subset |
| U-3 | AUTH-07 — residual timing difference in `resend_verification` | not in the verifier's subset |
| U-4 | AUTH-11 — bcrypt truncates at 72 bytes while policy allows 128 | not in the verifier's subset |
| U-5 | AUTH-12 — login `password` has no max-length validation | auditor self-labelled partially unverified re: axum body limit |
| U-6 | AUTH-13 — `LoginRequest` derives `Debug` over the plaintext password | no active leak found; dormant |
| U-7 | AUTH-14 — `Claims.sid` doc-comment contradicts `enforce_active_session` | not in the verifier's subset |
| U-8 | S-41 — whether `backend-postgres-smoke` is a *required* status check | GitHub branch-protection setting, not in-repo |
| U-9 | S-42 — that anyone actually runs multi-replica scale-out | no k8s manifest in-repo |

---

## 2. THE SHAPE OF THE REWORK

### 2.1 What the house pattern actually is (read this session, not assumed)

`src/modules/mod.rs` declares 7 flat modules. `modules/promotions/mod.rs` is 13 lines of
`pub mod {handlers, models, repository, routes, service, validation}`. `modules/loyalty/`
adds extra flat files (`hub.rs`, `queries.rs`) — so **extra flat files are in-pattern;
nested sub-directories are not used anywhere today.** Sizes today: promotions
repository 786 / service 773 (the largest); loyalty total ~2 900; settings total 525.

**Two conflicting auth placements exist** (commander C7, both re-read by me):
- `modules/settings/routes.rs:42,52` — `require_permission_helper` in the **route** function,
  handler receives a plain `user_id`.
- `modules/promotions/handlers.rs:47-79` — auth extracted in the **handler** (because those
  routes mix guest-session and staff auth), routes are bare `handlers::x` references.

**Decision for the user domain: the settings shape.** Gate in `routes.rs`, one line per route,
handler takes `user_id: i64`. Justification from findings, not taste: S-11/S-19/S-38 all
require the actor id at the service layer, and F1 requires a machine-diffable
route→permission map so the frontend gate can be generated from it rather than hand-copied.
The promotions shape hides the gate one file away from the route table.

### 2.2 Proposed module tree

Four sibling modules, flat, matching the house pattern exactly. `structure.md` proposed a
`modules/access/` parent with nested sub-directories; I reject the nesting (no precedent in
the repo) but keep its grouping logic, which the findings support.

```
src/modules/
├── identity/                 # auth + two_factor + passkey  (was ~2 400 lines across 3 domains)
│   ├── mod.rs
│   ├── routes.rs             # ONE 2FA prefix (§4 Q4), login/refresh/logout/register/verify-email,
│   │                         #   passkey register+login, sessions; every route carries its gate
│   ├── handlers.rs
│   ├── service.rs            # login/refresh/logout/register  (was services/auth.rs)
│   ├── two_factor.rs         # (was services/two_factor.rs)
│   ├── passkey.rs            # (was services/passkey.rs)
│   ├── repository.rs         # repositories/auth.rs + repositories/passkey.rs + refresh_tokens
│   │                         #   and two_factor_challenges SQL lifted out of core/auth.rs
│   ├── cookies.rs            # build/clear_refresh_cookie  (was handlers/auth.rs:13-56)
│   ├── models.rs             # (was models/auth.rs)
│   └── validation.rs
├── users/                    # users + profile  (was ~1 600 lines across 2 domains)
│   ├── mod.rs, routes.rs, handlers.rs, service.rs, repository.rs, models.rs, validation.rs
├── access/                   # rbac + teams
│   ├── mod.rs, routes.rs, handlers.rs, service.rs, repository.rs, models.rs, validation.rs
│   └── resolve.rs            # THE single effective-permissions/roles query
└── audit/
    ├── mod.rs, routes.rs, handlers.rs, service.rs, repository.rs, models.rs
    └── log.rs                # the write-side AuditLog API every other domain imports
```

### 2.3 Why each grouping — from findings, not taste

**`identity/` = auth + two_factor + passkey.** Every one of S-07, S-08, S-09, S-45, S-30 is
the same defect shape: *one authentication implementation forgot what the sibling
implementation does.* Passkey login skips 2FA (S-07), skips lockout (S-08), skips audit
(S-09); 2FA has two route surfaces (S-30); `handlers/passkey.rs:7` has to reach into
`handlers/auth.rs` for the cookie builder (S-39). These three are not three domains — they
are three entry points to one session-minting operation. Merging them makes "mint a session"
a single function that all three call, which is the only structural fix for S-07/S-08/S-09.

**`users/` = users + profile.** `profile` has no repository and no models of its own — it
already borrows `UserRepository` and `models/user.rs` (structure.md §1). The duplicated
`password_hash` query (S-39) exists precisely because the two live apart, one copy carrying
`deleted_at IS NULL` and one not. `routes/profile.rs` currently owns passkey and 2FA
sub-routes (S-40, 8 of 13 closures) — those leave for `identity/`, which is what makes
`users/` a coherent ~1 100-line module.

**`access/` = rbac (+ teams).** `TEAMS-DESIGN.md` resolves permissions by UNION-ing
`user_roles` with `team_roles`; the escalation guard (S-01) must apply identically to
user-role grants and team-role grants or teams become a laundering path around it. Two
tables, one guard, one resolution query ⇒ one module. `resolve.rs` exists as a named file
because S-29 proved the query is currently copied three times and S-26 requires changing all
copies at once.

**`audit/` stays its own module — but split write from read.** structure-verify missed #6 is
a hard migration constraint: **6 of the 7 already-migrated modules import
`crate::services::audit::AuditLog`** (ekyc, loyalty, promotions, support, guest_booking,
communications ×2). So audit cannot be moved "last and independently". `services/audit.rs`
(797 lines) conflates a cross-cutting write helper (lines 16-357, consumed by every domain)
with the audit-viewer's read queries (`get_audit_logs` :405 onward). Split them:
`audit/log.rs` is the cross-cutting primitive; `audit/{routes,handlers,service,repository}`
serve the viewer page. The 6 imports are rewritten mechanically in one commit.

**What gets deleted outright** (all zero-caller, all grep-proven):
`src/routes/loyalty.rs` (S-46) · `require_admin_helper`/`require_super_admin_helper`/
`check_admin_role` unless §4 Q6 keeps super-admin (S-47) · `UserRepository::get_roles/
get_permissions/has_permission` (S-47) · `core/middleware.rs:43-53` manage re-derivation and
the `*_PERMISSIONS` const arrays in `routes/users.rs` (S-28) · `core/auth.rs:450-484` RBAC
join queries, replaced by `access::resolve` (S-29) · FE `rbac/RolesTab/` + `rbac/PermissionsTab/`
(12 files, 1859 lines) **only after** §4 decides whether to rebuild the permission-catalog UI
(F2) · FE `AccountDeactivation.tsx` and the `features/rbac/` + `features/audit-log/` stubs (F8) ·
the 6 dead single-item API methods (F6).

**What stays in `core/`:** JWT issuance/verification, `rbac_cache` (it backs
`middleware::check_permission`, which every module calls — but its SQL becomes a call into
`access::resolve`), `rate_limiter`, `extract_client_ip`. What leaves `core/auth.rs`:
refresh-token storage, 2FA-challenge storage (→ `identity/repository.rs`), RBAC name lookups
(→ deleted, see S-29).

---

## 3. PHASED PLAN

Ordered so that no phase depends on a later one. Phases 1-4 deliver every blocker and most
highs **without** the module move, per the brief.

### Phase 1 — Reachability and escalation blockers (code-only, no schema, no move)

- **Scope:** S-01 (+ the second path in `assign_permission_to_role`/`replace_role_permissions`),
  S-02, S-07, S-08, S-24, S-13. Add the permission-superset rule as one helper in
  `services/rbac.rs` and call it from all four grant paths. Fix the inet decode with
  `host(a.ip_address) AS ip_address` in both queries (`repositories/audit.rs:112-113,198-199`),
  copying the existing pattern at `core/auth.rs:396`. Route passkey login through the same
  pre-flight checks password login uses. Delete `modules/ekyc/routes.rs:395-405` and take
  `ConnectInfo<SocketAddr>` + `crate::routes::extract_client_ip`.
- **Closes:** S-01, S-02, S-07, S-08, S-13, S-24.
- **Gate:** `cargo clippy --all-features --all-targets -- -D warnings` run **bare** (no
  trailing pipe — lesson 2026-07-26o; and never `${PIPESTATUS[0]}`, which is empty in zsh —
  lesson 2026-07-27) · `cargo test --all-features` · a live probe that writes an audit row
  with a non-null `inet` then fetches it: `curl -s -o /dev/null -w '%{http_code}'
  "$API/api/audit-logs?limit=50"` must be 200 with the poison row present · a new
  `tests/` case asserting `manager`-priority actor + `senior_reviewer` role ⇒ `Forbidden`.
- **What could go wrong:** the superset rule breaks legitimate admin flows (an admin whose own
  permissions are a strict subset of a role they must grant). *Proof it did not:* run the
  seeded-role matrix as a test — for every seeded role pair, assert the grant decision matches
  a written expectation table, and assert `admin`/`super_admin` can still grant every seeded role.
  Second risk: `host()` changes the JSON shape of `ip_address` (it does not — both render a
  bare address string; assert it in the new test).

### Phase 2 — Bootstrap and permission-seed integrity

- **Scope:** S-06 (wire `missing_seed_count` to `RAISE EXCEPTION` like its three siblings),
  S-03, S-04, S-27 — insert the 3 load-bearing permissions and grant them; decide
  keep-or-delete for the other ~23 declared-but-absent names. Ship an idempotent
  `patches/2026-07-27-*.sql` for existing DBs, and mirror **all 12** patches into
  `hotel-desktop/src-tauri/database/postgres/patches/` (S-34).
- **Closes:** S-03, S-04, S-06, S-27, S-34.
- **Gate:** scratch install proves it — `docker run postgres:19beta2`, then
  `psql -v ON_ERROR_STOP=1` over baseline → `data.sql` → `seed.sql`, **twice** (idempotency);
  then a deliberate negative test: add a name to `expected_system_permissions` without
  inserting it and confirm the install now **fails**. Then `pg_dump --schema-only --no-owner
  --no-privileges` of fresh-new vs old+patch, strip `\restrict` lines, diff must be empty
  (lesson 2026-07-26c). `diff -rq` both patch directories → empty.
- **What could go wrong:** turning on the guard makes the install fail for the other ~23
  names. *That is the point* — but it must be resolved by decision (insert or remove from
  the expected list), not by weakening the guard. The double-apply + the negative test are
  what prove the guard is live rather than cosmetically added.

### Phase 3 — Audit trail completeness (still no move)

- **Scope:** S-09, S-10, S-11, S-12, S-19, S-20, S-21, S-22, S-38, S-37. Thread ip/user-agent
  through every audit call (extend `log_password_changed`'s signature). Add audit to the 9
  RBAC mutations, the passkey lifecycle, profile update, the 2FA failure branches, settings
  update (call the already-written `log_settings_changed`). Write `assigned_by`/`granted_by`
  at all four insert sites. Record before/after values (S-19, S-38). Call
  `ensure_audit_logs_partition` monthly from `night_audit_scheduler` (S-37).
  **S-17 (fail-open vs fail-closed) is gated on §4 Q2** — implement whichever the user picks.
- **Closes:** S-09, S-10, S-11, S-12, S-19, S-20, S-21, S-22, S-37, S-38, (S-17 pending Q2).
- **Gate:** integration tests that perform each mutation and then `SELECT` the resulting
  `audit_logs` row, asserting `action`, non-null `ip_address`, and the presence of
  before/after keys in `details` — one test per mutation family. Existing tests already
  count audit rows this way (`tests/rbac_profile.rs:1362,1375`), so the pattern exists.
- **What could go wrong:** the new `assigned_by` writes hit the FK on a deleted actor;
  and adding audit inside existing transactions can poison them (lesson 2026-07-10b —
  a failed statement aborts the whole PG transaction regardless of `let _ =`).
  *Proof it did not:* run every new audit path inside the live-PG test suite, and for any
  audit write added inside an existing `tx`, use `log_event_tx` or a SAVEPOINT, never a
  swallowed `let _ =`.

### Phase 4 — Rate limiting, abuse controls, and the trust boundary

- **Scope:** S-05 + S-16 (one coherent trusted-proxy design: a hop count or a trusted-CIDR
  list, take the rightmost untrusted entry; fix `docs/guides/deployment.md:190` to match
  `SECURITY.md:53`), S-18 (per-account counter on the 2FA branch), S-14 (log + audit every
  rejection), S-15 (wire `RateLimiters::api` to `/users` and `/rbac/*`, and to the profile/
  session/passkey routes), S-31, S-32, S-33, S-52. Optionally S-39's rate-limit boilerplate
  → one helper, since 17 sites are being touched anyway.
- **Closes:** S-05, S-14, S-15, S-16, S-18, S-31, S-32, S-33, S-51, S-52; documents S-42.
- **Gate:** unit tests for the XFF parser with an explicit table (spoofed leftmost entry,
  N trusted hops, no proxy, IPv6, malformed) · a live test that 6 rapid wrong-TOTP attempts
  lock the account · `grep -rn "RateLimiters" src/routes/users.rs src/routes/rbac.rs` returns
  hits (the absence claim inverted) · a 429 leaves a row in `audit_logs`.
- **What could go wrong:** the trusted-proxy change breaks desktop mode or the Vite dev proxy
  (different origins/hop counts). *Proof it did not:* exercise all three origins explicitly —
  browser via Vite proxy, desktop `tauri://localhost` → `127.0.0.1:<port>`, and a direct curl
  — and state in the report which origins were exercised (lesson 2026-07-06).

### Phase 5 — Characterization tests and CI-gate honesty (before any file moves)

- **Scope:** S-25, S-41. Build the missing HTTP-level harness (`tower::ServiceExt::oneshot`
  against `create_router`) and assert 401/403/200 for a matrix of (route × permission) — this
  becomes the machine-checkable route→permission map §2.1 depends on. Add service-level tests
  for user CRUD, permission CRUD, profile service, passkey lifecycle. Give the `backend` job's
  test step a `DATABASE_URL` or rename it honestly.
- **Closes:** S-25, S-41.
- **Gate:** the HTTP matrix test enumerates every route registered by `create_router` and
  **fails on any route with no assertion**, so the map cannot silently rot. Test-fixture ids
  must be grepped for collisions before use (lesson 2026-07-27: `grep -on "920_0[0-9][0-9]"`).
- **What could go wrong:** flaky/slow suite; concurrent test fns sharing fixed fixture ids.
  *Proof it did not:* run the suite twice on a polluted DB and twice on a fresh one
  (lesson 2026-07-26e), and never run two vitest/cargo-test suites concurrently in this tree
  (lesson 2026-07-26t).

### Phase 6 — The module move

- **Scope:** create `modules/{identity,users,access,audit}` per §2.2; delete the dead code
  listed in §2.3; collapse the three resolution-query copies into `access/resolve.rs` (S-29);
  collapse the manage-fallback triplication (S-28); one `password_hash` query (S-39); one
  cookie module (S-39); resolve the 2FA prefix per §4 Q4 (S-30); decide dead-schema
  keep-or-drop (S-35, S-36); rewrite the 6 migrated modules' `services::audit` imports.
- **Closes:** S-28, S-29, S-30, S-35, S-36, S-39, S-40, S-46, S-47; S-26 partially (the
  resolution query gains its single home, expiry lands in Phase 7).
- **Gate:** the Phase-5 HTTP matrix must pass **byte-identically** before and after the move —
  that is the whole point of doing Phase 5 first. Plus clippy `--all-features --all-targets`
  and the full test suite. `git diff --stat` should show mostly renames.
- **What could go wrong:** a route silently drops out of `create_router` during the merge
  rewrite (Leak #3 item 1). *Proof it did not:* the matrix test enumerates registered routes
  and fails on any un-asserted one; additionally diff the sorted route list from
  `git show HEAD:src/routes/mod.rs` against the new one. Second risk: this tree is shared with
  concurrent sessions — check `git log` for commits newer than session start and use
  `git commit -- <explicit paths>` (lessons 2026-07-26l, 2026-07-26r).

### Phase 7 — Teams, expiring grants, and actor attribution

- **Scope:** `TEAMS-DESIGN.md` as written: 3 new tables, 6 `teams:*` permissions, the UNION
  resolution query in `access/resolve.rs`, the single scoped rule
  (`actor_can_manage_team_membership`), the superset guard from Phase 1 extended to
  `team_roles` grants. S-26 lands here: `expires_at` becomes honoured in the one resolution
  query, and the rbac cache entry expires at `min(loaded_at + ttl, earliest_expiry)`.
- **Closes:** S-26 fully; delivers Teams.
- **Gate:** scratch `postgres:19beta2` install of the new trio + the patched-old trio, dump
  both, diff must be empty (lesson 2026-07-26c) · seeded team/role ids asserted on a scratch
  install (lesson 2026-07-27: identity ids from set-based inserts do not preserve VALUES order) ·
  live tests: a grant with `expires_at` in the past confers nothing; one expiring in 2s stops
  conferring within the TTL bound; a team-role grant that would escalate is rejected.
- **What could go wrong:** teams become an escalation laundry (grant yourself a team that
  holds a role you may not grant). *Proof it did not:* the same superset test matrix from
  Phase 1, re-run against the team-grant path.

### Phase 8 — Frontend

- **Scope:** F1 (per-control `hasPermission` gating on the 4 pages, generated from the
  Phase-5 route→permission map), F7 (expose `is_system_role` in the roles API and delete the
  regex), F2 (delete the dead tabs and/or rebuild the permission-catalog UI per §4), F3, F4,
  F5 (both halves: render via `utils/date.ts`, and send zoned instants for the filter),
  F6, F8.
- **Closes:** F1-F8.
- **Gate:** `bun run typecheck && bun run lint && bun run test` from `hotel-web-fe/`, run as
  three separate commands with real exit codes; new component tests for the 4 gated pages
  (the domain currently has **zero** component tests). Run the suite alone — never
  concurrently (lesson 2026-07-26t).
- **What could go wrong:** over-gating hides controls from users who do hold the permission
  (F7's false-positive class, in a new form). *Proof it did not:* the component tests assert
  both directions — rendered-and-enabled with the permission, hidden/disabled without.

---

## 4. POLICY QUESTIONS — the user's call, not the code's

**Q1. Should granting a role require the actor to already hold every permission in it?**
- (a) **Superset AND priority** — actor must hold ⊇ the role's permissions *and* outrank it.
- (b) Priority only (today), plus a new explicit `roles:grant_beyond_self` permission for the
  rare legitimate case.
- (c) Cross-domain grants restricted to super-admin.
- *Recommendation:* (a). It is the only option that closes S-01 without a new escape hatch,
  and `TEAMS-DESIGN.md` already assumes it. Cost: an admin who genuinely lacks `ekyc:override`
  can no longer hand out `senior_reviewer` — which is the intended behaviour, but it will
  generate support tickets on day one, so seed `admin`/`super_admin` with the full set.

**Q2. Should an audit-write failure block the mutation it describes?**
- (a) Fail-closed for the whole user domain — move all 24 call sites to `log_event_tx`.
- (b) Keep fail-open (today) and add alerting on the swallowed error.
- (c) Hybrid — fail-closed for RBAC/auth/permission changes, fail-open for logins and reads.
- *Recommendation:* (c). A transient DB blip should not lock every staff member out of login,
  but a role grant that leaves no trace is exactly the event the trail exists for. Note that
  every other domain in this codebase already uses `log_event_tx`, so (a) is the
  consistency-maximising answer if you prefer one rule.

**Q3. Is a passkey a second factor, or must 2FA still apply to passkey login?**
- (a) Passkey satisfies 2FA — skip TOTP when the user authenticated with a passkey
  (industry-common; a passkey is possession + biometric).
- (b) Passkey **plus** TOTP whenever `two_factor_enabled` is set.
- (c) Per-hotel setting.
- *Recommendation:* (a) **only if** passkey *registration* gains step-up re-auth (S-45);
  otherwise (b). Today the pairing of S-07 and S-45 means anyone with a live session can mint
  a permanent 2FA bypass — whichever answer you pick, those two must be decided together.

**Q4. Which 2FA URL prefix survives — `/auth/2fa/*` or `/profile/2fa/*`?**
- (a) `/auth/2fa/*` (has all 6 routes incl. `regenerate-backup-codes`).
- (b) `/profile/2fa/*` (has 5; the frontend calls setup/enable/disable here).
- (c) Keep both, with one as a documented alias.
- *Recommendation:* (a), with the frontend's 3 call sites (`auth.service.ts:95,103,108`)
  repointed in the same commit. Both surfaces are live in production traffic today, so this
  is a real deprecation, not a refactor.

**Q5. Should login error messages be made uniform?**
- (a) One message for every failure ("Invalid credentials") — closes S-43, and the same
  treatment for `/auth/register` (S-43's note) and passkey `login_start` (U-2).
- (b) Keep specific messages — front-desk staff genuinely benefit from "your account is
  locked" / "verify your email".
- (c) Uniform before password verification, specific after (so a *correct* password can be
  told its account is locked).
- *Recommendation:* (c). It removes the unauthenticated oracle while keeping the operational
  message where it is actually useful. Note the remaining-attempts counter
  (`services/auth.rs:117-120`) leaks nothing extra once the account is known to exist.

**Q6. What does `is_super_admin` mean, or should it be deleted?**
- (a) Define it: super-admin-only for system-role edits, permission-catalog changes, and
  granting `permissions:manage`; enforce via the already-written (dead)
  `require_super_admin_helper`.
- (b) Delete the column and the helper; rely on role priority alone.
- (c) Keep it purely as a "cannot be deleted / cannot be demoted" marker on the bootstrap
  admin, with no permission semantics.
- *Recommendation:* (a) or (c) — but **not** the status quo, where the column exists,
  nothing enforces it, and S-01/S-13 therefore have no ceiling. This decision also determines
  whether S-47's dead helpers get deleted or wired.

---

## 5. WHAT I DID NOT VERIFY

**Nothing in this workflow was executed.** No `cargo check`, no `cargo clippy`, no
`cargo test`, no `psql`, no scratch-Postgres install, no HTTP request against a running
backend, no `bun run typecheck/lint/test`. Every claim in this document is a **static
reading** of source, SQL, YAML, and Markdown. Specifically:

- **Every severity rating is a judgment about untested code.** The blockers (S-01, S-02,
  S-03, S-04, S-05) are argued from source, not reproduced. S-02 in particular was traced
  through vendored sqlx 0.8.6 source by a verifier — a strong argument, still not an
  observed 500.
- **Every absence claim rests on a grep**, not on execution: S-09 (`grep -n "AuditLog"
  src/services/passkey.rs` → no matches), S-14 (rate-limit logging grep → exit 1), S-22
  (`assigned_by|granted_by` → one JSON-key hit), S-23, S-25, S-35, S-37, S-44, S-46, S-47.
  Greps prove a *string* is absent; they do not prove a *behaviour* is absent (a differently
  named wrapper, a macro, or a trait default could exist). None were re-derived by running
  the code.
- **The two permission-gap counts disagree** (26 missing per rbac-verify, 25 per
  audit-trail-verify, both against `data.sql:56-185` vs `:414-517`). Neither was produced by
  applying the file to a database. The implementation session should derive the real number
  from a scratch install, not from either report.
- **I personally re-read only these files this session**, and only these citations carry my
  own eyes: `src/services/rbac.rs:330-360`, `src/models/audit.rs:65-80`,
  `src/repositories/audit.rs:105-120`, `src/routes/mod.rs` (mod declarations and all
  `.merge()` lines), `src/modules/mod.rs`, `src/modules/settings/routes.rs` (full),
  `src/modules/promotions/{mod.rs,routes.rs}` (full) and `handlers.rs:1-80`, and `wc -l`
  across `src/modules/{promotions,settings,loyalty}/` and `src/routes/`. Everything else is
  an auditor's or verifier's reading that I adjudicated but did not re-open.
- **Line anchors rot.** Every `file:line` here was true at the reports' timestamps
  (2026-07-27 03:24-03:52) against a working tree with uncommitted modifications in
  `src/modules/settings/*` and several frontend files. Re-grep before relying on any anchor.
- **The proposed module tree is a proposal, not a verified plan.** Line-count estimates for
  the new files are arithmetic on today's file sizes; no file was actually moved, and no
  circular-import analysis was performed beyond structure-verify's clean-direction check.
- **Teams (§ Phase 7) was designed by the main session and never audited.** `TEAMS-DESIGN.md`
  states its own SQL was checked against the baseline's `valid_action` CHECK; I did not
  re-open that CHECK.
- **§1.6 lists 9 findings nobody verified.** Do not implement them without first re-deriving
  the evidence.
