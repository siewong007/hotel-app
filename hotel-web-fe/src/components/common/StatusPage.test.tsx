import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../test/renderPage';
import { expectNoAxeViolations } from '../../test/axe';

import { StatusPage } from './StatusPage';

const STATUS_CODES = [403, 404, 423] as const;

describe('StatusPage', () => {
  for (const statusCode of STATUS_CODES) {
    it(`renders the ${statusCode} page with a labelled main region and recovery actions`, async () => {
      renderPage(<StatusPage statusCode={statusCode} />);
      // role=main carries aria-labelledby pointing at the h1 title.
      const main = await screen.findByRole('main');
      expect(main).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
      expect(screen.getByRole('link')).toBeTruthy();
      expect(screen.getByRole('button')).toBeTruthy();
    });

    it(`reports no axe violations for ${statusCode}`, async () => {
      const { container } = renderPage(<StatusPage statusCode={statusCode} />);
      await screen.findByRole('heading', { level: 1 });
      await expectNoAxeViolations(container);
    });
  }
});
