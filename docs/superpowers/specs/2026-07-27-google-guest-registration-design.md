# Google Guest Registration and Profile Completion Design

## Goal

Allow guests to register or sign in with a Google account from the public web
guest portal, then require first name, last name, and phone before they can
create a booking. Address remains optional.

## Scope

This feature applies only to the public web guest experience. The Tauri desktop
application keeps its existing authentication UI and behavior.

The feature covers:

- Google registration and sign-in for guest accounts.
- Safe linking to an existing guest account with the same normalized email.
- A required profile-completion screen with Google-provided names prefilled.
- Frontend and backend enforcement before guest booking creation.
- Existing session, logout, refresh, and guest-portal behavior after sign-in.

The feature does not cover:

- Google sign-in for staff or administrators.
- Access to Google APIs such as Calendar, Drive, or Gmail.
- Additional social identity providers.
- Google One Tap or automatic sign-in.
- Changes to existing password registration or login.

## User Experience

The public web login and registration pages display the official Google
Identity Services button alongside the existing forms. Tauri builds do not load
or display the Google button.

After a successful Google credential exchange:

1. A returning linked guest enters the guest portal.
2. A Google account matching an existing guest email is linked and enters the
   guest portal.
3. A new guest account is created from Google's verified identity.
4. If first name, last name, or phone is missing, the guest is redirected to
   `/complete-profile`.

The completion page:

- Prefills first and last name from Google when available.
- Allows the guest to edit both name fields.
- Requires first name, last name, and a valid phone number.
- Treats address as optional.
- Returns the guest to the intended booking flow after completion.

An incomplete guest may browse the portal, search availability, and request
quotes. The final booking submission is unavailable until the required profile
fields are complete.

## Google Authentication Flow

The frontend uses the official Google Identity Services JavaScript library and
button. It does not add a frontend authentication package or render a custom
Google button.

The Google callback sends the returned ID-token credential to:

```text
POST /auth/google
```

The backend verifies:

- The token signature against Google's rotating JWKS keys.
- `iss` is `accounts.google.com` or `https://accounts.google.com`.
- `aud` equals the configured web client ID.
- `exp` has not passed.
- `email_verified` is true.
- `sub` is present and non-empty.
- `email` is present and syntactically valid.

Google's `sub` claim is the permanent external identity. Email is used only for
the initial account-linking decision.

The endpoint returns the same access-token, refresh-cookie, user, role,
permission, and route-policy session shape used by the existing login flow,
extended with profile-completion information. Existing refresh and logout
behavior remains unchanged.

## Account Resolution

Account resolution and account creation run in a database transaction.

The backend resolves a valid Google identity in this order:

1. Find a user by `google_subject`. If it is an active guest, sign it in.
2. Find a user by normalized Google email. If it is an active guest, set its
   `google_subject` and sign it in.
3. If the normalized email belongs to staff, an administrator, an inactive
   account, or an account without a linked guest, reject Google sign-in.
4. Otherwise create linked `users` and `guests` rows, assign the guest role,
   store `google_subject`, mark the email verified, and sign the guest in.

Google sign-in never authenticates a staff or administrator account. Those
users continue through the normal staff login flow.

New Google users have no password hash. The existing nullable
`users.password_hash` column supports this without a placeholder password.

The new username is derived from the normalized email local part and made
unique with a stable suffix from the Google subject when required. It must
continue to satisfy the current lowercase username database constraint.

Google name claims populate `guests.first_name`, `guests.last_name`, and the
corresponding user display name when present. If Google omits a required name,
that field remains incomplete. A unique temporary display name based on the
Google subject is used only when needed to satisfy the existing non-null and
unique `guests.full_name` constraints.

## Data Model

A new forward-only PostgreSQL migration adds:

```sql
ALTER TABLE users ADD COLUMN google_subject VARCHAR(255);

CREATE UNIQUE INDEX uq_users_google_subject
    ON users (google_subject)
    WHERE google_subject IS NOT NULL;
```

The historical PostgreSQL V1 baseline is not edited.

A dedicated Google column is preferred over a general external-identity table
because Google is the only requested provider. A provider abstraction can be
introduced later if another identity provider is approved.

No `profile_complete` column is stored. Completion is derived from the guest
record so it cannot become stale.

## Profile Completeness

A guest profile is complete when all of these are true:

- `guests.first_name` is non-empty after trimming.
- `guests.last_name` is non-empty after trimming.
- `guests.phone` is non-empty and passes the existing phone validation rules.

Address has no effect on completeness.

The authentication access snapshot, Google login response, and guest profile
response expose:

```json
{
  "profile_complete": false,
  "missing_profile_fields": ["phone"]
}
```

The exact field identifiers are `first_name`, `last_name`, and `phone`.

Profile completion uses an authenticated guest-only endpoint:

```text
POST /profile/complete
```

Its request shape is:

```json
{
  "first_name": "Aisha",
  "last_name": "Rahman",
  "phone": "+60123456789",
  "address_line1": "Optional address"
}
```

