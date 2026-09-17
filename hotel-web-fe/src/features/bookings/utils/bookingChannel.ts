import type { BookingWithDetails } from '../../../types';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { formatStatusLabel } from '../../../utils/formatters';
import { t as translate } from '../../../i18n';

export type BookingChannelInfo = {
  name: string;
  abbreviation: string;
  background: string;
  color: string;
};

type BookingChannelStyle = Pick<BookingChannelInfo, 'background' | 'color'> & { patterns: RegExp[] };

/** Everything the channel resolver reads off a booking. `booking_channel_name`
 *  and `booking_channel_type` are resolved server-side from the structured
 *  `bookings.booking_channel_id` link; the remaining three are the legacy
 *  free-text trail kept for bookings created before that link was written. */
type ChannelSourceFields = Pick<
  BookingWithDetails,
  'source' | 'remarks' | 'booking_remarks' | 'booking_channel_name' | 'booking_channel_type'
>;

/** Channel types that describe a direct sale rather than a bookable online
 *  channel. A booking linked to one of these carries no channel badge, which
 *  is how walk-in and phone bookings have always rendered. */
const NON_ONLINE_CHANNEL_TYPES = new Set(['direct', 'walk_in', 'phone', 'corporate']);

const KNOWN_ONLINE_CHANNEL_STYLES: BookingChannelStyle[] = [
  { background: '#e81f45', color: '#fff', patterns: [/agoda/i] },
  { background: '#003b95', color: '#fff', patterns: [/booking\.com/i] },
  { background: '#087ce4', color: '#fff', patterns: [/traveloka/i] },
  { background: '#ffc72c', color: '#172033', patterns: [/expedia/i] },
  { background: '#ff5a5f', color: '#fff', patterns: [/airbnb/i] },
  { background: '#1976d2', color: '#fff', patterns: [/\bwebsite\b/i, /\bweb\b/i] },
  { background: '#00796b', color: '#fff', patterns: [/\bota\b/i, /\bonline\b/i] },
];

const toChannelAbbreviation = (name: string) => {
  const compact = name.replace(/\.com/gi, '').trim();
  const words = compact.match(/[A-Za-z0-9]+/g) || [];

  if (words.length > 1) {
    return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase();
  }

  return (compact.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'WEB').toUpperCase();
};

const cleanChannelName = (value: string) => value
  .replace(/\s*-\s*Ref:.*$/i, '')
  .replace(/\s*Reference:.*$/i, '')
  .replace(/\s*Booking$/i, '')
  .trim();

const normalizeChannelToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const getChannelStyle = (name: string): Pick<BookingChannelInfo, 'background' | 'color'> => {
  const style = KNOWN_ONLINE_CHANNEL_STYLES.find((channel) => channel.patterns.some((pattern) => pattern.test(name)));
  return style ? { background: style.background, color: style.color } : { background: '#455a64', color: '#fff' };
};

const buildChannelInfo = (name: string, abbreviation?: string): BookingChannelInfo => ({
  name,
  abbreviation: abbreviation?.trim() || toChannelAbbreviation(name),
  ...getChannelStyle(name),
});

const findConfiguredChannel = (sourceKey: string, haystack: string, parsedName: string) => {
  const configuredChannels = getHotelSettings().booking_channels.filter((channel) => channel.name.trim());
  const normalizedHaystack = normalizeChannelToken(haystack);
  const normalizedParsed = normalizeChannelToken(parsedName);

  const exactMatch = configuredChannels.find((channel) => {
    const normalizedName = normalizeChannelToken(channel.name);
    return normalizedName && (normalizedParsed === normalizedName || normalizedHaystack.includes(normalizedName));
  });
  if (exactMatch) return exactMatch;

  if (sourceKey.includes('website') || sourceKey.includes('web')) {
    return configuredChannels.find((channel) => /\b(web|website)\b/i.test(channel.name));
  }

  if (sourceKey.includes('ota')) {
    return configuredChannels.find((channel) => /\b(ota|online)\b/i.test(channel.name));
  }

  return undefined;
};

export const getBookingChannelInfo = (
  booking: ChannelSourceFields,
): BookingChannelInfo | null => {
  // The structured link wins outright when it is set. Everything below this
  // block infers the channel from free text, and that inference is
  // order-dependent: it returns the first configured channel whose name
  // appears anywhere in the remarks, so a stale "Booking.com" note outranked a
  // corrected "Traveloka" one. Bookings that carry the link are immune.
  const linkedName = String(booking.booking_channel_name || '').trim();
  if (linkedName) {
    const linkedType = String(booking.booking_channel_type || '').trim().toLowerCase();
    if (NON_ONLINE_CHANNEL_TYPES.has(linkedType)) return null;
    const configured = getHotelSettings().booking_channels.find(
      (channel) => normalizeChannelToken(channel.name) === normalizeChannelToken(linkedName),
    );
    return buildChannelInfo(linkedName, configured?.abbreviation);
  }

  const source = String(booking.source || '').trim();
  const sourceKey = source.toLowerCase();
  const remarks = [booking.booking_remarks, booking.remarks]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' | ');
  const haystack = `${source} ${remarks}`.trim();
  const firstRemark = remarks.split('|')[0]?.trim() || '';
  const parsedName = /-\s*Ref:|Reference:|\sBooking$/i.test(firstRemark) ? cleanChannelName(firstRemark) : '';
  const configuredChannel = findConfiguredChannel(sourceKey, haystack, parsedName);
  const styleMatch = KNOWN_ONLINE_CHANNEL_STYLES.find((channel) => channel.patterns.some((pattern) => pattern.test(parsedName || haystack)));
  const looksOnline = ['online', 'ota', 'website', 'web', 'channel_manager'].some((key) => sourceKey.includes(key)) || Boolean(configuredChannel || styleMatch);

  if (!looksOnline) {
    return null;
  }

  if (configuredChannel) {
    return buildChannelInfo(configuredChannel.name, configuredChannel.abbreviation);
  }

  if (parsedName) {
    return buildChannelInfo(parsedName);
  }
  const isWebsite = sourceKey.includes('website') || sourceKey.includes('web');
  return buildChannelInfo(
    translate(isWebsite ? 'channels.fallbackWebsite' : 'channels.fallbackOnline', undefined, 'bookings'),
    isWebsite ? 'WEB' : 'ONL',
  );
};

export const getBookedViaText = (
  booking: ChannelSourceFields,
  t: (key: string) => string,
) => {
  const channel = getBookingChannelInfo(booking);
  if (channel) {
    return `${channel.name} (${channel.abbreviation})`;
  }

  if (!booking.source) return t('details.direct');
  // Named sources get a localized label; unknown ones humanize like before.
  const key = `channels.${booking.source}`;
  const lastSegment = key.slice(key.lastIndexOf('.') + 1);
  const translated = t(key);
  return translated === lastSegment ? formatStatusLabel(booking.source) : translated;
};
