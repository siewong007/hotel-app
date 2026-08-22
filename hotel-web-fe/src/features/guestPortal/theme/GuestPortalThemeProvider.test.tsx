import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuestPortalThemeProvider } from './GuestPortalThemeProvider';

describe('GuestPortalThemeProvider', () => {
  afterEach(cleanup);

  it('renders children', () => {
    render(
      <GuestPortalThemeProvider>
        <p>themed content</p>
      </GuestPortalThemeProvider>,
    );

    expect(screen.getByText('themed content')).toBeTruthy();
  });

  it('injects the portal scrollbar custom properties once', () => {
    render(
      <GuestPortalThemeProvider>
        <div>child</div>
      </GuestPortalThemeProvider>,
    );

    const style = document.head.querySelector('[data-emotion], style');
    const styles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');

    expect(styles).toContain('--hotel-scrollbar-track');
    expect(styles).toContain('--hotel-scrollbar-thumb');
    expect(styles).toContain('--hotel-scrollbar-thumb-hover');
    void style;
  });
});
