/**
 * Registry of every translation bundle shipped with the app.
 *
 * Bundles are imported statically rather than discovered: the English bundles
 * are the source of the `TranslationKey` types, and this crate's recurring
 * failure mode is a file that nothing reads. `resources.test.ts` asserts that
 * every JSON file on disk appears here, so adding a namespace and forgetting
 * to register it fails a test instead of silently shipping English.
 *
 * Total payload is a few kilobytes, so all locales are in the main bundle and
 * switching languages needs no network round trip. If a feature ever needs a
 * large namespace, code-split that one namespace behind a dynamic import and
 * have the provider await it — the lookup path already tolerates a namespace
 * that is not yet present by falling back to English.
 */

import enAdmin from './en/admin.json';
import enAuth from './en/auth.json';
import enBookings from './en/bookings.json';
import enCommon from './en/common.json';
import enCommunications from './en/communications.json';
import enInsights from './en/insights.json';
import enDashboard from './en/dashboard.json';
import enDataTransfer from './en/dataTransfer.json';
import enEkyc from './en/ekyc.json';
import enErrors from './en/errors.json';
import enFinance from './en/finance.json';
import enGuestPortal from './en/guestPortal.json';
import enGuests from './en/guests.json';
import enHelp from './en/help.json';
import enHousekeeping from './en/housekeeping.json';
import enLoyalty from './en/loyalty.json';
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
import msAdmin from './ms/admin.json';
import msAuth from './ms/auth.json';
import msBookings from './ms/bookings.json';
import msCommon from './ms/common.json';
import msCommunications from './ms/communications.json';
import msInsights from './ms/insights.json';
import msDashboard from './ms/dashboard.json';
import msDataTransfer from './ms/dataTransfer.json';
import msEkyc from './ms/ekyc.json';
import msErrors from './ms/errors.json';
import msFinance from './ms/finance.json';
import msGuestPortal from './ms/guestPortal.json';
import msGuests from './ms/guests.json';
import msHelp from './ms/help.json';
import msHousekeeping from './ms/housekeeping.json';
import msLoyalty from './ms/loyalty.json';
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
import zhAdmin from './zh/admin.json';
import zhAuth from './zh/auth.json';
import zhBookings from './zh/bookings.json';
import zhCommon from './zh/common.json';
import zhCommunications from './zh/communications.json';
import zhInsights from './zh/insights.json';
import zhDashboard from './zh/dashboard.json';
import zhDataTransfer from './zh/dataTransfer.json';
import zhEkyc from './zh/ekyc.json';
import zhErrors from './zh/errors.json';
import zhFinance from './zh/finance.json';
import zhGuestPortal from './zh/guestPortal.json';
import zhGuests from './zh/guests.json';
import zhHelp from './zh/help.json';
import zhHousekeeping from './zh/housekeeping.json';
import zhLoyalty from './zh/loyalty.json';
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

import type { LocaleCode } from '../locales';
import type { LocaleResources, TranslationBundle } from '../translator';

/** Namespace names, derived from the English registration below. */
export type Namespace = keyof typeof enResources;

const enResources = {
  admin: enAdmin as TranslationBundle,
  auth: enAuth as TranslationBundle,
  bookings: enBookings as TranslationBundle,
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

const msResources = {
  admin: msAdmin as TranslationBundle,
  auth: msAuth as TranslationBundle,
  bookings: msBookings as TranslationBundle,
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

const zhResources = {
  admin: zhAdmin as TranslationBundle,
  auth: zhAuth as TranslationBundle,
  bookings: zhBookings as TranslationBundle,
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

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources: Record<LocaleCode, LocaleResources> = {
  en: enResources,
  ms: msResources,
  zh: zhResources,
};

export const NAMESPACES = Object.keys(enResources) as Namespace[];
