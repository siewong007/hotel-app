/**
 * Role-based two-factor enrolment policy, client side.
 *
 * The backend applies the policy while minting a session
 * (`services::auth::two_factor_policy`). Two outcomes reach this app:
 *
 * - inside the grace window, sign-in SUCCEEDS and the response carries
 *   `two_factor_enrollment_required` with a deadline; the reader is routed to
 *   enrolment but keeps a working session;
 * - past the deadline, sign-in FAILS with HTTP 403 and the stable body code
 *   below.
 *
 * The code is matched instead of the message because the backend's copy is
 * user-facing prose and is translated; see the sibling `guest_name_taken` and
 * `profile_incomplete` checks in the guest portal for the same reasoning.
 */
export const TWO_FACTOR_ENROLLMENT_REQUIRED_CODE = 'two_factor_enrollment_required';

/** Where an in-scope account is sent to enrol. */
export const TWO_FACTOR_ENROLLMENT_PATH = '/enroll-two-factor';

/**
 * Whether a failed sign-in was refused because enrolment is now overdue.
 *
 * Reads the code off whatever the caller caught: `AuthContext.login` rethrows
 * this case as an `APIError` carrying the parsed body on `details`, and a raw
 * `HTTPError` body (ky puts it on `.data`) is accepted too so a caller that
 * skips AuthContext still works.
 */
export function isTwoFactorEnrollmentRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidates = [
    (error as { details?: unknown }).details,
    (error as { data?: unknown }).data,
  ];
  return candidates.some(
    (body) =>
      Boolean(body) &&
      typeof body === 'object' &&
      (body as { code?: unknown }).code === TWO_FACTOR_ENROLLMENT_REQUIRED_CODE
  );
}

/**
 * The enrolment deadline as a date the reader can act on, or `null` when the
 * backend sent nothing usable. Never throws on a malformed value: a missing
 * deadline degrades to an undated prompt rather than breaking sign-in.
 */
export function parseEnrollmentDeadline(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
