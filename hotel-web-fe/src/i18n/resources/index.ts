/**
 * Registry of every translation bundle shipped with the app.
 *
 * Bundles are imported statically rather than discovered: the English bundles
 * are the source of the `TranslationKey` types, and this crate's recurring
 * failure mode is a file that nothing reads. `resources.test.ts` asserts that
 * every JSON file on disk appears here, so adding a namespace and forgetting
 * to register it fails a test instead of silently shipping English.
 *
 * Total payload is a few kilobytes, so both locales are in the main bundle and
 * switching languages needs no network round trip. If a feature ever needs a
 * large namespace, code-split that one namespace behind a dynamic import and
 * have the provider await it — the lookup path already tolerates a namespace
 * that is not yet present by falling back to English.
 */

import enAuth from './en/auth.json';
import enCommon from './en/common.json';
import enErrors from './en/errors.json';
import enGuestPortal from './en/guestPortal.json';
import enNav from './en/nav.json';
import msAuth from './ms/auth.json';
import msCommon from './ms/common.json';
import msErrors from './ms/errors.json';
import msGuestPortal from './ms/guestPortal.json';
import msNav from './ms/nav.json';

import type { LocaleCode } from '../locales';
import type { LocaleResources, TranslationBundle } from '../translator';

/** Namespace names, derived from the English registration below. */
export type Namespace = keyof typeof enResources;

const enResources = {
  auth: enAuth as TranslationBundle,
  common: enCommon as TranslationBundle,
  errors: enErrors as TranslationBundle,
  guestPortal: enGuestPortal as TranslationBundle,
  nav: enNav as TranslationBundle,
};

const msResources = {
  auth: msAuth as TranslationBundle,
  common: msCommon as TranslationBundle,
  errors: msErrors as TranslationBundle,
  guestPortal: msGuestPortal as TranslationBundle,
  nav: msNav as TranslationBundle,
};

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources: Record<LocaleCode, LocaleResources> = {
  en: enResources,
  ms: msResources,
};

export const NAMESPACES = Object.keys(enResources) as Namespace[];
