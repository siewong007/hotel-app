import { cleanup, render, screen } from '@testing-library/react';
import CssBaseline from '@mui/material/CssBaseline';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeModeContext } from '../../../router/ThemeModeContext';
import { guestLightTokens } from './guestTokens';
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

  it('publishes guest-mode vars on its wrapper so the island stays consistent', () => {
    render(
      <ThemeModeContext.Provider value={{ themeMode: 'light', onThemeModeChange: () => {} }}>
        <GuestPortalThemeProvider>
          <div data-testid="child">child</div>
        </GuestPortalThemeProvider>
      </ThemeModeContext.Provider>,
    );

    const wrapper = screen.getByTestId('child').parentElement as HTMLElement;
    expect(wrapper.style.getPropertyValue('--hotel-bg')).toBe(guestLightTokens.surfaces.app);
    expect(wrapper.style.getPropertyValue('--hotel-primary')).toBe(guestLightTokens.primary.main);
  });

  it('honours an explicit mode prop over the context', () => {
    render(
      <ThemeModeContext.Provider value={{ themeMode: 'light', onThemeModeChange: () => {} }}>
        <GuestPortalThemeProvider mode="dark">
          <div data-testid="child">child</div>
        </GuestPortalThemeProvider>
      </ThemeModeContext.Provider>,
    );

    const wrapper = screen.getByTestId('child').parentElement as HTMLElement;
    expect(wrapper.style.getPropertyValue('--hotel-bg')).toBe('#0B1814');
  });
});
