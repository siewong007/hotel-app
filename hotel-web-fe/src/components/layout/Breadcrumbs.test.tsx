import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/night-audit' }));

// The compat layer needs router context; stub the two pieces Breadcrumbs uses.
// Translations are NOT mocked — useTranslation reads the shipped en bundles
// without a provider, so the assertions exercise the real label lookup.
vi.mock('../../router', () => ({
  useLocation: () => ({
    pathname: mocks.pathname,
    search: '',
    hash: '',
    state: null,
    key: 'k',
  }),
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Breadcrumbs } from './Breadcrumbs';

describe('Breadcrumbs', () => {
  afterEach(cleanup);

  it('renders group › page for a grouped route', () => {
    mocks.pathname = '/night-audit';
    render(<Breadcrumbs />);

    expect(screen.getByText('Finance')).toBeTruthy();
    const current = screen.getByText('Night Audit');
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('renders a single Overview crumb on the /admin-portal dashboard alias', () => {
    mocks.pathname = '/admin-portal';
    render(<Breadcrumbs />);

    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a single Overview crumb on /', () => {
    mocks.pathname = '/';
    render(<Breadcrumbs />);

    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('trails non-nav auth pages back to an Overview link', () => {
    mocks.pathname = '/profile';
    render(<Breadcrumbs />);

    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview.getAttribute('href')).toBe('/');
    expect(screen.getByText('My Profile').getAttribute('aria-current')).toBe('page');
  });
});
