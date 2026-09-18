import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChargesCard from './ChargesCard';

const mocks = vi.hoisted(() => ({
  values: {
    serviceTaxRate: 8,
    tourismTaxRate: 10,
    depositAmount: 50,
    unpaidHoldReleaseHours: 24,
    defaultPaymentTermsDays: 30,
  },
}));

const apply = <T,>(current: T, next: T | ((prev: T) => T)): T =>
  typeof next === 'function' ? (next as (prev: T) => T)(current) : next;

function renderCard() {
  render(
    <ChargesCard
      currencySymbol="RM"
      serviceTaxRate={mocks.values.serviceTaxRate}
      onServiceTaxRateChange={(v) => {
        mocks.values.serviceTaxRate = apply(mocks.values.serviceTaxRate, v);
      }}
      tourismTaxRate={mocks.values.tourismTaxRate}
      onTourismTaxRateChange={(v) => {
        mocks.values.tourismTaxRate = apply(mocks.values.tourismTaxRate, v);
      }}
      depositAmount={mocks.values.depositAmount}
      onDepositAmountChange={(v) => {
        mocks.values.depositAmount = apply(mocks.values.depositAmount, v);
      }}
      unpaidHoldReleaseHours={mocks.values.unpaidHoldReleaseHours}
      onUnpaidHoldReleaseHoursChange={(v) => {
        mocks.values.unpaidHoldReleaseHours = apply(
          mocks.values.unpaidHoldReleaseHours,
          v,
        );
      }}
      defaultPaymentTermsDays={mocks.values.defaultPaymentTermsDays}
      onDefaultPaymentTermsDaysChange={(v) => {
        mocks.values.defaultPaymentTermsDays = apply(
          mocks.values.defaultPaymentTermsDays,
          v,
        );
      }}
    />,
  );
}

describe('ChargesCard', () => {
  beforeEach(() => {
    mocks.values = {
      serviceTaxRate: 8,
      tourismTaxRate: 10,
      depositAmount: 50,
      unpaidHoldReleaseHours: 24,
      defaultPaymentTermsDays: 30,
    };
  });

  afterEach(cleanup);

  it('parses numeric input and falls back to 0 for empty values', () => {
    renderCard();

    fireEvent.change(screen.getByLabelText('Service Tax Rate'), {
      target: { value: '12.5' },
    });
    expect(mocks.values.serviceTaxRate).toBe(12.5);

    fireEvent.change(screen.getByLabelText('Default Deposit Amount'), {
      target: { value: '' },
    });
    expect(mocks.values.depositAmount).toBe(0);
  });

  it('treats 0 as a meaningful unpaid-hold value instead of a fallback', () => {
    renderCard();

    const field = screen.getByLabelText('Unpaid Hold Release');
    fireEvent.change(field, { target: { value: '0' } });
    expect(mocks.values.unpaidHoldReleaseHours).toBe(0);

    fireEvent.change(field, { target: { value: '48' } });
    expect(mocks.values.unpaidHoldReleaseHours).toBe(48);

    // Unparseable input also lands on 0 (off), never a truthy default.
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(mocks.values.unpaidHoldReleaseHours).toBe(0);
  });

  it('falls back to 1 day for empty payment terms', () => {
    renderCard();

    fireEvent.change(screen.getByLabelText('Payment Terms'), {
      target: { value: '' },
    });

    expect(mocks.values.defaultPaymentTermsDays).toBe(1);
  });
});
