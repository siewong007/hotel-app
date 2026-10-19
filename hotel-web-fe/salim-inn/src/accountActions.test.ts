import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { updateAccountActions } from './accountActions';
import { ready } from './content';

describe('landing page account actions', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/salim-inn/index.html');
    const landing = new DOMParser().parseFromString(indexHtml, 'text/html');
    document.body.innerHTML = '';
    for (const selector of ['.top-actions', '#about-us', 'footer']) {
      document.body.append(landing.querySelector(selector)!.cloneNode(true));
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['guest', 'My account', '/guest-portal'],
    ['admin', 'Admin console', '/admin-portal'],
  ])('preserves the %s account action on About Us and a restored landing page', async (userType, label, href) => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'user' ? JSON.stringify({ user_type: userType }) : null,
    });
    await ready;
    updateAccountActions();

    const accountAction = document.getElementById('accountAction')!;
    expect(accountAction.textContent).toBe(label);
    expect(accountAction.getAttribute('href')).toBe(href);

    fireEvent.click(document.querySelector('footer a[href="#about-us"]')!);
    await waitFor(() => expect(window.location.hash).toBe('#about-us'));
    expect(accountAction.textContent).toBe(label);

    window.dispatchEvent(new Event('pageshow'));
    expect(accountAction.textContent).toBe(label);
    expect(accountAction.getAttribute('href')).toBe(href);
  });
});
