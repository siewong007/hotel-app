import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SupportWorkflowCard, { type SupportPriority } from './SupportWorkflowCard';

const mocks = vi.hoisted(() => ({
  values: {
    guestBookingCancellationEnabled: false,
    supportEnabled: true,
    supportCategories: ['booking', 'stay'] as string[],
    supportFirstResponseMinutes: {
      low: 240,
      normal: 60,
      high: 15,
      urgent: 5,
    } as Record<SupportPriority, number>,
    supportResolutionMinutes: {
      low: 1440,
      normal: 480,
      high: 120,
      urgent: 30,
    } as Record<SupportPriority, number>,
    supportReopenWindowDays: 7,
  },
}));

const apply = <T,>(current: T, next: T | ((prev: T) => T)): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(current) : next;

function renderCard({ isAdmin = true }: { isAdmin?: boolean } = {}) {
  render(
    <SupportWorkflowCard
      isAdmin={isAdmin}
      guestBookingCancellationEnabled={mocks.values.guestBookingCancellationEnabled}
      onGuestBookingCancellationEnabledChange={(v) => {
        mocks.values.guestBookingCancellationEnabled = apply(
          mocks.values.guestBookingCancellationEnabled,
          v,
        );
      }}
      supportEnabled={mocks.values.supportEnabled}
      onSupportEnabledChange={(v) => {
        mocks.values.supportEnabled = apply(mocks.values.supportEnabled, v);
      }}
      supportCategories={mocks.values.supportCategories}
      onSupportCategoriesChange={(v) => {
        mocks.values.supportCategories = apply(mocks.values.supportCategories, v);
      }}
      supportFirstResponseMinutes={mocks.values.supportFirstResponseMinutes}
      onSupportFirstResponseMinutesChange={(v) => {
        mocks.values.supportFirstResponseMinutes = apply(
          mocks.values.supportFirstResponseMinutes,
          v,
        );
      }}
      supportResolutionMinutes={mocks.values.supportResolutionMinutes}
      onSupportResolutionMinutesChange={(v) => {
        mocks.values.supportResolutionMinutes = apply(
          mocks.values.supportResolutionMinutes,
          v,
        );
      }}
      supportReopenWindowDays={mocks.values.supportReopenWindowDays}
      onSupportReopenWindowDaysChange={(v) => {
        mocks.values.supportReopenWindowDays = apply(
          mocks.values.supportReopenWindowDays,
          v,
        );
      }}
    />,
  );
}

describe('SupportWorkflowCard', () => {
  beforeEach(() => {
    mocks.values = {
      guestBookingCancellationEnabled: false,
      supportEnabled: true,
      supportCategories: ['booking', 'stay'],
      supportFirstResponseMinutes: { low: 240, normal: 60, high: 15, urgent: 5 },
      supportResolutionMinutes: {
        low: 1440,
        normal: 480,
        high: 120,
        urgent: 30,
      },
      supportReopenWindowDays: 7,
    };
  });

  afterEach(cleanup);

  it('toggles guest booking cancellation through the setter prop', () => {
    renderCard();

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Allow guests to cancel eligible future bookings in the portal',
      }),
    );

    expect(mocks.values.guestBookingCancellationEnabled).toBe(true);
  });

  it('toggles the support workflow through the setter prop', () => {
    renderCard();

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Allow guests to start support conversations in the portal',
      }),
    );

    expect(mocks.values.supportEnabled).toBe(false);
  });

  it('removes a category through the functional setter', () => {
    renderCard();

    fireEvent.click(
      screen.getByRole('switch', { name: 'Stay or room' }),
    );

    expect(mocks.values.supportCategories).toEqual(['booking']);
  });

  it('adds a category through the functional setter', () => {
    renderCard();

    fireEvent.click(
      screen.getByRole('switch', { name: 'Billing or payment' }),
    );

    expect(mocks.values.supportCategories).toEqual([
      'booking',
      'stay',
      'billing',
    ]);
  });

  it('keeps the last enabled category switch disabled', () => {
    mocks.values.supportCategories = ['booking'];

    renderCard();

    expect(
      (screen.getByRole('switch', { name: 'Booking or check-in' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    // An unselected category can still be switched on.
    expect(
      (screen.getByRole('switch', { name: 'Stay or room' }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
  });

  it('clamps first-response targets to a minimum of one minute', () => {
    renderCard();

    // 'Low (minutes)' labels both the first-response and resolution fields;
    // the first match is the first-response input.
    const [firstResponseLow] = screen.getAllByLabelText('Low (minutes)');
    fireEvent.change(firstResponseLow, { target: { value: '0' } });

    expect(mocks.values.supportFirstResponseMinutes.low).toBe(1);
    expect(mocks.values.supportResolutionMinutes.low).toBe(1440);
  });

  it('clamps the reopen window to a minimum of one day', () => {
    renderCard();

    fireEvent.change(screen.getByLabelText('Guest reopen window'), {
      target: { value: '0' },
    });

    expect(mocks.values.supportReopenWindowDays).toBe(1);
  });

  it('disables every control for non-admins', () => {
    renderCard({ isAdmin: false });

    expect(
      (screen.getByRole('switch', {
        name: 'Allow guests to start support conversations in the portal',
      }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('switch', { name: 'Stay or room' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getAllByLabelText('Low (minutes)')[0] as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Guest reopen window') as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });
});
