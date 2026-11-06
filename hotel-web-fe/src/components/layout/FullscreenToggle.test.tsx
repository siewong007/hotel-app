import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shouldUseDesktopRuntime = vi.hoisted(() => vi.fn(() => false));
const requestFullscreen = vi.hoisted(() => vi.fn(async () => undefined));
const exitFullscreen = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../desktop/runtimeApi', () => ({
  shouldUseDesktopRuntime: () => shouldUseDesktopRuntime(),
}));

import { FullscreenToggle } from './FullscreenToggle';

describe('FullscreenToggle', () => {
  beforeEach(() => {
    shouldUseDesktopRuntime.mockReturnValue(false);
    requestFullscreen.mockClear();
    exitFullscreen.mockClear();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the enter-fullscreen control in browser mode', () => {
    render(<FullscreenToggle />);
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeTruthy();
  });

  it('hides itself in the Tauri desktop runtime', () => {
    shouldUseDesktopRuntime.mockReturnValue(true);
    const { container } = render(<FullscreenToggle />);
    expect(container.firstChild).toBeNull();
  });

  it('hides itself when the Fullscreen API is unsupported', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: undefined,
    });
    const { container } = render(<FullscreenToggle />);
    expect(container.firstChild).toBeNull();
  });

  it('calls requestFullscreen and flips the label after fullscreenchange', async () => {
    render(<FullscreenToggle />);
    const button = screen.getByRole('button', { name: 'Enter full screen' });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: document.documentElement,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    const exitButton = screen.getByRole('button', { name: 'Exit full screen' });
    expect(exitButton.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(exitButton);
    });
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('stays in sync when Esc exits fullscreen without clicking the button', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: document.documentElement,
    });
    render(<FullscreenToggle />);
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();

    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeTruthy();
  });
});