The service sanitizes and validates the input, rejects non-guest accounts, and
updates the linked user and guest rows in one transaction. It returns the
updated profile-completion state.

The existing general profile-editing endpoint remains compatible. Changes made
through either profile path must keep the linked user's display fields and
guest contact fields consistent.

## Booking Enforcement

The frontend uses `profile_complete` to redirect an incomplete guest to
`/complete-profile` when the guest starts or submits the booking workflow. The
intended destination is retained so the guest can resume after completion.

The backend is authoritative. The guest booking creation service checks the
current guest row before calculating or persisting the booking. If the profile
is incomplete, it returns HTTP `422` with:

```json
{
  "error": "Complete your profile before making a booking.",
  "code": "profile_incomplete",
  "missing_profile_fields": ["phone"]
}
```

Search, quote, dashboard, support, payment, and existing-booking operations are
not blocked by this rule.

Staff booking creation routes are unchanged because staff may create bookings
for guest records through their existing workflow.

## Configuration

The frontend reads the public Google web client ID from:

```text
VITE_GOOGLE_CLIENT_ID
```

The backend reads the accepted audience from:

```text
GOOGLE_CLIENT_ID
```

Both variables are documented in the appropriate example environment files.
The client ID is public configuration, not a client secret. No Google client
secret is required for this ID-token sign-in flow.

When the frontend variable is absent, the Google button is not rendered and
existing login remains available. When the backend variable is absent, the
Google endpoint returns a service-configuration error without accepting a
credential.

Google public keys are cached according to their HTTP cache lifetime. A key
rotation miss triggers one refresh before rejecting the credential.

## Error Handling

- Invalid, expired, malformed, unverified-email, or wrong-audience Google
  credentials return `401` with a generic Google sign-in failure.
- A matching staff, administrator, inactive, or unlinked non-guest account
  returns `409` and directs the user to the normal login or hotel support.
- A Google subject already linked to another account is rejected. The unique
  index and transaction protect concurrent linking attempts.
- Invalid or missing profile-completion fields return `422` with
  `missing_profile_fields`.
- A completed name conflicting with the existing unique guest-name rule returns
  `409` using the existing contact-hotel guidance.
- Transaction failures leave no partially linked user, guest, role, or Google
  identity.
- Internal verification and database details are logged server-side; responses
  do not expose token contents, key material, or SQL errors.

## Security

- Google credentials are verified only on the backend.
- The frontend never treats decoded token claims as authenticated facts.
- The backend validates signature, issuer, audience, expiry, verified email,
  and subject before account lookup or mutation.
- Google sign-in is restricted to guest accounts.
- Existing authentication rate limiting is applied to `/auth/google`.
- SQL remains parameterized.
- Account creation and linking are transactional.
- Google credentials and application tokens are never logged.
- The refresh token continues to use the existing HttpOnly cookie mechanism.
- Booking enforcement is server-side and cannot be bypassed with a direct API
  request.

## Testing

Implementation follows red-green-refactor with a failing test before each
behavior change.

Backend tests cover:

- Profile completeness for each missing required field.
- Optional address not affecting completeness.
- Google claim validation for issuer, audience, expiry, verified email, and
  subject.
- Deterministic, valid, unique username generation.
- Returning Google-subject login.
- Existing guest-email linking.
- Rejection of staff, administrator, inactive, and unlinked non-guest matches.
- New guest/user/role creation without a password.
- Concurrent or duplicate identity linking.
- Transactional profile completion and linked-record synchronization.
- Guest booking rejection with the structured incomplete-profile response.
- Successful booking authorization after completion.

Frontend Vitest tests cover:

- Google button visibility for web builds.
- Google button absence for Tauri builds.
- Credential exchange through the existing authentication state.
- Redirect to `/complete-profile` when required.
- Google name prefilling and editable name fields.
- Required phone validation and optional address.
- Booking redirection while incomplete.
- Resuming the intended booking flow after completion.
- Existing password login and registration remaining available.

Final verification runs:

```bash
cd hotel-app-be
cargo fmt
cargo test
cargo check --all-features
cargo clippy --all-features -- -D warnings

cd ../hotel-web-fe
npm test
npx tsc --noEmit
npm run build:web
npm run build:tauri
```

If Google key verification requires a new Rust crate after confirming the
existing `jsonwebtoken` and `reqwest` capabilities are insufficient, the
implementation must choose one established, narrowly scoped crate and document
the reason. No frontend authentication dependency is added.

## Acceptance Criteria

- A guest can register or sign in with Google from the public web login and
  registration pages.
- The Google control is absent from Tauri builds.
- Existing guest email matches link automatically; staff/admin matches do not.
- Google name data is prefilled on profile completion.
- First name, last name, and phone are required before booking.
- Address remains optional.
- The frontend guides incomplete guests to profile completion.
- The backend rejects booking creation for incomplete profiles.
- Completing the profile allows the guest to resume and create a booking.
- Existing password authentication and staff booking behavior are preserved.
