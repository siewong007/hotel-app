import { cleanup, render, screen } from '@testing-library/react';
import CssBaseline from '@mui/material/CssBaseline';
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

  it('publishes the shared scrollbar custom properties via CssBaseline', () => {
    render(
      <GuestPortalThemeProvider>
        <CssBaseline />
        <div>child</div>
      </GuestPortalThemeProvider>,
    );

    const styles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');

    expect(styles).toContain('--hotel-scrollbar-track');
    expect(styles).toContain('--hotel-scrollbar-thumb');
    expect(styles).toContain('--hotel-scrollbar-thumb-hover');
  });
});
