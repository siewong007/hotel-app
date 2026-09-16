import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportCatalogEntry } from '../types';

const mocks = vi.hoisted(() => ({
  catalog: {
    data: undefined as ReportCatalogEntry[] | undefined,
    isPending: false,
    error: null as unknown,
  },
  envelope: { data: null as unknown, isFetching: false },
}));

vi.mock('../hooks', () => ({
  useReportCatalog: () => mocks.catalog,
  useReportEnvelope: () => mocks.envelope,
}));

import ReportLibraryPage from './ReportLibraryPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const entries: ReportCatalogEntry[] = [
  {
    id: 'arrivals',
    title: 'Arrivals Report',
    category: 'operations',
    description: 'Expected arrivals for the period',
    date_basis: 'stay',
    params: [],
  },
  {
    id: 'revenue-ledger',
    title: 'Revenue Ledger',
    category: 'financial',
    description: 'Revenue by account',
    date_basis: 'accounting',
    params: [],
  },
];

describe('ReportLibraryPage', () => {
  beforeEach(() => {
    mocks.catalog = { data: entries, isPending: false, error: null };
    mocks.envelope = { data: null, isFetching: false };
  });

  afterEach(cleanup);

  it('groups catalog entries by category', () => {
    render(<ReportLibraryPage />);
    expect(screen.getByText('Arrivals Report')).toBeTruthy();
    expect(screen.getByText('Revenue Ledger')).toBeTruthy();
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(screen.getByText('Financial')).toBeTruthy();
  });

  it('shows a spinner while the catalog loads', () => {
    mocks.catalog = { data: undefined, isPending: true, error: null };
    render(<ReportLibraryPage />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('surfaces a catalog load error', () => {
    mocks.catalog = { data: undefined, isPending: false, error: new Error('boom') };
    render(<ReportLibraryPage />);
    expect(screen.getByText(/Failed to load reports|boom/)).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<ReportLibraryPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
