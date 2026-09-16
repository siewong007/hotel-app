/**
 * English translation bundles — the only locale in the main bundle.
 *
 * English is statically imported because it is the synchronous fallback:
 * `translate.ts` reads it for any key a lazily-loaded locale has not defined
 * yet, and `t()` is callable from module scope before any `await` has run.
 * Every other locale lives behind a dynamic import in `./index.ts`.
 */

import type { TranslationBundle } from '../translator';

import enAdmin from './en/admin.json';
import enAuth from './en/auth.json';
import enBookings from './en/bookings.json';
import enChannels from './en/channels.json';
import enCommon from './en/common.json';
import enCommunications from './en/communications.json';
import enDashboard from './en/dashboard.json';
import enDataTransfer from './en/dataTransfer.json';
import enEkyc from './en/ekyc.json';
import enErrors from './en/errors.json';
import enFinance from './en/finance.json';
import enGuestPortal from './en/guestPortal.json';
import enGuests from './en/guests.json';
import enHelp from './en/help.json';
import enHousekeeping from './en/housekeeping.json';
import enInsights from './en/insights.json';
import enLoyalty from './en/loyalty.json';
import enLegal from './en/legal.json';
import enNav from './en/nav.json';
import enNotifications from './en/notifications.json';
import enOnlineInventory from './en/onlineInventory.json';
import enPromotions from './en/promotions.json';
import enNightAudit from './en/nightAudit.json';
import enRates from './en/rates.json';
import enRevenue from './en/revenue.json';
import enRooms from './en/rooms.json';
import enSegments from './en/segments.json';
import enStatus from './en/status.json';
import enSupport from './en/support.json';
import enValidation from './en/validation.json';

export const enResources = {
  admin: enAdmin as TranslationBundle,
  auth: enAuth as TranslationBundle,
  bookings: enBookings as TranslationBundle,
  channels: enChannels as TranslationBundle,
  common: enCommon as TranslationBundle,
  communications: enCommunications as TranslationBundle,
  dashboard: enDashboard as TranslationBundle,
  dataTransfer: enDataTransfer as TranslationBundle,
  ekyc: enEkyc as TranslationBundle,
  errors: enErrors as TranslationBundle,
  finance: enFinance as TranslationBundle,
  guestPortal: enGuestPortal as TranslationBundle,
  guests: enGuests as TranslationBundle,
  help: enHelp as TranslationBundle,
  housekeeping: enHousekeeping as TranslationBundle,
  insights: enInsights as TranslationBundle,
  loyalty: enLoyalty as TranslationBundle,
  legal: enLegal as TranslationBundle,
  nav: enNav as TranslationBundle,
  notifications: enNotifications as TranslationBundle,
  onlineInventory: enOnlineInventory as TranslationBundle,
  promotions: enPromotions as TranslationBundle,
  nightAudit: enNightAudit as TranslationBundle,
  rates: enRates as TranslationBundle,
  revenue: enRevenue as TranslationBundle,
  rooms: enRooms as TranslationBundle,
  segments: enSegments as TranslationBundle,
  status: enStatus as TranslationBundle,
  support: enSupport as TranslationBundle,
  validation: enValidation as TranslationBundle,
};

/** Namespace names, derived from the English registration above. */
export type Namespace = keyof typeof enResources;
