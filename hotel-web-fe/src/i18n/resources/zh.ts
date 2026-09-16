/**
 * 简体中文 translation bundles.
 *
 * Reached only through the dynamic `import('./zh')` in `./index.ts` — see the
 * note in `./ms.ts`.
 */

import type { LocaleResources, TranslationBundle } from '../translator';

import zhAdmin from './zh/admin.json';
import zhAuth from './zh/auth.json';
import zhBookings from './zh/bookings.json';
import zhChannels from './zh/channels.json';
import zhCommon from './zh/common.json';
import zhCommunications from './zh/communications.json';
import zhDashboard from './zh/dashboard.json';
import zhDataTransfer from './zh/dataTransfer.json';
import zhEkyc from './zh/ekyc.json';
import zhErrors from './zh/errors.json';
import zhFinance from './zh/finance.json';
import zhGuestPortal from './zh/guestPortal.json';
import zhGuests from './zh/guests.json';
import zhHelp from './zh/help.json';
import zhHousekeeping from './zh/housekeeping.json';
import zhInsights from './zh/insights.json';
import zhLoyalty from './zh/loyalty.json';
import zhLegal from './zh/legal.json';
import zhNav from './zh/nav.json';
import zhNotifications from './zh/notifications.json';
import zhOnlineInventory from './zh/onlineInventory.json';
import zhPromotions from './zh/promotions.json';
import zhNightAudit from './zh/nightAudit.json';
import zhRates from './zh/rates.json';
import zhRevenue from './zh/revenue.json';
import zhRooms from './zh/rooms.json';
import zhSegments from './zh/segments.json';
import zhStatus from './zh/status.json';
import zhSupport from './zh/support.json';
import zhValidation from './zh/validation.json';

export const zhResources = {
  admin: zhAdmin as TranslationBundle,
  auth: zhAuth as TranslationBundle,
  bookings: zhBookings as TranslationBundle,
  channels: zhChannels as TranslationBundle,
  common: zhCommon as TranslationBundle,
  communications: zhCommunications as TranslationBundle,
  dashboard: zhDashboard as TranslationBundle,
  dataTransfer: zhDataTransfer as TranslationBundle,
  ekyc: zhEkyc as TranslationBundle,
  errors: zhErrors as TranslationBundle,
  finance: zhFinance as TranslationBundle,
  guestPortal: zhGuestPortal as TranslationBundle,
  guests: zhGuests as TranslationBundle,
  help: zhHelp as TranslationBundle,
  housekeeping: zhHousekeeping as TranslationBundle,
  insights: zhInsights as TranslationBundle,
  loyalty: zhLoyalty as TranslationBundle,
  legal: zhLegal as TranslationBundle,
  nav: zhNav as TranslationBundle,
  notifications: zhNotifications as TranslationBundle,
  onlineInventory: zhOnlineInventory as TranslationBundle,
  promotions: zhPromotions as TranslationBundle,
  nightAudit: zhNightAudit as TranslationBundle,
  rates: zhRates as TranslationBundle,
  revenue: zhRevenue as TranslationBundle,
  rooms: zhRooms as TranslationBundle,
  segments: zhSegments as TranslationBundle,
  status: zhStatus as TranslationBundle,
  support: zhSupport as TranslationBundle,
  validation: zhValidation as TranslationBundle,
};

const resources: LocaleResources = zhResources;
export default resources;
