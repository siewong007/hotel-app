import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveLocale, setActiveLocale } from '../../i18n/localeStore';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../../router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('./CommandPalette', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));

vi.mock('./NotificationCenter', () => ({
  NotificationCenter: () => <button type="button" aria-label="Notifications" />,
}));

vi.mock('./UserMenu', () => ({
  UserMenu: () => <button type="button" aria-label="Account" />,
}));

vi.mock('./Breadcrumbs', () => ({
  Breadcrumbs: () => <nav aria-label="Breadcrumb" />,
  CurrentPageTitle: () => <h1>Overview</h1>,
}));

import { AppTopbar } from './AppTopbar';

describe('AppTopbar language control', () => {
  afterEach(() => {
    act(() => setActiveLocale('en'));
    cleanup();
  });

  it('renders the language globe on a 360px phone bar', () => {
    render(<AppTopbar />);
    const button = screen.getByRole('button', { name: 'Current language: English' });
    // jsdom evaluates no media queries, so resolve the emotion rules by hand
    // for a 360px viewport: top-level rules plus `@media` blocks whose
    // min/max-width bounds include 360 (MUI emits `xs` as min-width:0px).
    // The globe used to sit in a wrapper that was `display: none` at xs and
    // lived in the More sheet; no ancestor up to the header may hide it now.
    const PHONE = 360;
    const appliesAt = (media: string) => {
      const min = /min-width:\s*([\d.]+)px/.exec(media);
      const max = /max-width:\s*([\d.]+)px/.exec(media);
      return (!min || Number(min[1]) <= PHONE) && (!max || Number(max[1]) >= PHONE);
    };
    const displaysAtPhone = (el: Element): string[] => {
      const out: string[] = [];
      const visit = (rules: CSSRuleList, active: boolean) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule) {
            visit(rule.cssRules, active && appliesAt(rule.conditionText ?? rule.media.mediaText));
          } else if (active && rule instanceof CSSStyleRule && rule.style.display) {
            if (Array.from(el.classList).some((cls) => rule.selectorText === `.${cls}`)) {
              out.push(rule.style.display);
            }
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules, true);
      return out;
    };
    let node: HTMLElement | null = button;
    while (node && node.tagName !== 'HEADER') {
      expect(displaysAtPhone(node)).not.toContain('none');
      node = node.parentElement;
    }
    expect(node?.tagName).toBe('HEADER');
  });

  it('opens the four-language menu and switches locale through setLocale', async () => {
    render(<AppTopbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Current language: English' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'English',
      'Bahasa Melayu',
      '简体中文',
      '繁體中文',
    ]);
    expect(within(items[0]).getByTestId('CheckIcon')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bahasa Melayu' }));
    });
    expect(getActiveLocale()).toBe('ms');
  });

  it('keeps the one-tap sign-out icon beside the avatar', () => {
    render(<AppTopbar />);
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });
});
