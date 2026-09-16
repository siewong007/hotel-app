/**
 * Bahasa Melayu translation bundles.
 *
 * Reached only through the dynamic `import('./ms')` in `./index.ts`, so these
 * ~440 KB of JSON become their own chunk and are never downloaded by a user
 * reading the app in another language. The static imports inside this module
 * are what keep it to ONE chunk rather than 30.
 */

import type { LocaleResources, TranslationBundle } from '../translator';

import msAdmin from './ms/admin.json';
import msAuth from './ms/auth.json';
import msBookings from './ms/bookings.json';
import msChannels from './ms/channels.json';
import msCommon from './ms/common.json';
import msCommunications from './ms/communications.json';
import msDashboard from './ms/dashboard.json';
import msDataTransfer from './ms/dataTransfer.json';
import msEkyc from './ms/ekyc.json';
import msErrors from './ms/errors.json';
import msFinance from './ms/finance.json';
import msGuestPortal from './ms/guestPortal.json';
import msGuests from './ms/guests.json';
import msHelp from './ms/help.json';
import msHousekeeping from './ms/housekeeping.json';
import msInsights from './ms/insights.json';
import msLoyalty from './ms/loyalty.json';
import msLegal from './ms/legal.json';
import msNav from './ms/nav.json';
import msNotifications from './ms/notifications.json';
import msOnlineInventory from './ms/onlineInventory.json';
import msPromotions from './ms/promotions.json';
import msNightAudit from './ms/nightAudit.json';
import msRates from './ms/rates.json';
import msRevenue from './ms/revenue.json';
import msRooms from './ms/rooms.json';
import msSegments from './ms/segments.json';
import msStatus from './ms/status.json';
import msSupport from './ms/support.json';
import msValidation from './ms/validation.json';

export const msResources = {
  admin: msAdmin as TranslationBundle,
  auth: msAuth as TranslationBundle,
  bookings: msBookings as TranslationBundle,
  channels: msChannels as TranslationBundle,
  common: msCommon as TranslationBundle,
  communications: msCommunications as TranslationBundle,
  dashboard: msDashboard as TranslationBundle,
  dataTransfer: msDataTransfer as TranslationBundle,
  ekyc: msEkyc as TranslationBundle,
  errors: msErrors as TranslationBundle,
  finance: msFinance as TranslationBundle,
  guestPortal: msGuestPortal as TranslationBundle,
  guests: msGuests as TranslationBundle,
  help: msHelp as TranslationBundle,
  housekeeping: msHousekeeping as TranslationBundle,
  insights: msInsights as TranslationBundle,
  loyalty: msLoyalty as TranslationBundle,
  legal: msLegal as TranslationBundle,
  nav: msNav as TranslationBundle,
  notifications: msNotifications as TranslationBundle,
  onlineInventory: msOnlineInventory as TranslationBundle,
  promotions: msPromotions as TranslationBundle,
  nightAudit: msNightAudit as TranslationBundle,
  rates: msRates as TranslationBundle,
  revenue: msRevenue as TranslationBundle,
  rooms: msRooms as TranslationBundle,
  segments: msSegments as TranslationBundle,
  status: msStatus as TranslationBundle,
  support: msSupport as TranslationBundle,
  validation: msValidation as TranslationBundle,
};

const resources: LocaleResources = msResources;
export default resources;
