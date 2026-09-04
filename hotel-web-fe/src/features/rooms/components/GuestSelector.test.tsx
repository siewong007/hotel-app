// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GuestSelector, { emptyNewGuestForm } from './GuestSelector';

const renderNewGuestForm = (form = emptyNewGuestForm) =>
  render(
    <GuestSelector
      selectedGuest={null}
      onGuestSelect={vi.fn()}
      guests={[]}
      newGuestForm={form}
      onNewGuestFormChange={vi.fn()}
      isCreatingNew
      onToggleMode={vi.fn()}
    />,
  );

describe('GuestSelector new-guest form', () => {
  afterEach(() => {
    cleanup();
  });

  // Fast booking: front desk takes a reservation with just a name. Only the
  // first name is mandatory; last name, email, phone and IC are collected at
  // check-in (see services/guests.rs::create_guest).
  it('requires only the first name — last name, email, phone and IC are optional', () => {
    renderNewGuestForm();

    expect(screen.getByLabelText(/First Name/).hasAttribute('required')).toBe(true);

    for (const label of [/^Last Name/, /^Email/, /^Phone/, /^IC\/Passport Number/]) {
      expect(screen.getByLabelText(label).hasAttribute('required')).toBe(false);
    }
  });

  // Tourism type decides whether tourism tax is charged, so it is never
  // silently defaulted — staff must pick it.
  it('starts with no tourism type selected and marks the field required', () => {
    renderNewGuestForm();

    expect(emptyNewGuestForm.tourism_type).toBeUndefined();
    expect(screen.getByText('Required — determines whether tourism tax applies')).toBeDefined();
  });

  it('drops the required hint once a tourism type is chosen', () => {
    renderNewGuestForm({ ...emptyNewGuestForm, tourism_type: 'foreign' });

    expect(screen.getByText('Determines whether tourism tax applies')).toBeDefined();
  });
});
