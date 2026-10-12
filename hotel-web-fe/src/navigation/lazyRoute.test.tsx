import { Suspense, type ComponentType } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documentLocation = vi.hoisted(() => ({ leaving: false }));

vi.mock('../utils/documentLocation', () => ({
  isLeavingDocument: () => documentLocation.leaving,
}));

import { lazyRoute } from './lazyRoute';

// Safari's wording when a navigation aborts an in-flight module load.
const abortedImport = () => Promise.reject(new TypeError('Importing a module script failed.'));

async function renderLazy(loader: () => Promise<{ default: ComponentType }>) {
  const Page = lazyRoute(loader);
  render(
    <Suspense fallback={<p>loading</p>}>
      <Page />
    </Suspense>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe('lazyRoute module-load failures', () => {
  // jsdom's location.reload is unforgeable, so observe the reload through the
  // once-per-page guard it writes to sessionStorage just before reloading.
  const reloadMarker = () => window.sessionStorage.getItem('hotelModuleReload');

  beforeEach(() => {
    documentLocation.leaving = false;
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('reloads once for a failed module load on a page that is staying', async () => {
    await renderLazy(abortedImport);

    expect(reloadMarker()).not.toBeNull();
    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('does not reload a page that is already being navigated away', async () => {
    // A reload here cancelled the sign-out's redirect to the landing page.
    documentLocation.leaving = true;

    await renderLazy(abortedImport);

    expect(reloadMarker()).toBeNull();
    expect(screen.getByText('loading')).toBeTruthy();
  });
});
