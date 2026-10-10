import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserSessionInfo } from '../../../../types';
import DevicesTab from './DevicesTab';

const session = (overrides: Partial<UserSessionInfo> = {}): UserSessionInfo => ({
  id: 's-1',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  ip_address: '203.0.113.7',
  created_at: '2026-10-01T00:00:00Z',
  expires_at: '2026-11-01T00:00:00Z',
  is_current: false,
  ...overrides,
});

describe('DevicesTab', () => {
  afterEach(cleanup);

  it('lists sessions with their address on its own line and no revoke for the current one', () => {
    const onRevoke = vi.fn();
    const other = session({ id: 's-2', ip_address: '2001:db8:5420:abcd:1234:5678:9abc:def0' });
    render(
      <DevicesTab sessions={[session({ is_current: true }), other]} onRevoke={onRevoke} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Current device')).toBeTruthy();
    expect(screen.getByText('2001:db8:5420:abcd:1234:5678:9abc:def0')).toBeTruthy();

    const revoke = screen.getAllByRole('button', { name: 'Log out device' });
    expect(revoke).toHaveLength(1);
    fireEvent.click(revoke[0]);
    expect(onRevoke).toHaveBeenCalledWith(other);
  });

  it('shows the empty message when there are no sessions', () => {
    render(<DevicesTab sessions={[]} onRevoke={vi.fn()} />);
    expect(screen.getByText('No active sessions found.')).toBeTruthy();
  });
});
