# Google Guest Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let public-web guests sign in with Google, complete first name, last name, and phone, then create self-service bookings.

**Architecture:** The public web bundle loads Google Identity Services and posts the returned ID token to a new Rust auth endpoint. The backend verifies the credential against Google's cached JWKS keys, links or creates only guest accounts, and derives profile completeness from guest contact fields. The browser redirects incomplete guests to a small completion page; guest booking creation independently enforces the same rule.

**Tech Stack:** Rust 2024, Axum 0.8, SQLx/PostgreSQL, Reqwest/rustls, jsonwebtoken, React 19, TypeScript, Vite, MUI, TanStack Router, Vitest.

## Global Constraints

- Google sign-in is public web only; Tauri builds must not load or render Google Identity Services.
- Do not edit `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`; add a forward-only migration and sync desktop resources.
- Do not add a frontend authentication package or custom Google-branded button.
- Verify ID-token signature, issuer, audience, expiry, `email_verified`, email, and `sub` on the backend before account lookup or mutation.
- Use `sub` as the stored external identity; email is only for initial guest-account linking.
- Only active guest accounts may use Google login; staff/admin, inactive, and non-guest matches must return `409`.
- Required booking fields are trimmed first name, trimmed last name, and a valid phone; address is optional.
- Enforce completion at `POST /guest-portal/me/bookings`; frontend checks are usability only.
- Preserve password registration/login, session refresh/logout, staff booking behavior, route paths, and existing public response fields.
- Keep SQL parameterized and multi-record account mutations transactional.
- Never log credentials, tokens, JWKS key material, or raw Google claims.

---

## File Structure

- `hotel-app-be/database/postgres/migrations/0002_google_guest_registration.sql`: adds the nullable Google subject and its unique partial index.
- `hotel-app-be/src/models/auth.rs`: adds Google login and completion DTOs plus completion fields on existing auth responses.
- `hotel-app-be/src/services/google_identity.rs`: fetches/caches JWKS and validates Google ID-token claims; contains pure claim/username/completeness helpers and tests.
- `hotel-app-be/src/repositories/auth.rs`: owns all SQL for finding/linking/creating Google guest accounts.
- `hotel-app-be/src/services/auth.rs`: resolves a verified Google identity into the existing application session response.
- `hotel-app-be/src/routes/auth.rs` and `hotel-app-be/src/handlers/auth.rs`: expose the rate-limited Google endpoint and set the existing refresh cookie.
- `hotel-app-be/src/services/profile.rs`, `handlers/profile.rs`, and `routes/profile.rs`: add guest-only profile completion with transactional user/guest synchronization.
- `hotel-app-be/src/repositories/guest.rs`: reads completeness and applies the completion update transaction.
- `hotel-app-be/src/modules/guest_booking/{repository.rs,service.rs}`: checks profile completeness before creating a guest booking.
- `hotel-web-fe/src/features/auth/components/GoogleSignInButton.tsx`: web-only official GIS button and credential callback bridge.
- `hotel-web-fe/src/features/auth/components/CompleteProfilePage.tsx`: focused completion form using the existing validation utilities.
- `hotel-web-fe/src/api/auth.service.ts`, `src/auth/AuthContext.tsx`, and `src/auth/authUser.ts`: exchange Google credentials and retain profile-completion state.
- `hotel-web-fe/src/navigation/routeRegistry.tsx`, `src/router/RootLayout.tsx`, and guest portal types/services: route and surface completion state.
- `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx`: redirect an incomplete guest before final booking submission.
- `hotel-app-be/.env.example` and `hotel-web-fe/.env.example`: document client-ID configuration.
- `hotel-desktop/src-tauri/database/` resources: receive the backend migration through `bun run sync:resources`; no manual drift.

### Task 1: Add the database and pure backend contracts

**Files:**
- Create: `hotel-app-be/database/postgres/migrations/0002_google_guest_registration.sql`
- Create: `hotel-app-be/src/services/google_identity.rs`
- Modify: `hotel-app-be/src/services/mod.rs`
- Modify: `hotel-app-be/src/models/auth.rs`
- Modify: `hotel-app-be/src/models/user.rs`
- Test: inline `#[cfg(test)]` module in `hotel-app-be/src/services/google_identity.rs`

