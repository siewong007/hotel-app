import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext, buildAuthContextValue } from '../../test/renderPage';
import { expectNoAxeViolations } from '../../test/axe';

import LandingPage from './LandingPage';

// The landing page is a redirect shim: once auth resolves it hands the
// top-level document to the static /salim-inn experience via
// window.location.replace (jsdom logs "Not implemented" and continues — the
// redirect itself can't be observed, only that nothing crashes and nothing
// user-facing renders).
describe('LandingPage', () => {
  it('shows a labelled loading indicator while auth resolves', () => {
    render(
      <AuthContext.Provider value={buildAuthContextValue({ isLoading: true, isAuthenticated: false, user: null })}>
        <LandingPage />
      </AuthContext.Provider>,
    );
    expect(screen.getByLabelText(/loading/i)).toBeTruthy();
  });

  it('renders nothing user-facing once auth resolves (document redirect)', () => {
    const { container } = render(
      <AuthContext.Provider value={buildAuthContextValue()}>
        <LandingPage />
      </AuthContext.Provider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('reports no axe violations in the loading state', async () => {
    const { container } = render(
      <AuthContext.Provider value={buildAuthContextValue({ isLoading: true, isAuthenticated: false, user: null })}>
        <LandingPage />
      </AuthContext.Provider>,
    );
    await screen.findByLabelText(/loading/i);
    await expectNoAxeViolations(container);
  });
});
