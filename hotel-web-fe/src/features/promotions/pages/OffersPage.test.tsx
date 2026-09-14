import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../components/PromotionCatalog', () => ({
  PromotionCatalog: () => <div data-testid="promotion-catalog" />,
}));

vi.mock('../../guestPortal/theme/GuestPortalThemeProvider', () => ({
  GuestPortalThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import OffersPage from './OffersPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('OffersPage', () => {
  afterEach(cleanup);

  it('renders the offers hero and the promotion catalog', () => {
    render(<OffersPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByTestId('promotion-catalog')).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<OffersPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
