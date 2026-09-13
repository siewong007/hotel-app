import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voucher } from '../types';
import { VoucherAdminTable } from './VoucherAdminTable';

function buildVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 11,
    promotion_id: 2,
    promotion_name: 'Stay longer',
    promotion_slug: 'stay-longer',
    code_masked: '••••AB12',
    status: 'available',
    source: 'admin_issue',
    is_cancellable: true,
    guest_id: 9,
    guest_name: 'Aisha',
    expires_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function renderTable(
  overrides: Partial<React.ComponentProps<typeof VoucherAdminTable>> = {},
) {
  const props = {
    vouchers: [buildVoucher()],
    total: 1,
    page: 0,
    pageSize: 25,
    isLoading: false,
    canManage: true,
    isRevoking: false,
    onView: vi.fn(),
    onRevoke: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
  render(<VoucherAdminTable {...props} />);
  return props;
}

describe('VoucherAdminTable', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }),
    });
  });

  afterEach(() => cleanup());

  it('renders masked code, guest name, source, and an Available chip', () => {
    renderTable();
    expect(screen.getByText('••••AB12')).toBeTruthy();
    expect(screen.getByText('Aisha')).toBeTruthy();
    expect(screen.getByText('Issued by staff')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('falls back to the guest id when no name is returned', () => {
    renderTable({ vouchers: [buildVoucher({ guest_name: null })] });
    expect(screen.getByText('Guest #9')).toBeTruthy();
  });

  it('badges an available voucher past expiry as Expired and hides revoke', () => {
    renderTable({
      vouchers: [buildVoucher({ expires_at: '2020-01-01T00:00:00Z' })],
    });
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Revoke voucher' }),
    ).toBeNull();
  });

  it('calls onView when the row is clicked', () => {
    const voucher = buildVoucher();
    const { onView } = renderTable({ vouchers: [voucher] });
    fireEvent.click(screen.getByText('Aisha'));
    expect(onView).toHaveBeenCalledWith(voucher);
  });

  it('revokes through the row action without opening details', () => {
    const { onView, onRevoke } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke voucher' }));
    expect(onRevoke).toHaveBeenCalledWith(11, '••••AB12');
    expect(onView).not.toHaveBeenCalled();
  });

  it('shows an empty state instead of a bare message', () => {
    renderTable({ vouchers: [], total: 0 });
    expect(screen.getByText('No vouchers found')).toBeTruthy();
  });
});
