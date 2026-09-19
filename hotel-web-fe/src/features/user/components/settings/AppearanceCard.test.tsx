import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppearanceCard from './AppearanceCard';
import type { ThemeMode } from '../../../../theme';

function renderCard({
  themeMode = 'light' as ThemeMode,
  onThemeModeChange = vi.fn(),
  glassBlur = 10,
  onGlassBlurChange = vi.fn(),
} = {}) {
  render(
    <AppearanceCard
      themeMode={themeMode}
      onThemeModeChange={onThemeModeChange}
      glassBlur={glassBlur}
      onGlassBlurChange={onGlassBlurChange}
    />,
  );
  return { onThemeModeChange, onGlassBlurChange };
}

describe('AppearanceCard', () => {
  afterEach(cleanup);

  it('marks the active theme mode as pressed', () => {
    renderCard({ themeMode: 'dark' });

    // The toggle button exposes both an aria-label and visible text.
    const dark = screen.getAllByRole('button', { name: 'Dark mode' })[0];
    const light = screen.getAllByRole('button', { name: 'Light mode' })[0];
    expect(dark.getAttribute('aria-pressed')).toBe('true');
    expect(light.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onThemeModeChange with the picked mode', () => {
    const { onThemeModeChange } = renderCard({ themeMode: 'light' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Dark mode' })[0]);

    expect(onThemeModeChange).toHaveBeenCalledWith('dark');
  });

  it('ignores the null value the exclusive group emits on deselect', () => {
    const { onThemeModeChange } = renderCard({ themeMode: 'light' });

    // Clicking the already-selected button produces null in an exclusive
    // ToggleButtonGroup — the card must not forward it.
    fireEvent.click(screen.getAllByRole('button', { name: 'Light mode' })[0]);

    expect(onThemeModeChange).not.toHaveBeenCalled();
  });

  it('renders the blur slider at the current value', () => {
    renderCard({ glassBlur: 14 });

    const slider = screen.getByRole('slider', { name: 'Background blur' });
    expect(slider.getAttribute('aria-valuenow')).toBe('14');
  });

  it('calls onGlassBlurChange when the slider moves', () => {
    const { onGlassBlurChange } = renderCard({ glassBlur: 10 });

    fireEvent.change(screen.getByRole('slider', { name: 'Background blur' }), {
      target: { value: '4' },
    });

    expect(onGlassBlurChange).toHaveBeenCalledWith(4);
  });
});
