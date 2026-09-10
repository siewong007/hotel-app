/**
 * A stand-in for the Google Identity Services SDK, for tests.
 *
 * Hand-rolling the global in each test file went stale the moment `prompt` and
 * `cancel` were added for One Tap: vitest transpiles without type information,
 * so every one of those object literals kept passing its tests while `tsc`
 * failed on the missing members. One typed factory means the next member added
 * to the SDK shim is added once.
 */

import { vi } from 'vitest';

type GoogleAccountsId = NonNullable<Window['google']>['accounts']['id'];

/** The config object the component under test passes to `initialize`. */
export type GoogleInitializeConfig = Parameters<GoogleAccountsId['initialize']>[0];

export interface GoogleIdentityStubOptions {
  /** Replaces the default no-op, e.g. with a stub that throws. */
  disableAutoSelect?: () => void;
}

export function installGoogleIdentityStub(options: GoogleIdentityStubOptions = {}) {
  const initialize = vi.fn();
  const renderButton = vi.fn();
  const prompt = vi.fn();
  const cancel = vi.fn();
  const disableAutoSelect = vi.fn(options.disableAutoSelect);

  window.google = {
    accounts: { id: { initialize, renderButton, prompt, cancel, disableAutoSelect } },
  } as unknown as Window['google'];

  return { initialize, renderButton, prompt, cancel, disableAutoSelect };
}

/** The first config `initialize` was called with, typed. */
export function googleInitializeConfig(initialize: {
  mock: { calls: unknown[][] };
}): GoogleInitializeConfig {
  return initialize.mock.calls[0][0] as GoogleInitializeConfig;
}