**Interfaces:**
- Produces `GoogleIdentity { subject, email, email_verified, given_name, family_name }` after verification.
- Produces `ProfileCompletion { complete: bool, missing_fields: Vec<&'static str> }` from `first_name`, `last_name`, and `phone`.
- Produces `GoogleLoginRequest { credential: String }` and `CompleteGuestProfileRequest { first_name, last_name, phone, address_line1 }`.

- [ ] **Step 1: Write the failing tests for completion and stable username helpers**

```rust
#[test]
fn profile_completion_requires_first_name_last_name_and_phone() {
    assert_eq!(
        profile_completion(Some("Aisha"), Some("Rahman"), None),
        ProfileCompletion::missing(vec!["phone"]),
    );
}

#[test]
fn profile_completion_does_not_require_an_address() {
    assert!(profile_completion(Some("Aisha"), Some("Rahman"), Some("+60123456789")).complete);
}

#[test]
fn google_username_is_lowercase_and_database_safe() {
    assert_eq!(google_username("Aisha.Rahman@gmail.com", "10987654321"), "aisha_rahman_654321");
}
```

- [ ] **Step 2: Run the tests to verify they fail because the helper module does not exist**

Run: `cd hotel-app-be && cargo test google_identity`

Expected: FAIL with an unresolved `google_identity` module or helper symbols.

- [ ] **Step 3: Add the migration and minimal model/helper definitions**

```sql
ALTER TABLE users ADD COLUMN google_subject VARCHAR(255);

CREATE UNIQUE INDEX uq_users_google_subject
    ON users (google_subject)
    WHERE google_subject IS NOT NULL;
```

```rust
pub fn profile_completion(first_name: Option<&str>, last_name: Option<&str>, phone: Option<&str>) -> ProfileCompletion {
    let mut missing_fields = Vec::new();
    if !first_name.is_some_and(|value| !value.trim().is_empty()) { missing_fields.push("first_name"); }
    if !last_name.is_some_and(|value| !value.trim().is_empty()) { missing_fields.push("last_name"); }
    if !phone.is_some_and(|value| !value.trim().is_empty()) { missing_fields.push("phone"); }
    ProfileCompletion { complete: missing_fields.is_empty(), missing_fields }
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cd hotel-app-be && cargo test google_identity`

Expected: PASS.

- [ ] **Step 5: Commit the contracts and migration**

```bash
git add hotel-app-be/database/postgres/migrations/0002_google_guest_registration.sql hotel-app-be/src/services/google_identity.rs hotel-app-be/src/services/mod.rs hotel-app-be/src/models/auth.rs hotel-app-be/src/models/user.rs
git commit -m "feat(auth): add Google guest identity contracts"
```

### Task 2: Verify Google credentials and resolve guest accounts

**Files:**
- Modify: `hotel-app-be/src/core/config.rs`
- Modify: `hotel-app-be/src/services/google_identity.rs`
- Modify: `hotel-app-be/src/repositories/auth.rs`
- Modify: `hotel-app-be/src/services/auth.rs`
- Modify: `hotel-app-be/src/models/auth.rs`
- Test: inline tests in `google_identity.rs` and `auth.rs`

**Interfaces:**
- Consumes `GoogleLoginRequest` and `AppConfig.google_client_id: Option<String>`.
- Produces `auth::login_with_google(pool, credential, ip, user_agent) -> Result<(AuthResponse, String), ApiError>`.
- Produces `AuthRepository::resolve_google_guest(...) -> Result<User, ApiError>` inside a transaction.

- [ ] **Step 1: Write failing claim-validation and account-resolution tests**

```rust
#[test]
fn rejects_a_google_claim_with_the_wrong_audience() {
    let claims = claims("https://accounts.google.com", "other-client", future_expiry(), true);
    assert!(validate_claims(&claims, "hotel-client.apps.googleusercontent.com").is_err());
}

#[test]
fn rejects_an_unverified_google_email() {
    let claims = claims("accounts.google.com", "hotel-client.apps.googleusercontent.com", future_expiry(), false);
    assert!(validate_claims(&claims, "hotel-client.apps.googleusercontent.com").is_err());
}

#[test]
fn accepts_google_issuer_subject_and_verified_email() {
    let claims = claims("accounts.google.com", "hotel-client.apps.googleusercontent.com", future_expiry(), true);
    assert_eq!(validate_claims(&claims, "hotel-client.apps.googleusercontent.com").unwrap().subject, "10987654321");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd hotel-app-be && cargo test google_identity::tests`

