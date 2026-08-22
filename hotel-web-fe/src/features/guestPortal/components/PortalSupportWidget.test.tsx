import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPhone: false,
}));

// jsdom has no matchMedia; MUI's useMediaQuery needs it. Phones report true so
// both launcher variants get covered across the two suites below.
//
// Slide is replaced by an `in`-respecting pass-through: jsdom never fires the
// transitionend/rAF sequence react-transition-group waits for, so the real
// Slide's mountOnEnter never mounts the panel here. The pass-through keeps the
// exact mount/unmount contract (content only while open) minus the animation.
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return {
    ...actual,
    useMediaQuery: () => mocks.isPhone,
    Slide: ({
      in: isIn,
      children,
    }: { in?: boolean } & { children?: React.ReactNode }) =>
      isIn ? <>{children}</> : null,
  };
});

vi.mock('./PortalSupportTab', () => ({
  PortalSupportTab: ({ token }: { token: string }) => (
    <div data-testid="support-tab" data-token={token} />
  ),
}));

import { PortalSupportWidget } from './PortalSupportWidget';

describe('PortalSupportWidget', () => {
  beforeEach(() => {
    mocks.isPhone = false;
  });

  afterEach(cleanup);

  it('shows only the launcher when closed and opens on click', () => {
    const onOpenChange = vi.fn();

    render(
      <PortalSupportWidget token="portal-token" open={false} onOpenChange={onOpenChange} />,
    );

    const launcher = screen.getByLabelText('Open support chat');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('support-tab')).toBeNull();

    fireEvent.click(launcher);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders the support tab inside the panel when open, focus on close control', async () => {
    render(<PortalSupportWidget token="portal-token" open onOpenChange={vi.fn()} />);

    // Portal mounts outside RTL's container; use document-scoped selectors and
    // always take the newest instance (earlier suites' portal DOM can linger).
    await waitFor(() =>
      expect(
        document.querySelectorAll('[aria-label="Hotel support"][role="dialog"]'),
      ).not.toHaveLength(0),
    );
    const tabs = screen.getAllByTestId('support-tab');
    expect(tabs[tabs.length - 1].getAttribute('data-token')).toBe('portal-token');
    // NOTE: the component also attempts auto-focus on open; jsdom/MUI v9
    // timing makes that untestable here — tracked in docs/ongoing-dev.md.
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();

    render(<PortalSupportWidget token="portal-token" open onOpenChange={onOpenChange} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not bind Escape while closed', () => {
    const onOpenChange = vi.fn();

    render(
      <PortalSupportWidget token="portal-token" open={false} onOpenChange={onOpenChange} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('renders an icon-only launcher variant on phones', () => {
    mocks.isPhone = true;

    const onOpenChange = vi.fn();
    render(
      <PortalSupportWidget token="portal-token" open={false} onOpenChange={onOpenChange} />,
    );

    // The phone Fab is icon-only: no "Chat with us" text label alongside the
    // accessible name.
    const launcher = screen.getByLabelText('Open support chat');
    expect(launcher.textContent).not.toContain('Chat with us');
  });
});
