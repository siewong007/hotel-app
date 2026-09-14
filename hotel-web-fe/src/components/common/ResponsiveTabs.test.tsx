import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { ResponsiveTabs } from './ResponsiveTabs';
import type { ResponsiveTabItem } from './ResponsiveTabs';

const makeTabs = (count: number): ResponsiveTabItem[] =>
  Array.from({ length: count }, (_, i) => ({
    value: `tab-${i}`,
    label: `Tab ${i}`,
  }));

const tabs3 = makeTabs(3);
const tabs6 = makeTabs(6);

describe('ResponsiveTabs', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('desktop: renders a tablist with every tab and click fires onChange(value)', () => {
    const onChange = vi.fn();
    render(<ResponsiveTabs tabs={tabs3} value="tab-0" onChange={onChange} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab 1' }));
    expect(onChange).toHaveBeenCalledWith('tab-1');
  });

  it('phone + 6 tabs + auto: renders a Select combobox, no tablist', () => {
    mocks.isPhone = true;
    render(<ResponsiveTabs tabs={tabs6} value="tab-0" onChange={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Sections' })).toBeTruthy();
  });

  it('phone + 3 tabs + auto: still renders scrollable Tabs', () => {
    mocks.isPhone = true;
    render(<ResponsiveTabs tabs={tabs3} value="tab-0" onChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('phoneMode="select" forces the Select at 3 tabs', () => {
    mocks.isPhone = true;
    render(
      <ResponsiveTabs tabs={tabs3} value="tab-0" onChange={vi.fn()} phoneMode="select" />,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('select mode: picking a MenuItem fires onChange(value)', () => {
    mocks.isPhone = true;
    const onChange = vi.fn();
    render(
      <ResponsiveTabs tabs={tabs6} value="tab-0" onChange={onChange} phoneMode="select" />,
    );
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Tab 4' }));
    expect(onChange).toHaveBeenCalledWith('tab-4');
  });
});
