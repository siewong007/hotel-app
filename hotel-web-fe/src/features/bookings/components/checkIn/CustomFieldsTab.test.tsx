import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Booking } from '../../../../types';
import { CustomFieldsTab, type CustomFieldsTabProps } from './CustomFieldsTab';

const baseProps = (overrides: Partial<CustomFieldsTabProps> = {}): CustomFieldsTabProps => ({
  allowsExtraBed: false,
  maxExtraBeds: 0,
  extraBedChargePerBed: 0,
  booking: { tourism_tax_amount: 0 } as Booking,
  carPlateNo: '',
  currencySymbol: 'RM',
  driversInfo: '',
  eta: '',
  extraBedCharge: 0,
  extraBedCount: 0,
  formatCurrency: (amount: number) => `RM${amount}`,
  groupCode: '',
  languagePreference: '',
  setCarPlateNo: vi.fn(),
  setDriversInfo: vi.fn(),
  setEta: vi.fn(),
  setExtraBedCharge: vi.fn(),
  setExtraBedCount: vi.fn(),
  setGroupCode: vi.fn(),
  onLanguagePreferenceChange: vi.fn(),
  setTravelAgent1: vi.fn(),
  setTravelAgent2: vi.fn(),
  travelAgent1: '',
  travelAgent2: '',
  ...overrides,
});

describe('CustomFieldsTab language preference', () => {
  it('offers every supported locale, including Traditional Chinese', () => {
    const onLanguagePreferenceChange = vi.fn();
    render(
      <CustomFieldsTab {...baseProps({ onLanguagePreferenceChange })} />,
    );

    // MUI Select is a combobox: open it, then pick an option. This is the
    // tab's only Select — the InputLabel is visual-only (no labelId link).
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: '繁體中文' }));

    // The wire value is the locale code, not a display string.
    expect(onLanguagePreferenceChange).toHaveBeenCalledWith('zh-TW');
  });

  it('keeps a stored non-registry value selectable instead of showing blank', () => {
    render(<CustomFieldsTab {...baseProps({ languagePreference: 'Mandarin' })} />);
    expect(screen.getByRole('combobox').textContent).toContain('Mandarin');
  });
});