Expected: FAIL because Google claims/JWKS validation is not implemented.

- [ ] **Step 3: Implement JWKS-backed validation and transactional account resolution**

```rust
// Reject credentials unless the cached or refreshed Google JWKS validates the
// RS256 signature, then validate iss, aud, exp, email_verified, email, and sub.
let identity = google_identity::verify_id_token(credential, config.google_client_id.as_deref()).await?;
let (user, created_or_linked) = AuthRepository::resolve_google_guest(pool, &identity).await?;
let response = issue_authenticated_response(pool, &user, ip_address, user_agent).await?;
```

`resolve_google_guest` must first locate `google_subject`; then link an active guest with the same normalized email; reject staff/admin/inactive/non-guest matches; otherwise insert the guest, user, guest role, and `google_subject` in one transaction. It must use PostgreSQL `ON CONFLICT`/unique-index handling to reload the winner during concurrent linking instead of returning a partial account.

- [ ] **Step 4: Run focused tests and the auth test suite**

Run: `cd hotel-app-be && cargo test google_identity && cargo test auth`

Expected: PASS, including wrong issuer/audience/expiry/unverified-email rejection and guest-only resolution tests.

- [ ] **Step 5: Commit Google verification and account resolution**

```bash
git add hotel-app-be/src/core/config.rs hotel-app-be/src/services/google_identity.rs hotel-app-be/src/repositories/auth.rs hotel-app-be/src/services/auth.rs hotel-app-be/src/models/auth.rs
git commit -m "feat(auth): authenticate guest accounts with Google"
```

### Task 3: Expose Google sign-in and profile completion APIs

**Files:**
- Modify: `hotel-app-be/src/routes/auth.rs`
- Modify: `hotel-app-be/src/handlers/auth.rs`
- Modify: `hotel-app-be/src/routes/profile.rs`
- Modify: `hotel-app-be/src/handlers/profile.rs`
- Modify: `hotel-app-be/src/services/profile.rs`
- Modify: `hotel-app-be/src/repositories/user.rs`
- Modify: `hotel-app-be/src/repositories/guest.rs`
- Test: inline tests in `profile.rs`; route/handler tests where the current harness supports them

**Interfaces:**
- Adds rate-limited `POST /auth/google` returning the existing refresh-cookie plus `Json<AuthResponse>`.
- Adds authenticated `POST /profile/complete` returning a profile response with `profile_complete` and `missing_profile_fields`.
- Adds `GuestRepository::complete_profile(pool, guest_id, input)` that synchronizes `guests` and `users` transactionally.

- [ ] **Step 1: Write failing service tests for guest-only completion and user/guest synchronization**

```rust
#[test]
fn completion_request_rejects_a_blank_phone() {
    let input = CompleteGuestProfileRequest {
        first_name: "Aisha".to_string(),
        last_name: "Rahman".to_string(),
        phone: " ".to_string(),
        address_line1: None,
    };
    assert!(validate_complete_guest_profile(&input).is_err());
}

#[test]
fn completion_request_accepts_a_missing_address() {
    let input = valid_completion_request(None);
    assert!(validate_complete_guest_profile(&input).is_ok());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd hotel-app-be && cargo test profile::tests::completion`

Expected: FAIL because the completion request validator and endpoint service do not exist.

- [ ] **Step 3: Implement the endpoints and transactional completion workflow**

```rust
.route("/auth/google", post(google_login))
.route("/profile/complete", post(complete_profile))
```

```rust
pub async fn complete_guest_profile(pool: &DbPool, user_id: i64, input: CompleteGuestProfileRequest) -> Result<UserProfile, ApiError> {
    let account = UserRepository::find_by_id(pool, user_id).await?.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;
    let guest_id = account.guest_id.ok_or_else(|| ApiError::Forbidden("Guest account required".to_string()))?;
    GuestRepository::complete_profile(pool, guest_id, user_id, validated_input).await?;
    get_user_profile(pool, user_id).await
}
```

The auth route must apply the existing auth rate limiter and capture client IP/user agent exactly as password login does. The handler must use `build_refresh_cookie` so the Google response preserves refresh/session behavior. Completion must reject non-guests, sanitize every free-text field, validate phone with the existing rules, honor the current unique guest-name constraint, and write `guests.first_name`, `guests.last_name`, `guests.full_name`, `guests.phone`, optional address, plus matching `users.full_name`/`users.phone` in one SQLx transaction.

