import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { StickyActionBar } from './StickyActionBar';

const primary = <button type="button">Check in</button>;

const rootBar = (container: HTMLElement): HTMLElement =>
  container.firstElementChild as HTMLElement;

describe('StickyActionBar', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('renders primary, secondary and summary', () => {
    render(
      <StickyActionBar
        summary="Total: $120"
        secondary={<button type="button">Back</button>}
        primary={primary}
      />,
    );
    expect(screen.getByText('Total: $120')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('phone: the bar carries position: fixed (pinned above the bottom nav)', () => {
    mocks.isPhone = true;
    render(<StickyActionBar primary={primary} />);
    const bar = screen.getByRole('button', { name: 'Check in' }).parentElement as HTMLElement;
    expect(getComputedStyle(bar).position).toBe('fixed');
  });

  it('phone: the bar renders in place (no portal) and stays position: fixed', () => {
    mocks.isPhone = true;
    const { container } = render(
      <div>
        <StickyActionBar primary={primary} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Check in' });
    expect(container.contains(button)).toBe(true);
    expect(getComputedStyle(button.parentElement as HTMLElement).position).toBe('fixed');
    // Flags itself so the Quick actions FAB steps out of its corner.
    expect((button.parentElement as HTMLElement).hasAttribute('data-mobile-action-bar')).toBe(true);
  });

  it('desktop: the bar stays inline (position: static)', () => {
    const { container } = render(<StickyActionBar primary={primary} />);
    expect(getComputedStyle(rootBar(container)).position).toBe('static');
    expect(rootBar(container).hasAttribute('data-mobile-action-bar')).toBe(false);
  });

  it('overflowActions renders a "More actions" trigger', () => {
    render(
      <StickyActionBar
        primary={primary}
        overflowActions={[{ id: 'audit', label: 'Audit', onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });
});
