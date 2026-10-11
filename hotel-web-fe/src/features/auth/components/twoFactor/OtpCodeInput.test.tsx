import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OtpCodeInput from './OtpCodeInput';

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpCodeInput value={value} onChange={setValue} onComplete={onComplete} label="6-digit code" />
  );
}

describe('OtpCodeInput', () => {
  afterEach(cleanup);

  it('is one native one-time-code field drawn as six boxes', () => {
    render(<Harness onComplete={vi.fn()} />);

    const inputs = document.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    const field = screen.getByLabelText('6-digit code');
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('maxlength')).toBe('6');
    const cells = screen.getAllByTestId('otp-cell');
    expect(cells).toHaveLength(6);
    cells.forEach((cell) => expect(cell.getAttribute('aria-hidden')).toBe('true'));
  });

  it('keeps digits only and fills the boxes as they arrive', () => {
    render(<Harness onComplete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '4a2 ' } });

    expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('42');
    expect(screen.getAllByTestId('otp-cell').map((cell) => cell.textContent)).toEqual([
      '4',
      '2',
      '',
      '',
      '',
      '',
    ]);
  });

  it('completes once on a pasted code, not again on an unchanged value', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const field = screen.getByLabelText('6-digit code');

    fireEvent.change(field, { target: { value: '123 456' } });
    fireEvent.change(field, { target: { value: '1234567' } });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
