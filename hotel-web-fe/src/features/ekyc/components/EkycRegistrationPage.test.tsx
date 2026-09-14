import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../api', () => ({
  EkycService: {
    uploadEkycDocument: vi.fn(),
    submitEkycVerification: vi.fn(),
  },
}));

import EkycRegistrationPage from './EkycRegistrationPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('EkycRegistrationPage', () => {
  afterEach(cleanup);

  it('renders the four-step registration wizard', () => {
    render(<EkycRegistrationPage />);
    expect(screen.getAllByText('Personal Information').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Document Details').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Upload Documents').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Verification').length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EkycRegistrationPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
