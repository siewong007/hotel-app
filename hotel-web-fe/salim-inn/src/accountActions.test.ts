import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { initialsOf, refreshAccountActions, resolveAccount, updateAccountActions } from './accountActions';
import { ready } from './content';

const hint = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('landing page account actions', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/salim-inn/index.html');
    window.sessionStorage.clear();
    const landing = new DOMParser().parseFromString(indexHtml, 'text/html');
    document.body.innerHTML = '';
    for (const selector of ['.top-actions', '#about-us', 'footer']) {
      document.body.append(landing.querySelector(selector)!.cloneNode(true));
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  const pill = () => document.getElementById('accountAction') as HTMLAnchorElement;

  it('ships the account pill pending so a signed-in visitor never sees "Sign in" flash', () => {
    expect(pill().hasAttribute('data-pending')).toBe(true);
  });

  it('asks the session hint with the cookie and never rotates the refresh token', async () => {
    const fetchMock = hint({ signed_in: false });
    vi.stubGlobal('fetch', fetchMock);
    await resolveAccount();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('/api/auth/session-hint');
    expect(calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(calls.some(([url]) => String(url).includes('auth/refresh'))).toBe(false);
  });

  it('shows the staff account control with initials, linking to the dashboard', async () => {
    vi.stubGlobal('fetch', hint({ signed_in: true, account: 'staff', display_name: 'System Administrator' }));
    await refreshAccountActions();
    expect(pill().getAttribute('href')).toBe('/admin-portal');
    expect(pill().textContent).toBe('SAAdmin console');
    expect(pill().querySelector('.account-initials')?.textContent).toBe('SA');
    expect(pill().getAttribute('aria-label')).toBe('Admin console — Signed in as System Administrator');
    expect(pill().hasAttribute('data-pending')).toBe(false);
    expect(document.getElementById('bookingAction')!.hidden).toBe(true);
  });

  it('shows a guest account control linking to the guest portal', async () => {
    vi.stubGlobal('fetch', hint({ signed_in: true, account: 'guest', display_name: 'Aminah Yusof' }));
    await refreshAccountActions();
    expect(pill().getAttribute('href')).toBe('/guest-portal');
    expect(pill().textContent).toBe('AYMy account');
    expect(document.getElementById('bookingAction')!.hidden).toBe(false);
  });

  it('honours a guest-portal session in this tab when there is no staff cookie', async () => {
    vi.stubGlobal('fetch', hint({ signed_in: false }));
    window.sessionStorage.setItem('guestPortalToken', 'x');
    window.sessionStorage.setItem('guestPortalTokenExpiresAt', new Date(Date.now() + 60_000).toISOString());
    expect(await resolveAccount()).toEqual({ kind: 'guest' });
    window.sessionStorage.setItem('guestPortalTokenExpiresAt', new Date(Date.now() - 1).toISOString());
    expect(await resolveAccount()).toBeNull();
  });

  it('falls back to Sign in when the hint fails or the network is down', async () => {
    vi.stubGlobal('fetch', hint({}, false));
    await refreshAccountActions();
    expect(pill().textContent).toBe('Sign in');
    expect(pill().getAttribute('href')).toBe('/login');
    expect(pill().hasAttribute('data-pending')).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await refreshAccountActions();
    expect(pill().textContent).toBe('Sign in');
  });

  it.each([
    ['guest', 'My account', '/guest-portal'],
    ['admin', 'Admin console', '/admin-portal'],
  ])('preserves the %s handoff action on About Us and a restored landing page', async (account, label, href) => {
    const fetchMock = hint({ signed_in: false });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', `/salim-inn/index.html?account=${account}`);
    await ready;
    await refreshAccountActions();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pill().textContent).toBe(label);
    expect(pill().getAttribute('href')).toBe(href);

    fireEvent.click(document.querySelector('footer a[href="#about-us"]')!);
    await waitFor(() => expect(window.location.hash).toBe('#about-us'));
    expect(pill().textContent).toBe(label);

    window.dispatchEvent(new Event('pageshow'));
    updateAccountActions();
    expect(pill().getAttribute('href')).toBe(href);
  });

  it('derives initials', () => {
    expect(initialsOf('Siew Wong')).toBe('SW');
    expect(initialsOf('admin')).toBe('A');
    expect(initialsOf('  Mary Ann  Lee ')).toBe('ML');
  });
});
