import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobRunRow, SystemHealthResponse } from './types';

const mocks = vi.hoisted(() => ({
  health: {
    data: undefined as SystemHealthResponse | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  failures: {
    data: undefined as JobRunRow[] | undefined,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock('./hooks', () => ({
  useSystemHealth: () => mocks.health,
  useJobFailures: () => mocks.failures,
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import JobsPage from './JobsPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const healthData: SystemHealthResponse = {
  database: 'ok',
  uptime_seconds: 3600,
  metrics: {
    requests_total: 10,
    responses_4xx: 0,
    responses_5xx: 0,
    requests_slow: 0,
    rate_limit_rejections: 0,
    auth_denied: 0,
    permission_denied: 0,
    audit_write_failures: 0,
  },
  email_queue: { queued: 0, sending: 0, failed: 0, sent_24h: 0 },
  jobs: [
    {
      job_name: 'night_audit',
      last_status: 'ok',
      last_run_at: '2026-09-14T02:00:00Z',
      last_duration_ms: 100,
      last_error: null,
      last_detail: null,
      runs_24h: 1,
      failures_24h: 0,
    },
  ],
  job_runs_enabled: true,
};

describe('JobsPage', () => {
  beforeEach(() => {
    mocks.health = { data: healthData, isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
    mocks.failures = { data: [], isPending: false, isFetching: false, refetch: vi.fn() };
  });

  afterEach(cleanup);

  it('renders the jobs table and a clean failures state', () => {
    render(<JobsPage />);
    expect(screen.getByText('night_audit')).toBeTruthy();
    expect(screen.getByText('No failed iterations on record.')).toBeTruthy();
  });

  it('explains when job monitoring is not installed', () => {
    mocks.health.data = { ...healthData, job_runs_enabled: false, jobs: [] };
    render(<JobsPage />);
    expect(screen.getByText(/not installed on this database yet/)).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<JobsPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
