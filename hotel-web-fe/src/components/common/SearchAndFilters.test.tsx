import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { SearchAndFilters } from './SearchAndFilters';

const search = <input aria-label="Search" />;
const filters = <div>filter controls</div>;

describe('SearchAndFilters', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('desktop: renders search and children inline, no filter button', () => {
    render(<SearchAndFilters search={search}>{filters}</SearchAndFilters>);
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByText('filter controls')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open filters' })).toBeNull();
  });

  it('phone: renders search + badged "Open filters" button; children stay out of the DOM', () => {
    mocks.isPhone = true;
    render(
      <SearchAndFilters search={search} activeFilterCount={3}>
        {filters}
      </SearchAndFilters>,
    );
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open filters' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText('filter controls')).toBeNull();
  });

  it('phone: opening the sheet shows children and Reset calls onReset', () => {
    mocks.isPhone = true;
    const onReset = vi.fn();
    render(
      <SearchAndFilters search={search} onReset={onReset}>
        {filters}
      </SearchAndFilters>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    expect(screen.getByText('filter controls')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
