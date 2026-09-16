import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ hotel_name: 'Test Hotel' }),
}));

import LogoLoader from './LogoLoader';

describe('LogoLoader', () => {
  afterEach(cleanup);

  it('exposes a polite status with a sr-only default label', () => {
    render(<LogoLoader variant="page" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading');
  });

  it('renders a visible label as the status content', () => {
    render(<LogoLoader variant="inline" label="Saving booking" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saving booking');
    // A visible label replaces — not duplicates — the sr-only text.
    expect(status.textContent).not.toContain('Loading');
  });

  it('fullScreen shows the configured hotel name', () => {
    render(<LogoLoader variant="fullScreen" />);
    expect(screen.getByText('Test Hotel')).toBeTruthy();
  });

  it('keeps the brand mark decorative', () => {
    const { container } = render(<LogoLoader variant="page" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the entrance delay as an inline animation-delay', () => {
    render(<LogoLoader variant="page" delayMs={350} />);
    const status = screen.getByRole('status');
    expect(status.style.animationDelay).toBe('350ms');
  });

  it('fullScreen defaults to no entrance delay', () => {
    render(<LogoLoader variant="fullScreen" />);
    expect(screen.getByRole('status').style.animationDelay ?? '').not.toBe('200ms');
  });
});
