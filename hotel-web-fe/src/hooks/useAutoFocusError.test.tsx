import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAutoFocusError } from './useAutoFocusError';

function Harness() {
  const [error, setError] = useState<string | null>(null);
  const alertRef = useAutoFocusError(error);
  return (
    <div>
      <button type="button" onClick={() => setError('Something went wrong')}>
        fail
      </button>
      <button type="button" onClick={() => setError(null)}>
        clear
      </button>
      {error && (
        <div ref={alertRef} tabIndex={-1} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

afterEach(cleanup);

describe('useAutoFocusError', () => {
  it('focuses the alert element when an error appears', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'fail' }));

    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(alert);
  });

  it('does not steal focus while there is no error', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('releases focus cleanly when the error clears', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(alert);

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).not.toBe(alert);
  });
});
