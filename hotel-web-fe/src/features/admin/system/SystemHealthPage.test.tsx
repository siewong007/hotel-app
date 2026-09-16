import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemHealthResponse } from './types';

const mocks = vi.hoisted(() => ({
  health: {
    data: undefined as SystemHealthResponse | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock('./hooks', () => ({
  useSystemHealth: () => mocks.health,
}));

import SystemHealthPage from './SystemHealthPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const healthy: SystemHealthResponse = {
  database: 'ok',
  uptime_seconds: 90061,
  metrics: {
    requests_total: 1204,
    responses_4xx: 12,
    responses_5xx: 1,
    requests_slow: 3,
    rate_limit_rejections: 0,
    auth_denied: 2,
    permission_denied: 0,
    audit_write_failures: 0,
  },
  email_queue: { queued: 2, sending: 1, failed: 0, sent_24h: 58 },
  jobs: [
    {
      job_name: 'night_audit',
      last_status: 'ok',
      last_run_at: '2026-09-14T02:00:00Z',
      last_duration_ms: 420,
      last_error: null,
      last_detail: null,
      runs_24h: 1,
      failures_24h: 0,
    },
  ],
  job_runs_enabled: true,
};

describe('SystemHealthPage', () => {
  beforeEach(() => {
    mocks.health = {
      data: healthy,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  afterEach(cleanup);

  it('renders process metrics and the email queue summary', () => {
    render(<SystemHealthPage />);
    expect(screen.getByText('System Health')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('1,204')).toBeTruthy();
    expect(screen.getByText(/58 sent in the last 24h/)).toBeTruthy();
  });

  it('shows a spinner while loading and an alert on error', () => {
    mocks.health.isPending = true;
    mocks.health.data = undefined;
    const { unmount } = render(<SystemHealthPage />);
    expect(screen.getByRole('status')).toBeTruthy();
    unmount();

    mocks.health.isPending = false;
    mocks.health.isError = true;
    render(<SystemHealthPage />);
    expect(screen.getByText(/backend may be unreachable/)).toBeTruthy();
  });

  it('explains when job monitoring is not installed', () => {
    mocks.health.data = { ...healthy, job_runs_enabled: false, jobs: [] };
    render(<SystemHealthPage />);
    expect(screen.getByText(/not installed on this database yet/)).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<SystemHealthPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