- [ ] **Step 4: Run the focused profile tests and compile all features**

Run: `cd hotel-app-be && cargo test profile::tests && cargo check --all-features`

Expected: PASS.

- [ ] **Step 5: Commit the public auth and completion APIs**

```bash
git add hotel-app-be/src/routes/auth.rs hotel-app-be/src/handlers/auth.rs hotel-app-be/src/routes/profile.rs hotel-app-be/src/handlers/profile.rs hotel-app-be/src/services/profile.rs hotel-app-be/src/repositories/user.rs hotel-app-be/src/repositories/guest.rs
git commit -m "feat(profile): require Google guest completion"
```

### Task 4: Enforce profile completion for guest bookings

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs`
- Test: inline `#[cfg(test)]` module in `hotel-app-be/src/modules/guest_booking/service.rs`

**Interfaces:**
- Adds `GuestBookingRepository::profile_completion(pool, guest_id) -> Result<ProfileCompletion, ApiError>`.
- `guest_booking::service::create` returns `422` / `profile_incomplete` before quote, voucher, allocation, or booking mutation when incomplete.

- [ ] **Step 1: Write a failing booking-guard test**

```rust
#[test]
fn incomplete_profile_error_lists_the_missing_phone() {
    let error = profile_incomplete_error(ProfileCompletion::missing(vec!["phone"]));
    assert_eq!(error.status_code(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(error.to_string().contains("Complete your profile before making a booking."));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd hotel-app-be && cargo test guest_booking::service::tests::incomplete_profile`

Expected: FAIL because the guard helper does not exist.

- [ ] **Step 3: Add the repository query and create guard**

```rust
let completion = Repository::profile_completion(pool, guest_id).await?;
if !completion.complete {
    return Err(profile_incomplete_error(completion));
}
```

Place the guard immediately after idempotency lookup in `guest_booking::service::create` and before quote/allocation work. Encode `code: "profile_incomplete"` and `missing_profile_fields` in the API error body using the repository's existing JSON error response convention.

- [ ] **Step 4: Run guest-booking tests**

Run: `cd hotel-app-be && cargo test guest_booking`

Expected: PASS, including existing voucher, allocation, and idempotency tests.

- [ ] **Step 5: Commit the authoritative booking guard**

```bash
git add hotel-app-be/src/modules/guest_booking/repository.rs hotel-app-be/src/modules/guest_booking/service.rs
git commit -m "feat(bookings): block incomplete guest profiles"
```

### Task 5: Add public-web Google UI and completion workflow

**Files:**
- Create: `hotel-web-fe/src/features/auth/components/GoogleSignInButton.tsx`
- Create: `hotel-web-fe/src/features/auth/components/GoogleSignInButton.test.tsx`
- Create: `hotel-web-fe/src/features/auth/components/CompleteProfilePage.tsx`
- Create: `hotel-web-fe/src/features/auth/components/CompleteProfilePage.test.tsx`
- Modify: `hotel-web-fe/src/features/auth/components/LoginPage.tsx`
- Modify: `hotel-web-fe/src/features/auth/components/RegisterPage.tsx`
- Modify: `hotel-web-fe/src/api/auth.service.ts`
- Modify: `hotel-web-fe/src/api/auth.service.test.ts`
- Modify: `hotel-web-fe/src/auth/AuthContext.tsx`
- Modify: `hotel-web-fe/src/auth/authUser.ts`
- Modify: `hotel-web-fe/src/navigation/routeRegistry.tsx`
- Modify: `hotel-web-fe/src/router/RootLayout.tsx`
- Modify: `hotel-web-fe/src/desktop/runtimeApi.ts`

**Interfaces:**
- Adds `AuthService.loginWithGoogle(credential): Promise<AuthResponse>`.
- Adds `AuthService.completeGuestProfile(input): Promise<UserProfile>`.
- Extends `AuthUserShape` with `profile_complete: boolean` and `missing_profile_fields: ('first_name' | 'last_name' | 'phone')[]`.
- Adds `/complete-profile` route that only renders for an authenticated incomplete guest.

- [ ] **Step 1: Write the failing web/desktop button tests**

