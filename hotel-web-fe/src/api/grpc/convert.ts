// Shared proto → REST-shape converters. The pilot contract was designed so
// every gRPC response carries the same data the REST handler emits; these
// helpers rebuild the REST wire shapes (snake keys, major-unit numbers,
// RFC3339/ISO strings, plain JSON for free-form fields) so callers above the
// service seam see no difference between the two transports.

import { fromJson, toJson } from '@bufbuild/protobuf';
import { timestampDate, ValueSchema } from '@bufbuild/protobuf/wkt';
import type { JsonValue } from '@bufbuild/protobuf';
import type { Timestamp, Value } from '@bufbuild/protobuf/wkt';

import type { Money } from '../../gen/hotel/common/v1/types_pb';
import type { Decimal } from '../../gen/google/type/decimal_pb';
import type { Date as GoogleDate } from '../../gen/google/type/date_pb';

/** "rooms/123" → 123 */
export function nameId(name: string): number {
  const id = parseInt(name.slice(name.lastIndexOf('/') + 1), 10);
  return Number.isFinite(id) ? id : 0;
}

/** "rooms/123" → "123" — REST serializes several id fields as strings. */
export function nameIdString(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

export function roomName(id: number | string): string {
  return `rooms/${id}`;
}

export function roomTypeName(id: number | string): string {
  return `roomTypes/${id}`;
}

export function userName(id: number | string): string {
  return `users/${id}`;
}

export function bookingName(id: number | string): string {
  return `bookings/${id}`;
}

export function guestName(id: number | string): string {
  return `guests/${id}`;
}

export function taskName(id: number | string): string {
  return `housekeepingTasks/${id}`;
}

export function ticketName(id: number | string): string {
  return `maintenanceTickets/${id}`;
}

/** Money (minor units) → REST major-unit number. */
export function moneyToMajor(m: Money | undefined): number | undefined {
  return m ? Number(m.amountMinor) / 100 : undefined;
}

export function majorToMoney(n: number | string | undefined): Money | undefined {
  if (n === undefined) return undefined;
  const minor = Math.round(Number(n) * 100);
  return { $typeName: 'hotel.common.v1.Money', amountMinor: BigInt(minor), currencyCode: '' };
}

/** google.type.Decimal → number. */
export function decimalToNumber(d: Decimal | undefined): number | undefined {
  if (!d) return undefined;
  const n = parseFloat(d.value);
  return Number.isFinite(n) ? n : undefined;
}

export function numberToDecimal(n: number | string | undefined): Decimal | undefined {
  return n === undefined ? undefined : { $typeName: 'google.type.Decimal', value: String(n) };
}

/** Timestamp → ISO string (REST serializes timestamptz as RFC3339). */
export function tsToIso(t: Timestamp | undefined): string | undefined {
  return t ? timestampDate(t).toISOString() : undefined;
}

/** google.type.Date → "YYYY-MM-DD" (REST date strings). */
export function gdateToString(d: GoogleDate | undefined): string | undefined {
  if (!d || !d.year) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** "YYYY-MM-DD" → google.type.Date. */
export function stringToGdate(s: string | undefined): GoogleDate | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return { $typeName: 'google.type.Date', year: y, month: m, day: d };
}

/** google.protobuf.Value → plain JSON (items_used / images round-trip verbatim). */
export function valueToJson(v: Value | undefined): unknown {
  return v === undefined ? undefined : toJson(ValueSchema, v);
}

export function jsonToValue(j: unknown): Value | undefined {
  return j === undefined ? undefined : fromJson(ValueSchema, j as JsonValue);
}

/**
 * pb enum (generated `as const` object: `{UNSPECIFIED: 0, CHECKOUT_CLEAN: 2}`)
 * → REST snake string ("checkout_clean"). UNSPECIFIED and unknown values map
 * to undefined — matching REST, where absent data is simply absent.
 */
export function enumToRest<E extends Record<string, number>>(
  e: E,
  v: number | undefined,
): string | undefined {
  if (v === undefined || v === 0) return undefined;
  for (const k in e) {
    if (e[k] === v) return k.toLowerCase();
  }
  return undefined;
}

/** REST snake string → pb enum value; unknown/empty → undefined (field unset). */
export function restToEnum<E extends Record<string, number>>(
  e: E,
  s: string | undefined,
): E[keyof E] | undefined {
  if (!s) return undefined;
  const v = e[s.toUpperCase()];
  return (v === 0 ? undefined : v) as E[keyof E] | undefined;
}
