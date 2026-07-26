# Backend Error Handling Evaluation
**Dimension:** backend-errors  
**Date:** 2026-07-26  
**Scope:** hotel-app-be/src (excluding tests, #[cfg(test)], src/bin/)

## Summary
Scanned for: (a) `let _ =` discarding sqlx results in transactions, (b) unwrap()/expect() on fallible types in production, (c) panic!/todo!/unimplemented! in non-test code, (d) println!/dbg! in handlers/services/repositories.

**Total findings before filtering:** 13
**Severity breakdown:** 0 blocker, 7 should-fix, 6 nit/config-time

---

## Blocker Findings (0)
None. All `let _ = sqlx::query()` patterns found were outside transactions (using `&pool` directly).

---

## Should-Fix Findings (7)

### 1. booking_list.rs:207 — chrono::NaiveDate::from_ymd_opt() unwrap in query builder
**File:** hotel-app-be/src/repositories/booking_list.rs  
**Line:** 207  
**Context:** Month filter calculation for booking list queries
**Pattern:**
```rust
chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
    .unwrap()
    .pred_opt()
    .unwrap()
```
**Issue:** `from_ymd_opt()` returns `Option<NaiveDate>` and can return None if the date is out of valid range (year 1-9999). Calling `.unwrap()` will panic at runtime. The `.pred_opt()` also returns `Option` and is unwrapped. Year+1 could overflow.
**Severity:** should-fix (can panic if month computation yields out-of-range dates)

### 2. booking_list.rs:212 — chrono unwrap in date range calculation
**File:** hotel-app-be/src/repositories/booking_list.rs  
**Line:** 212  
**Context:** Month filter, computing last day of month
**Pattern:**
```rust
chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
    .unwrap()
    .pred_opt()
    .unwrap()
```
**Issue:** Same as above — chained unwraps on fallible operations.
**Severity:** should-fix

### 3. core/rate_limiter.rs:63 — unwrap() on Vec::first() without prior capacity check
**File:** hotel-app-be/src/core/rate_limiter.rs  
**Line:** 63  
**Context:** Rate limiter retry-after calculation
**Pattern:**
```rust
if (self.timestamps.len() as u32) < config.max_requests {
    // ...
} else {
    let oldest = self.timestamps.first().unwrap();
```
**Issue:** Logic checks if `len < max_requests` enters the if branch. The else branch assumes timestamps is non-empty, but if `max_requests` is 0, the else branch executes on the first request with an empty vector, causing panic.
**Severity:** should-fix (edge case: max_requests=0 causes panic)

### 4. core/error.rs:162 — unwrap() on HeaderValue::from_str()
**File:** hotel-app-be/src/core/error.rs  
**Line:** 162  
**Context:** Building Retry-After response header
**Pattern:**
```rust
axum::http::HeaderValue::from_str(&secs.to_string()).unwrap()
```
**Issue:** `from_str()` on HTTP header values can fail if the string contains invalid characters. While `secs.to_string()` (a u64) should always be valid, the unwrap makes this assumption implicit.
**Severity:** should-fix (implicit assumption about numeric string validity)

### 5. utils/date.rs:48 — unwrap() on NaiveTime::from_hms_opt()
**File:** hotel-app-be/src/utils/date.rs  
**Line:** 48  
**Context:** Production code in `parse_date_flexible()` function
**Pattern:**
```rust
return Ok(date.and_hms_opt(12, 0, 0).unwrap());
```
**Issue:** While 12, 0, 0 are valid time components, `from_hms_opt()` can theoretically fail. Using unwrap masks this possibility.
**Severity:** should-fix (though low practical risk; should use `?` or map for consistency)

### 6. utils/date.rs:54 — unwrap() on NaiveTime::from_hms_opt()
**File:** hotel-app-be/src/utils/date.rs  
**Line:** 54  
**Context:** Production code in `parse_date_flexible()` function
**Pattern:**
```rust
.map(|d| d.and_time(NaiveTime::from_hms_opt(12, 0, 0).unwrap()))
```
**Issue:** Same as above.
**Severity:** should-fix

### 7. services/data_transfer.rs:829 — panic!() inside production code path
**File:** hotel-app-be/src/services/data_transfer.rs  
**Line:** 829  
**Context:** Test-only code (verified: inside #[test] function)
**Pattern:**
```rust
.unwrap_or_else(|| panic!("{table} should be transferable"))
```
**Issue:** The panic is in a test, not production code. This is acceptable.
**Severity:** nit (test code)

---

## Nit Findings (6)

### 1. core/settings_cache.rs:40,50,118,123 — .lock().unwrap()
**File:** hotel-app-be/src/core/settings_cache.rs  
**Lines:** 40, 50, 118, 123  
**Pattern:** `self.entries.lock().unwrap()`  
**Issue:** Idiomatic Rust for Mutex poisoning, but could panic if lock is poisoned. In production, a poisoned Mutex typically indicates a panic in a critical section.
**Severity:** nit (idiomatic, low risk in practice)

### 2. core/rbac_cache.rs:59,69,144,150 — .lock().unwrap()
**File:** hotel-app-be/src/core/rbac_cache.rs  
**Lines:** 59, 69, 144, 150  
**Pattern:** `self.entries.lock().unwrap()`  
**Issue:** Same as above — idiomatic Mutex unwrap.
**Severity:** nit

### 3. core/auth.rs:90,95,100,107 — Regex::new().expect()
**File:** hotel-app-be/src/core/auth.rs  
**Lines:** 90, 95, 100, 107  
**Pattern:** `Regex::new(r"...").expect("... must compile")`  
**Issue:** Regex patterns are hardcoded literals, so compilation will never fail at runtime. These expects are safe.
**Severity:** nit (safe; patterns are hardcoded)

### 4. core/config.rs:259,366,370,378,382,386 — Config initialization unwraps
**File:** hotel-app-be/src/core/config.rs  
**Lines:** 259, 366, 370, 378, 382, 386  
**Pattern:** Config parsing and initialization unwraps  
**Issue:** These are at application startup (static initialization). Panicking at startup is acceptable for fatal config errors.
**Severity:** nit (startup-time, not request-time)

### 5. booking_list.rs:207-214 (alternative analysis) — Month computation safety
**File:** hotel-app-be/src/repositories/booking_list.rs  
**Context:** The unwraps happen during query building, not request handling, but they affect query construction for every request. Data validation should happen before `from_ymd_opt()` is called.
**Severity:** should-fix (see above)

### 6. No println!/dbg! in handlers/services/repositories
**Finding:** Clean sweep — no debug print statements found in production code paths.
**Severity:** n/a (pass)

---

## Patterns Not Found

- ✅ No `println!` or `dbg!` in handlers, services, or repositories
- ✅ No `panic!`, `todo!`, or `unimplemented!` in non-test production code
- ✅ No `let _ = sqlx::query()` inside Postgres transactions (all were using `&pool` directly)

---

## Checked but Empty (absence claims)

- `src/bin/` — excluded by scan spec
- `#[cfg(test)]` blocks — excluded by scan spec  
- `tests/` directory — excluded by scan spec
- `println!` in handlers/services/repositories — **0 matches**
- `dbg!` in handlers/services/repositories — **0 matches**
- `panic!` in non-test production code — **0 matches** (only in test at line 829)
- `todo!` in non-test code — **0 matches**
- `unimplemented!` in non-test code — **0 matches**

---

## Recommendations

1. **booking_list.rs:** Replace chained unwraps with error propagation:
   ```rust
   let last_day = chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
       .and_then(|d| d.pred_opt())
       .ok_or_else(|| ApiError::BadRequest("Invalid date range".to_string()))?;
   ```

2. **rate_limiter.rs:63:** Add explicit guard or use `expect()` with a clear message about the invariant:
   ```rust
   let oldest = self.timestamps.first()
       .expect("timestamps must not be empty when len >= max_requests");
   ```

3. **utils/date.rs:48,54:** Either accept that 12:00:00 is always valid (add a comment), or use `?` propagation.

4. **core/error.rs:162:** Add a comment explaining why the numeric string is guaranteed valid, or use a safer pattern.

5. **Lock unwraps (Mutex):** These are idiomatic but could be wrapped in a helper that provides a more specific error message on poisoning.
