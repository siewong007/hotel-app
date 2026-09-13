import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toHotelDateString, toHotelInstantIso } from '../../../utils/date';
import InteractionForm, {
  emptyInteractionDraft,
  followUpDateToISO,
} from './InteractionForm';

const createLocalStorageStub = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const setHotelTimeZone = (timeZone: string) => {
  localStorage.setItem('hotelSettings', JSON.stringify({ timezone: timeZone }));
};

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageStub());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * `guest_notes.follow_up_at` is a timestamptz fed by a hotel-local date
 * picker. The stored instant must land on the picked calendar date no matter
 * which timezone the hotel (or the viewer's browser) is in — the round-trip
 * through `toHotelDateString` is the contract the backend display relies on.
 */
describe('followUpDateToISO / toHotelInstantIso round-trip', () => {
  it.each([
    // Default deploy tz (+08): noon hotel-local is 04:00Z same day.
    'Asia/Kuala_Lumpur',
    // Behind UTC: noon hotel-local is later the same UTC day (16:00Z in EDT).
    'America/New_York',
    // UTC+14 — the extreme that breaks a naive "noon UTC" anchor: noon
    // hotel-local is 22:00Z the PREVIOUS day.
    'Pacific/Kiritimati',
    // West of Greenwich where a "midnight UTC" anchor rolls a day back.
    'America/Los_Angeles',
  ])('keeps the picked hotel date under %s', (timeZone) => {
    setHotelTimeZone(timeZone);

    const iso = followUpDateToISO('2026-09-20');

    expect(toHotelDateString(iso)).toBe('2026-09-20');
  });

  it('anchors at noon hotel-local exactly (not midnight, not noon UTC)', () => {
    setHotelTimeZone('Asia/Kuala_Lumpur');
    // 12:00 +08 == 04:00Z.
    expect(toHotelInstantIso('2026-09-20', 12, 0)).toBe('2026-09-20T04:00:00.000Z');
    expect(followUpDateToISO('2026-09-20')).toBe('2026-09-20T04:00:00.000Z');
  });

  it('falls back to a noon-UTC literal when the picker value is unparseable', () => {
    setHotelTimeZone('Asia/Kuala_Lumpur');
    expect(followUpDateToISO('not-a-date')).toBe('not-a-dateT12:00:00Z');
  });
});

describe('InteractionForm', () => {
  const renderForm = (overrides: Partial<React.ComponentProps<typeof InteractionForm>> = {}) => {
    const props: React.ComponentProps<typeof InteractionForm> = {
      mode: 'create',
      initial: emptyInteractionDraft(),
      canAssign: false,
      submitting: false,
      submitLabel: 'Add note',
      onSubmit: vi.fn(),
      ...overrides,
    };
    render(<InteractionForm {...props} />);
    return props;
  };

  it('keeps submit disabled until content is entered, then submits a trimmed draft', () => {
    const props = renderForm();
    const submit = screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Note content/), {
      target: { value: '  Guest prefers late checkout  ' },
    });
    fireEvent.change(screen.getByLabelText(/Subject/), {
      target: { value: '  Arrival call  ' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Arrival call',
        content: 'Guest prefers late checkout',
        interaction_type: 'note',
        booking_id: null,
        is_alert: false,
        is_private: false,
        follow_up_at: '',
        assigned_to: null,
      }),
    );
  });

  it('hides the assignee picker without support:assign (canAssign=false)', () => {
    renderForm({ canAssign: false, agents: [{ id: 5, name: 'Agent A' }] });
    expect(screen.queryByLabelText(/Assignee/)).toBeNull();
  });

  it('shows the assignee picker when canAssign is set', () => {
    renderForm({ canAssign: true, agents: [{ id: 5, name: 'Agent A' }] });
    expect(screen.getByLabelText(/Assignee/)).toBeTruthy();
  });

  it('omits the booking select in edit mode and surfaces the api error', () => {
    renderForm({ mode: 'edit', error: 'Save failed' });
    expect(screen.queryByLabelText(/Related booking/)).toBeNull();
    expect(screen.getByText('Save failed')).toBeTruthy();
  });
});
