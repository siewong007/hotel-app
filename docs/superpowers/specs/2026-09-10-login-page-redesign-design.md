# Login Page: Google Sign-In Enablement, Return Affordance, Minimalist Redesign

## Status of the four requests

Verified 2026-09-10 against the working tree and `origin/master`.

**Google sign-in — already built, end to end.** `POST /api/auth/google`
(`routes/auth.rs:41`) → `handlers::auth::google_login_handler` →
`services::auth::login_with_google` → `AuthRepository::resolve_google_guest`, with
`services/google_identity.rs` doing RS256 + JWKS + audience verification. On the
frontend, `GoogleSignInButton` renders Google's own GSI button and is already mounted on
`LoginPage.tsx:689` and `RegisterPage.tsx:633`, wired through
`AuthContext.loginWithGoogle` → `AuthService.loginWithGoogle`. Tests exist at
`GoogleSignInButton.test.tsx`, `LoginPage.test.tsx`, `RegisterPage.test.tsx`,
`AuthContext.test.tsx`, `auth.service.test.ts`. Nothing to implement.

**Google sign-up — already built.** First-time Google users are routed to `/register`,
where the consent gate collects Booking Terms + Privacy Notice and passes them as
`consents` on the same endpoint (`RegisterPage.tsx:209`). `login_with_google` rejects a
first-time create without those consents. `LoginPage` surfaces this as
`t('login.googleNeedsAccount')` on a 400 mentioning consent.

**Return button — genuinely missing.** `LoginPage` has no back affordance. Its only
outbound links are `/register` and post-auth destinations.

**Minimalist redesign — real work.** `LoginPage.tsx` is 902 lines carrying substantial
decoration.

So the actual scope is: unblock Google in the deployed environment, add the return
affordance, and strip the login page down.

## Part 1 — Google sign-in is invisible in production (the real gap)

The feature is shipped in code and absent at runtime, because its configuration never
reaches either deployed process. This is the highest-value item and it is config, not code.

Frontend: `GoogleSignInButton` reads `import.meta.env.VITE_GOOGLE_CLIENT_ID` and returns
`null` when it is unset — deliberately, as "feature unavailable". Vite bakes `VITE_*` at
build time, and `hotel-web-fe/Dockerfile` declares only `ARG VITE_API_URL` and
`ARG VITE_ENVIRONMENT`; `.github/workflows/deploy.yml:114` and
`deploy-staging.yml:126` pass only `--build-arg VITE_API_URL=`. The variable exists
solely in `hotel-web-fe/.env.example`. The production bundle therefore has no client id
and the button renders nothing.

Backend: `deploy/docker-compose.prod.yml` enumerates the backend environment explicitly
(`JWT_SECRET`, `PASSKEY_RP_ID`, `PAYPAL_*`, …) and has no `GOOGLE_CLIENT_ID` entry, and
neither `deploy/deploy.sh` nor the workflows supply one. `core/config.rs:157` reads it as
`env_opt`, so it is `None`, and `verify_id_token` fails closed with
`ServiceUnavailable("Google sign-in is not configured.")`. There is no security hole —
the audience is never skipped — but the endpoint could not succeed even if the button
were visible.

Both halves must be set to the same OAuth client, as both `.env.example` files already
state.

Work:

- Add `ARG VITE_GOOGLE_CLIENT_ID` / `ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID`
  to `hotel-web-fe/Dockerfile` beside the existing two.
- Pass `--build-arg VITE_GOOGLE_CLIENT_ID="${{ secrets.GOOGLE_CLIENT_ID }}"` in the
  frontend `docker build` of both `deploy.yml` and `deploy-staging.yml`. A client id is
  public by design (it ships in the bundle either way), so a repository variable is
  acceptable if a secret is inconvenient.