```tsx
it('loads and renders Google Identity Services for a configured web build', async () => {
  vi.stubEnv('VITE_APP_TARGET', 'web');
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'hotel-client.apps.googleusercontent.com');
  render(<GoogleSignInButton onCredential={onCredential} />);
  await waitFor(() => expect(window.google.accounts.id.renderButton).toHaveBeenCalled());
});

it('does not load Google Identity Services in a Tauri build', () => {
  vi.stubEnv('VITE_APP_TARGET', 'tauri');
  render(<GoogleSignInButton onCredential={onCredential} />);
  expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd hotel-web-fe && npm test -- GoogleSignInButton.test.tsx`

Expected: FAIL because the component and browser Google type declaration do not exist.

- [ ] **Step 3: Implement the minimal GIS bridge and auth exchange**

```tsx
if (shouldUseDesktopRuntime() || !clientId) return null;
google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => void onCredential(credential) });
google.accounts.id.renderButton(container.current!, { theme: 'outline', size: 'large', width: container.current!.clientWidth });
```

The script is injected once, the official rendered button is used, the credential is posted to `auth/google`, and the existing AuthContext token/user/role/session updates are reused. On success, a guest with `profile_complete === false` navigates to `/complete-profile`; a complete guest follows the existing guest-portal redirect. Keep password login/register controls present.

- [ ] **Step 4: Write failing completion-form tests**

```tsx
it('prefills Google names, rejects a missing phone, and allows an empty address', async () => {
  render(<CompleteProfilePage />);
  expect(screen.getByLabelText('First name')).toHaveValue('Aisha');
  expect(screen.getByLabelText('Last name')).toHaveValue('Rahman');
  await userEvent.click(screen.getByRole('button', { name: 'Complete profile' }));
  expect(await screen.findByText(/phone/i)).toBeVisible();
});
```

- [ ] **Step 5: Run the completion test to verify it fails**

Run: `cd hotel-web-fe && npm test -- CompleteProfilePage.test.tsx`

Expected: FAIL because the route and completion form do not exist.

- [ ] **Step 6: Implement completion page, route, and access guard**

```tsx
if (!isAuthenticated) return <Navigate to="/login?account=guest" replace />;
if (user?.user_type !== 'guest') return <Navigate to="/" replace />;
if (user.profile_complete) return <Navigate to="/guest-portal" replace />;
```

Use existing `validatePhone`, MUI fields, and the profile data returned by `UsersService.getUserProfile()` to prefill the form. On success, refresh the AuthContext user/profile state and navigate to `/portal/book` when the saved return target is that path; otherwise navigate to `/guest-portal`. Add `/complete-profile` to the guest visual shell condition in `RootLayout`.

- [ ] **Step 7: Run frontend auth and new component tests**

