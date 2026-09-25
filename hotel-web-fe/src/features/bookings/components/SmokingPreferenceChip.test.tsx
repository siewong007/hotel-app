import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SmokingPreferenceChip, isSmokingPreferenceMismatch } from './SmokingPreferenceChip';

describe('isSmokingPreferenceMismatch', () => {
  it('flags only a known room that is the opposite of the preference', () => {
    expect(isSmokingPreferenceMismatch('non_smoking', true)).toBe(true);
    expect(isSmokingPreferenceMismatch('smoking', false)).toBe(true);
    expect(isSmokingPreferenceMismatch('non_smoking', false)).toBe(false);
    expect(isSmokingPreferenceMismatch('smoking', true)).toBe(false);
    // No preference, or no room assigned yet, is never a mismatch.
    expect(isSmokingPreferenceMismatch(null, true)).toBe(false);
    expect(isSmokingPreferenceMismatch(undefined, false)).toBe(false);
    expect(isSmokingPreferenceMismatch('smoking', null)).toBe(false);
  });
});

describe('SmokingPreferenceChip', () => {
  afterEach(() => cleanup());

  it('renders nothing when the guest has no preference', () => {
    render(<SmokingPreferenceChip preference={null} roomIsSmoking />);
    expect(screen.queryByTestId('smoking-preference-chip')).toBeNull();
  });

  it('warns when a non-smoking guest is in a smoking room', () => {
    render(<SmokingPreferenceChip preference="non_smoking" roomIsSmoking />);
    const chip = screen.getByTestId('smoking-preference-chip');
    expect(chip.textContent).toContain('Wants non-smoking');
    expect(chip.getAttribute('data-mismatch')).toBe('true');
    expect(chip.getAttribute('aria-label')).toContain('marked as a smoking room');
  });

  it('shows a plain chip when the room matches', () => {
    render(<SmokingPreferenceChip preference="non_smoking" roomIsSmoking={false} />);
    const chip = screen.getByTestId('smoking-preference-chip');
    expect(chip.getAttribute('data-mismatch')).toBe('false');
    expect(chip.getAttribute('aria-label')).toBe('Wants non-smoking');
  });
});