- Add `GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID:-}"` to the backend `environment` block of
  `deploy/docker-compose.prod.yml` and `deploy/docker-compose.staging.yml`, and add the
  key to `secrets.env` on the host. Keep the `:-` default so an unset value leaves the
  feature disabled rather than aborting compose — matching how `PAYPAL_*` behaves and how
  the code already fails closed.
- Register the Google Cloud OAuth client's authorized JavaScript origins for
  `https://saliminn.my`, `https://www.saliminn.my`, and the staging host. GSI rejects an
  unregistered origin in the browser, so this cannot be verified from the repository.
- Confirm the deploy actually ran. A green "Deploy production" run can skip the deploy
  job entirely; read the job conclusion, not the run conclusion.

Note that `deploy-staging.sh` and `deploy-staging.yml` are not covered by any test that
enforces parity with the production pair, so both must be edited by hand.

Do not add a desktop path: `GoogleSignInButton` disables itself under
`shouldUseDesktopRuntime()`, and Google sign-in is web-only and guest-only by design
(`ensure_active_google_guest` returns 409 for staff and inactive accounts). A staff member
who clicks the button gets that 409 surfaced as an error, which is correct but worth a
clearer message — see Part 3.

## Part 2 — Return affordance

Add one back control at the top-left of the auth card, above the heading, on both
`LoginPage` and `RegisterPage` so the pair stays consistent.

Destination must be deterministic rather than purely history-based, because arrivals are
varied: the landing page, `/register`, a `ProtectedRoute` redirect, `ClaimAccountStep`'s
"Sign in instead" link, an `AuthContext` session-expiry hard navigation
(`window.location.href = '/login'`), or a typed URL. A bare `history.back()` strands the
user on the last two.

Resolution order:

1. If `?redirect=` is present and passes `safeGuestRedirect`, return there — a guest who
   came from the booking flow goes back to the booking flow. Reuse the existing allowlist;
   do not read the raw parameter.
2. Otherwise, if in-app history exists (same-origin `document.referrer`), `history.back()`.
3. Otherwise, navigate to `/`.

Steps 2 and 3 are exactly `returnToPreviousPage` in
`src/features/legal/components/LegalDocumentPage.tsx:45`, currently a private function
with its own tests. Extract it to a shared util (`src/utils/returnNavigation.ts`), point
`LegalDocumentPage` at it unchanged so its tests keep passing, and layer step 1 on top for
the auth pages. Do not fork a second copy.

Label from i18n, not a literal: add `common.back` (or `login.back`) to
`src/i18n/resources/en/auth.json` and `ms/auth.json`. `ArrowBackIcon` +
`variant="text"` matches the legal page and `StatusPage`.

## Part 3 — Minimalist redesign

Keep the flow, strip the decoration. The two-step username-then-password sequence is a
deliberate control backed by `POST /auth/login/lookup` and pinned by two tests
("advances past the username step only after lookup confirms the account exists",
"keeps the password field hidden when the username or email is unknown"). Do not collapse
it into a single form; that would delete a tested behaviour to serve a visual preference.
The redesign is a styling and copy pass over the same state machine.

Remove:

- The full-page rotating `--hotel-soft-glow` pseudo-element and its `rotate` keyframes
  (`LoginPage.tsx:481-494`). A 20-second infinite transform on a 200%-by-200% layer behind
  the card is the single largest visual and compositing cost on the page.
- The gradient-clipped uppercase `h1` at `2.75rem`/`4rem`/`5rem` with
  `WebkitTextFillColor: 'transparent'`, and the 60x4 gradient rule beneath it. Replace
  with a plain-weight heading in the card's serif face at a normal size. Note that
  `.auth-card::before` already prints the hotel name as an eyebrow, so the page has three
  stacked titles today.
- The duplicate step header: the card renders `t('login.title')` + `t('login.subtitle')`,
  then immediately a second "Sign in" + `t('login.subtitle')` again with a gradient circle
  icon that swaps between lock, person and fingerprint. Keep one heading; keep a small
  inline progress cue only for the passkey-checking state.
