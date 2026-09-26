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

  it('phone: the bar is portalled out of the page so contain/transform ancestors cannot trap it', () => {
    mocks.isPhone = true;
    const { container } = render(
      <div style={{ contain: 'layout', transform: 'translateZ(0)' }}>
        <StickyActionBar primary={primary} />
      </div>,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check in' }).closest('body')).toBe(document.body);
  });

  it('desktop: the bar stays inline (position: static)', () => {
    const { container } = render(<StickyActionBar primary={primary} />);
    expect(getComputedStyle(rootBar(container)).position).toBe('static');
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
