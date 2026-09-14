import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { ActionsMenu } from './ActionsMenu';

const actions = [
  { id: 'edit', label: 'Edit', onClick: vi.fn() },
  { id: 'del', label: 'Delete', onClick: vi.fn(), destructive: true },
];

describe('ActionsMenu', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('desktop: opens a Menu and runs the action', () => {
    render(<ActionsMenu actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(actions[0].onClick).toHaveBeenCalledTimes(1);
  });

  it('phone: opens a bottom sheet listing actions', () => {
    mocks.isPhone = true;
    render(<ActionsMenu actions={actions} title="Booking actions" />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByText('Booking actions')).toBeTruthy();
    fireEvent.click(screen.getByText('Edit'));
    expect(actions[0].onClick).toHaveBeenCalledTimes(1);
  });

  it('hides hidden items and renders destructive last', () => {
    mocks.isPhone = true;
    render(<ActionsMenu actions={[...actions, { id: 'x', label: 'Nope', onClick: vi.fn(), hidden: true }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByText('Nope')).toBeNull();
    const texts = screen.getAllByRole('button').map((b) => b.textContent);
    expect(texts.indexOf('Delete')).toBeGreaterThan(texts.indexOf('Edit'));
  });
});