- `transform: translateY(-2px)` on text-field hover, and the lift-plus-shadow on button
  hover. Inputs that move under the cursor are the least minimalist thing on the page.
- `Slide direction="left"` around the form body, and the 800ms `Fade`. A short fade on the
  card is enough; the slide fights the step transitions.
- Dead code: `handlePasskeyRegister` (`LoginPage.tsx:220-240`) is defined and never
  rendered, and contains the page's only raw `alert()`. Delete it and drop
  `registerPasskey` from the `useAuth()` destructure. Confirm with a repo-wide grep before
  deleting, per the dead-code rule — a `dead_code`-style signal from one entry point is not
  proof.

Keep: `elevation`/`--hotel-panel-bg` card, `LanguageSwitcher`, the account chip with its
"Change" affordance, the password visibility toggle, the `Collapse` error alert, the
`dvh` viewport handling and the mobile `.auth-page` overrides in `index.css` — those fix
real mobile bugs and are commented as such.

Localization, in the same pass. The page currently uses `t()` for only five strings
(`login.title`, `subtitle`, `or`, `noAccount`, `signUp`, `googleNeedsAccount`) while
roughly twenty are hardcoded English: "Username or Email", "Next", "Sign in with
passkey", "Password", "Sign In", "Change", "Checking for passkey...", "Please respond to
your browser's authentication prompt", "Passkey not available. Using password instead.",
"Use a passkey instead", the whole two-factor screen ("Two-Factor Authentication",
"Authentication or recovery code", its helper text, "Verify", "Cancel"), and the inline
error strings. Move all of them into `auth.json` for `en` and `ms`. This is the cheapest
moment to do it because the markup is being rewritten anyway.

While touching the error branch: the 409 from `ensure_active_google_guest` currently
reaches the user as the raw backend sentence. Give it the same treatment as the 503 branch
— branch on `statusCode === 409` and say that Google sign-in is for guest accounts and
staff should use their username. Follow the existing comment's rule and branch on status,
never on message text.

Scope boundary: `RegisterPage.tsx` (668 lines) shares the same card, gradient heading and
hover-lift vocabulary. Restyling only the login page leaves the two visibly inconsistent
one click apart. Recommend doing both in the same change, with the shared card styling
living in `index.css` under `.auth-card` where most of it already is; the register page's
consent block and field set stay untouched.

## Verification

Frontend gates, all three, from `hotel-web-fe/`: `bun run typecheck`, `bun run lint`,
`bun run test` — independent gates, and typecheck must run after any test edits because
vitest transpiles without type information. Then `bun run build`.

The existing five `LoginPage.test.tsx` cases plus the two lookup-gate cases must pass
unmodified; they are the guard that the redesign changed only presentation. If a selector
breaks because a string moved into i18n, update the selector, not the assertion. Add
cases for the return control: that a whitelisted `?redirect=` returns to the booking
flow, that a non-whitelisted value does not, and that a direct arrival lands on `/`.

`RegisterPage.test.tsx` mocks `./GoogleSignInButton`; keep that mock working if the
component's props change.

Do not run two vitest suites concurrently in this tree — overlapping runs produce timeout
failures in untouched domains.

No backend code changes are proposed, so no `cargo` gate applies and `openapi_drift` is
untouched — `/api/auth/google` is already in `docs/api/openapi.json`. Part 1 changes
Docker and compose files only; the desktop `cargo check` job is unaffected.

What cannot be verified from the repository, and must be stated as such when reporting:
that the Google OAuth client's authorized origins are registered, that
`GOOGLE_CLIENT_ID` is present in the host's `secrets.env`, and that a real Google
credential completes the round trip in the deployed environment. The button rendering is
also unobservable in local dev without a client id in `hotel-web-fe/.env`.

## Sequencing

Part 1 first and on its own — it is small, it is the only item that changes what users
can actually do today, and it needs a deploy plus a Google Cloud console change to prove
out. Parts 2 and 3 then ship together as one frontend change across both auth pages.
