import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestThemePreferenceContext } from '../../theme/guestThemePreference';
import { AppearancePreferenceCard } from './AppearancePreferenceCard';

describe('AppearancePreferenceCard', () => {
  afterEach(cleanup);

  it('renders nothing without the guest theme preference context', () => {
    const { container } = render(<AppearancePreferenceCard />);
    expect(container.firstChild).toBeNull();
  });

  it('offers system, light, and dark and reports the choice', () => {
    const onPreferenceChange = vi.fn();
    render(
      <GuestThemePreferenceContext.Provider
        value={{ preference: 'system', onPreferenceChange }}
      >
        <AppearancePreferenceCard />
      </GuestThemePreferenceContext.Provider>,
    );

    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'System — follow browser' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onPreferenceChange).toHaveBeenCalledWith('light');
  });
});
