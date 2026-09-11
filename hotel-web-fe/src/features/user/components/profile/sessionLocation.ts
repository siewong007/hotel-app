import type { UserSessionInfo } from '../../../../types';

/**
 * The approximate place a session was signed in from, or `null` when unknown.
 *
 * The backend derives this from the IANA timezone the browser reported at
 * sign-in (`services::profile::location_from_timezone`), NOT from an IP lookup —
 * there is no geolocation anywhere in this stack, and the IP is masked before it
 * leaves the server. Callers must therefore label it as approximate.
 *
 * `null` is normal and expected: sessions minted before the field existed carry
 * no timezone, and zones that name no place (UTC, Etc/GMT+8) resolve to nothing.
 */
export function sessionLocation(session: UserSessionInfo): string | null {
  const location = session.location?.trim();
  if (location) {
    return location;
  }
  // Fall back to the raw zone: "Etc/GMT+8" is a poor city name but still
  // tells the owner more about an unfamiliar session than a blank does.
  const timezone = session.timezone?.trim();
  return timezone ? timezone : null;
}

/**
 * One line describing when and roughly where a session was last used.
 * The word "approximate" is deliberate and must survive any rewording — the
 * value is a timezone, and presenting it as a confirmed location would
 * overstate what the server actually knows.
 */
export function sessionActivityLine(session: UserSessionInfo): string {
  const lastActive = new Date(session.last_used_at || session.created_at).toLocaleString();
  const place = sessionLocation(session);
  return place
    ? `Last active: ${lastActive} · ${place} (approximate)`
    : `Last active: ${lastActive}`;
}
