import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const RAW_MESSAGE = "Cannot read properties of undefined (reading 'booking')";

function Thrower(): never {
  throw new TypeError(RAW_MESSAGE);
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs every boundary-caught render error to console.error; the
    // fallback render is the behavior under test, not the log noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the generic detailMessage instead of the raw exception text', () => {
    render(
      <ErrorBoundary title="Guest Experience Error" detailMessage="We hit a problem loading this page.">
        <Thrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Guest Experience Error')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('We hit a problem loading this page.');
    expect(alert.textContent).not.toContain('Cannot read properties of undefined');
  });

  it('keeps showing the raw error message when detailMessage is not provided', () => {
    render(
      <ErrorBoundary title="Page Error">
        <Thrower />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(RAW_MESSAGE);
  });
});
