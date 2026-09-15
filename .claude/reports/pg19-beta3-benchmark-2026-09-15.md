# PG19 beta3 tuning benchmark — 2026-09-15

Method: two scratch `postgres:19beta3` containers, identical data
(`0001_v1_baseline.sql` + `seed.sql` + patch catalog 1.2/1.3 + `staging.sql`).

- **before** = `hotel-pg19-base`, vanilla flags (matches `docker-compose.yml`).
- **after** = `hotel-pg19-tuned`, the `docker-compose.pg19-tuned.yml` `-c` overlay
  + `pg19_beta2.sql` + `ALTER SYSTEM autovacuum_max_parallel_workers=4` + reload
  (i.e. exactly what `docker-up-pg19-tuned` + `db-pg19-tune` produce).

Data scale is staging-sized (77 bookings, 11 audit rows): this validates that the
profile applies and engages on beta3. It is **not** a latency signal.

## Result: applies cleanly, settings engage, no plan regressions

| setting | before | after |
|---|---|---|
| effective_io_concurrency | 16 | 32 |
| maintenance_io_concurrency | 16 | 32 |
| autovacuum_vacuum_score_weight | 1 | 1.5 |
| autovacuum_analyze_score_weight | 1 | 2 |
| autovacuum_vacuum_insert_score_weight | 1 | 1.25 |
| vacuum_max_eager_freeze_failure_rate | 0.03 | 0.05 |
| autovacuum_max_parallel_workers | 0 | **2** (see finding) |

Already-default on beta3, so the compose `-c` pins are no-ops (harmless):
`io_method=worker`, `io_min_workers=2`, `io_max_workers=8`, `jit=off`
(image built without LLVM), `default_toast_compression=lz4`.

Schema-level changes verified on tuned container:

- Extended statistics created: `stats_bookings_commercial_state`,
  `stats_ekyc_review_queue`, `stats_customer_ledgers_work_queue`.
- Per-table reloptions set on bookings/payments/customer_ledgers/
  ekyc_verifications + all `audit_logs_*` partitions
  (`autovacuum_parallel_workers=2`, scale factors 0.03–0.05 / 0.015–0.02).
- Both benchmark EXPLAINs keep identical plan shape; `Settings:` lines show the
  io-concurrency GUCs flowing into plans. Planning time 2.66→1.79 ms and
  5.92→4.68 ms — noise at this scale, directionally fine.

## Finding: `db-pg19-tune`'s `ALTER SYSTEM` is shadowed on the compose path

`docker-compose.pg19-tuned.yml` sets `-c autovacuum_max_parallel_workers=2`.
`make db-pg19-tune` then runs `ALTER SYSTEM SET autovacuum_max_parallel_workers=4`,
but **command-line `-c` outranks `postgresql.auto.conf`** — verified: after ALTER
SYSTEM + reload, `pg_settings` still shows 2. So on the tuned compose path the
effective value is 2, on a bare DB it is 4. The per-table `autovacuum_parallel_
workers=2` engages either way (cluster cap > 0). If 4 is intended, raise the
compose default or drop the `-c` flag and let ALTER SYSTEM govern.

Raw captures: `/tmp/bench-before.txt`, `/tmp/bench-after.txt` (ephemeral).
