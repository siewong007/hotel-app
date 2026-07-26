# Frontend Hygiene Scan — 2026-07-26

Scan of `hotel-web-fe/src` for architecture violations and code quality issues.

## Summary

- **Files scanned**: 449 TypeScript/TSX/JavaScript files (excluding node_modules, test files)
- **Total findings**: 7
- **Blockers (fetch)**: 0
- **Blockers (toISOString.split/slice)**: 0
- **Should-fix (storage)**: 7
- **Nits (console.log)**: 1 (acceptable — performance logging)

## Blockers

### (a) Direct fetch() calls outside src/api/client.ts

**Result**: NONE FOUND ✓

All HTTP requests correctly use the ky client from `src/api/client.ts`. References to "fetch" in the codebase are exclusively `.refetch()` calls from TanStack Query, which is the correct pattern.

### (b) toISOString().split or toISOString().slice (ESLint no-restricted-syntax)

**Result**: NONE FOUND ✓

Date formatting uses proper utility functions from `src/utils/date.ts`.

## Should-Fix Violations

Direct `localStorage` / `sessionStorage` access outside `src/utils/storage.ts`:

### 1. src/navigation/lazyRoute.ts — Module reload guard (sessionStorage)

```
Line 18: const previous = JSON.parse(window.sessionStorage.getItem(MODULE_RELOAD_KEY) ?? 'null') as {
Line 27: window.sessionStorage.setItem(MODULE_RELOAD_KEY, JSON.stringify({ page, at: now }));
```

**Issue**: Direct sessionStorage access for 'hotelModuleReload' key.

**Severity**: should-fix

**Rationale**: The module-reload guard is a runtime-only mechanism unrelated to user auth state, but should use the centralized storage API for consistency and error handling.

---

### 2. src/desktop/runtimeApi.ts — Tauri runtime API URL (sessionStorage)

```
Line 148: window.sessionStorage.setItem(RUNTIME_API_BASE_URL_KEY, normalizedUrl);
Line 158: const runtimeUrl = window.sessionStorage.getItem(RUNTIME_API_BASE_URL_KEY);
```

**Issue**: Direct sessionStorage access for 'hotelRuntimeApiBaseUrl' key (Tauri desktop mode only).

**Severity**: should-fix

**Rationale**: This key is runtime-specific and not part of the standard StorageKey enum, but should be abstracted into the storage manager.

---

### 3. src/utils/hotelSettings.ts — Print settings (localStorage)

```
Line 197: const stored = localStorage.getItem(STORAGE_KEY);
Line 203: // Ensure numeric fields are properly typed (localStorage may store them as strings)
Line 291: localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
```

**Issue**: Direct localStorage access for 'hotelSettings' key (report font size, family, etc.).

**Severity**: should-fix

**Rationale**: This is a UI preferences key that should be managed by the centralized StorageManager with caching and error handling.

---

### 4. src/utils/currency.ts — Currency override (localStorage)

```
Line 87: const currencyOverride = localStorage.getItem('hotelCurrency');
Line 102: localStorage.setItem('hotelCurrency', currencyCode);
```

**Issue**: Direct localStorage access for 'hotelCurrency' key.

**Severity**: should-fix

**Rationale**: Centralized storage API provides caching and error resilience; this key bypasses both.

---

### 5. src/components/common/ErrorBoundary.tsx — Session clear on error (sessionStorage)

```
Line 140: sessionStorage.clear();
```

**Issue**: Direct sessionStorage.clear() call without going through StorageManager.

**Severity**: should-fix

**Rationale**: Error recovery should use the managed clear() method for consistency and to maintain internal cache state.

---

### 6. src/features/guestPortal/api/portalTokenStore.ts — Guest session tokens (sessionStorage)

```
Line 27: return window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_KEY);
Line 35: return window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
Line 57: window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_KEY, token);
Line 58: window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY, expiresAt);
Line 68: window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_KEY);
Line 69: window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
```

**Issue**: Direct sessionStorage access for guest portal authentication tokens.

**Severity**: should-fix

**Context**: Comment at line 10 explicitly states "key in sessionStorage (cleared when the browser tab closes, unlike localStorage)". This is intentional architectural choice (session scope for guest tokens), but should still use a managed accessor for error handling and to avoid XSS surface area duplication.

**Note**: Line 61 has a comment acknowledging edge cases ("sessionStorage unavailable (e.g. private browsing)") but the code does not wrap the setItem calls in try/catch like the StorageManager does.

---

## Nits

### console.log instances

```
src/reportWebVitals.ts:15: console.log(`[Performance] ${metric.name}:`, {
```

**Status**: Acceptable — this is intentional performance diagnostic logging, not a debug leftover.

---

## Conventions Checked (Empty)

- ✓ No `fetch(` calls outside src/api/client.ts (only .refetch() from TanStack Query)
- ✓ No `toISOString().split()` or `toISOString().slice()` violations
- ✓ Dates use src/utils/date.ts helpers consistently
- ✓ All HTTP requests use src/api/client.ts (ky instance)
- ✓ No debug console.log statements (one performance logger is acceptable)

---

## Next Steps

1. Extend `src/utils/storage.ts` StorageKey enum to include the 7 keys identified above, or create satellite storage managers for domain-specific keys (hotelSettings, hotelCurrency, hotelModuleReload, hotelRuntimeApiBaseUrl, guest tokens).
2. Migrate direct accesses to use the centralized API.
3. Review whether guest-portal token storage needs a separate manager (session-scoped vs. the main user-profile cache).
