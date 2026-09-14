import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import PageHeader from './PageHeader';

const wrappedActions = (
  <>
    <Button>Wrapped A</Button>
    <Button>Wrapped B</Button>
  </>
);
const overflow = [{ id: 'a', label: 'Menu A', onClick: vi.fn() }];

describe('PageHeader', () => {
  beforeEach(() => {
    mocks.isPhone = false;
  });
  afterEach(cleanup);

  it('desktop: renders all actions children', () => {
    render(<PageHeader title="Bookings" actions={wrappedActions} />);
    expect(screen.getByRole('button', { name: 'Wrapped A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wrapped B' })).toBeTruthy();
  });

  it('phone + overflowActions: renders mobilePrimaryAction + More actions trigger only', () => {
    mocks.isPhone = true;
    render(
      <PageHeader
        title="Bookings"
        actions={wrappedActions}
        mobilePrimaryAction={<Button>Primary</Button>}
        overflowActions={overflow}
      />,
    );
    expect(screen.getByRole('button', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wrapped A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wrapped B' })).toBeNull();
  });

  it('phone + overflowActions without mobilePrimaryAction: renders only the trigger', () => {
    mocks.isPhone = true;
    render(
      <PageHeader title="Bookings" actions={wrappedActions} overflowActions={overflow} />,
    );
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wrapped A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wrapped B' })).toBeNull();
  });

  it('phone without overflowActions: keeps the wrapped actions row (regression)', () => {
    mocks.isPhone = true;
    render(
      <PageHeader
        title="Bookings"
        actions={wrappedActions}
        mobilePrimaryAction={<Button>Primary</Button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Wrapped A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wrapped B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Primary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