Run: `cd hotel-web-fe && npm test -- GoogleSignInButton.test.tsx CompleteProfilePage.test.tsx auth.service.test.ts AuthContext.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the Google and completion UI**

```bash
git add hotel-web-fe/src/features/auth/components/GoogleSignInButton.tsx hotel-web-fe/src/features/auth/components/GoogleSignInButton.test.tsx hotel-web-fe/src/features/auth/components/CompleteProfilePage.tsx hotel-web-fe/src/features/auth/components/CompleteProfilePage.test.tsx hotel-web-fe/src/features/auth/components/LoginPage.tsx hotel-web-fe/src/features/auth/components/RegisterPage.tsx hotel-web-fe/src/api/auth.service.ts hotel-web-fe/src/api/auth.service.test.ts hotel-web-fe/src/auth/AuthContext.tsx hotel-web-fe/src/auth/authUser.ts hotel-web-fe/src/navigation/routeRegistry.tsx hotel-web-fe/src/router/RootLayout.tsx hotel-web-fe/src/desktop/runtimeApi.ts
git commit -m "feat(web): add Google guest sign-in"
```

### Task 6: Redirect booking UI and sync configuration/resources

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx`
- Modify: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.test.tsx`
- Modify: `hotel-web-fe/src/types/guestPortal.types.ts`
- Modify: `hotel-web-fe/src/features/guestPortal/api/guestPortalDashboard.service.ts`
- Modify: `hotel-app-be/.env.example`
- Create: `hotel-web-fe/.env.example` if absent
- Modify: desktop resources produced by `cd hotel-desktop && bun run sync:resources`

**Interfaces:**
- Portal `me` and session responses include `profile_complete` and `missing_profile_fields`.
- Booking page redirects incomplete guests to `/complete-profile?returnTo=%2Fportal%2Fbook` before final submit.

- [ ] **Step 1: Write a failing booking-page redirect test**

```tsx
it('sends an incomplete guest to completion before booking submission', async () => {
  mocks.portalMe.mockResolvedValue({ guest, profile_complete: false, missing_profile_fields: ['phone'] });
  render(<PortalBookingPage />);
  await userEvent.click(screen.getByRole('button', { name: /confirm booking/i }));
  expect(mocks.navigate).toHaveBeenCalledWith('/complete-profile?returnTo=%2Fportal%2Fbook');
  expect(mocks.createBooking).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd hotel-web-fe && npm test -- PortalBookingPage.test.tsx`

Expected: FAIL because guest portal session state does not expose completion and no redirect occurs.

- [ ] **Step 3: Implement portal completion propagation and redirect**

```tsx
if (!profileComplete) {
  navigate('/complete-profile?returnTo=%2Fportal%2Fbook');
  return;
}
```

Use the completion state from `GET /guest-portal/me` or the session response, not a locally inferred phone field, so the browser uses the backend's authoritative rule. If the backend returns `code: "profile_incomplete"` because completion changed after page load, redirect and preserve the server-provided missing-field message.

- [ ] **Step 4: Document configuration and synchronize desktop resources**

```text
GOOGLE_CLIENT_ID=1234567890-example.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=1234567890-example.apps.googleusercontent.com
```

Run: `cd hotel-desktop && bun run sync:resources`

Expected: the generated desktop database resources include `0002_google_guest_registration.sql`; inspect `git status --short` and include only intended synchronized files.

- [ ] **Step 5: Run targeted portal tests and frontend checks**

Run: `cd hotel-web-fe && npm test -- PortalBookingPage.test.tsx && npx tsc --noEmit && npm run build:web && npm run build:tauri`

Expected: PASS.

- [ ] **Step 6: Commit the booking guidance and resources**

```bash
git add hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.test.tsx hotel-web-fe/src/types/guestPortal.types.ts hotel-web-fe/src/features/guestPortal/api/guestPortalDashboard.service.ts hotel-app-be/.env.example hotel-web-fe/.env.example hotel-desktop/src-tauri/database
git commit -m "feat(portal): guide guests to complete profiles"
```

### Task 7: Full verification and final review

**Files:**
- Modify only files required to correct discovered failures.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified backend, web, and desktop-compatible resources.

- [ ] **Step 1: Format backend code**

Run: `cd hotel-app-be && cargo fmt`

Expected: formatter succeeds; inspect the resulting diff before staging.

- [ ] **Step 2: Run the complete backend verification suite**

Run: `cd hotel-app-be && cargo test && cargo check --all-features && cargo clippy --all-features -- -D warnings`

Expected: all commands exit 0.

- [ ] **Step 3: Run complete frontend verification**

Run: `cd hotel-web-fe && npm test && npx tsc --noEmit && npm run build:web && npm run build:tauri`

Expected: all commands exit 0.

- [ ] **Step 4: Verify desktop Rust and packaging preparation**

Run: `cd hotel-desktop/src-tauri && cargo fmt && cargo check`

Run: `cd hotel-desktop && bun run desktop:prepare`

Expected: both commands exit 0 and no database resource is missing.

- [ ] **Step 5: Review the final diff and commit any verification fixes**

```bash
git diff --check
git status --short
git diff --stat HEAD~1..HEAD
```

Only stage intended feature files. If formatting or verification created an intentional final correction, commit it with `fix(auth): verify Google guest registration`.

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement Google identity, guest-only account linking, session compatibility, profile completion, configuration, and error behavior. Task 4 implements the backend booking boundary. Tasks 5–6 cover web-only GIS rendering, completion UX, Tauri exclusion, booking redirect, environment docs, and desktop resource synchronization. Task 7 executes all required verification.
- Placeholder scan: every task names concrete files, interfaces, tests, commands, and expected results.
- Type consistency: `GoogleLoginRequest`, `CompleteGuestProfileRequest`, `ProfileCompletion`, `profile_complete`, and `missing_profile_fields` are used consistently across database, Rust service, API, and React tasks.
