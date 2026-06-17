import type { BookingWithDetails } from '../../../types';
import { getHotelSettings } from '../../../utils/hotelSettings';

export type BookingChannelInfo = {
  name: string;
  abbreviation: string;
  background: string;
  color: string;
};

type BookingChannelStyle = Pick<BookingChannelInfo, 'background' | 'color'> & { patterns: RegExp[] };

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
  booking: Pick<BookingWithDetails, 'source' | 'remarks' | 'booking_remarks'>,
): BookingChannelInfo | null => {
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

  const fallbackName = parsedName || (sourceKey.includes('website') || sourceKey.includes('web') ? 'Website' : 'Online');
  return buildChannelInfo(fallbackName);
};

export const getBookedViaText = (
  booking: Pick<BookingWithDetails, 'source' | 'remarks' | 'booking_remarks'>,
) => {
  const channel = getBookingChannelInfo(booking);
  if (channel) {
    return `${channel.name} (${channel.abbreviation})`;
  }

  return booking.source?.replace(/_/g, ' ') || 'Direct';
};
