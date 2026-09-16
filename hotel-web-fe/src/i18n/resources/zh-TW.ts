/**
 * 繁體中文 translation bundles.
 *
 * Reached only through the dynamic `import('./zh-TW')` in `./index.ts` — see
 * the note in `./ms.ts`.
 */

import type { LocaleResources, TranslationBundle } from '../translator';

import zhTwAdmin from './zh-TW/admin.json';
import zhTwAuth from './zh-TW/auth.json';
import zhTwBookings from './zh-TW/bookings.json';
import zhTwChannels from './zh-TW/channels.json';
import zhTwCommon from './zh-TW/common.json';
import zhTwCommunications from './zh-TW/communications.json';
import zhTwDashboard from './zh-TW/dashboard.json';
import zhTwDataTransfer from './zh-TW/dataTransfer.json';
import zhTwEkyc from './zh-TW/ekyc.json';
import zhTwErrors from './zh-TW/errors.json';
import zhTwFinance from './zh-TW/finance.json';
import zhTwGuestPortal from './zh-TW/guestPortal.json';
import zhTwGuests from './zh-TW/guests.json';
import zhTwHelp from './zh-TW/help.json';
import zhTwHousekeeping from './zh-TW/housekeeping.json';
import zhTwInsights from './zh-TW/insights.json';
import zhTwLoyalty from './zh-TW/loyalty.json';
import zhTwLegal from './zh-TW/legal.json';
import zhTwNav from './zh-TW/nav.json';
import zhTwNotifications from './zh-TW/notifications.json';
import zhTwOnlineInventory from './zh-TW/onlineInventory.json';
import zhTwPromotions from './zh-TW/promotions.json';
import zhTwNightAudit from './zh-TW/nightAudit.json';
import zhTwRates from './zh-TW/rates.json';
import zhTwRevenue from './zh-TW/revenue.json';
import zhTwRooms from './zh-TW/rooms.json';
import zhTwSegments from './zh-TW/segments.json';
import zhTwStatus from './zh-TW/status.json';
import zhTwSupport from './zh-TW/support.json';
import zhTwValidation from './zh-TW/validation.json';

export const zhTwResources = {
  admin: zhTwAdmin as TranslationBundle,
  auth: zhTwAuth as TranslationBundle,
  bookings: zhTwBookings as TranslationBundle,
  channels: zhTwChannels as TranslationBundle,
  common: zhTwCommon as TranslationBundle,
  communications: zhTwCommunications as TranslationBundle,
  dashboard: zhTwDashboard as TranslationBundle,
  dataTransfer: zhTwDataTransfer as TranslationBundle,
  ekyc: zhTwEkyc as TranslationBundle,
  errors: zhTwErrors as TranslationBundle,
  finance: zhTwFinance as TranslationBundle,
  guestPortal: zhTwGuestPortal as TranslationBundle,
  guests: zhTwGuests as TranslationBundle,
  help: zhTwHelp as TranslationBundle,
  housekeeping: zhTwHousekeeping as TranslationBundle,
  insights: zhTwInsights as TranslationBundle,
  loyalty: zhTwLoyalty as TranslationBundle,
  legal: zhTwLegal as TranslationBundle,
  nav: zhTwNav as TranslationBundle,
  notifications: zhTwNotifications as TranslationBundle,
  onlineInventory: zhTwOnlineInventory as TranslationBundle,
  promotions: zhTwPromotions as TranslationBundle,
  nightAudit: zhTwNightAudit as TranslationBundle,
  rates: zhTwRates as TranslationBundle,
  revenue: zhTwRevenue as TranslationBundle,
  rooms: zhTwRooms as TranslationBundle,
  segments: zhTwSegments as TranslationBundle,
  status: zhTwStatus as TranslationBundle,
  support: zhTwSupport as TranslationBundle,
  validation: zhTwValidation as TranslationBundle,
};

const resources: LocaleResources = zhTwResources;
export default resources;
