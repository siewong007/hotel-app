import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../../test/renderPage';
import { expectNoAxeViolations } from '../../../test/axe';

import GuestCheckInConfirmation from './GuestCheckInConfirmation';

describe('GuestCheckInConfirmation', () => {
  it('renders the confirmation page with its heading and actions', async () => {
    renderPage(<GuestCheckInConfirmation />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /start new|new check-in/i })).toBeTruthy();
  });

  it('reports no axe violations', async () => {
    const { container } = renderPage(<GuestCheckInConfirmation />);
    await screen.findByRole('heading', { level: 1 });
    await expectNoAxeViolations(container);
  });
});
