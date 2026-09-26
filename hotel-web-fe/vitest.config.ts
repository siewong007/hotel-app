import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Page-level renders and axe scans sit near the 5s default under CI
    // load; 15s keeps hangs detectable without per-file timeout whack-a-mole.
    testTimeout: 15000,
    setupFiles: [],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'salim-inn/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/*.d.ts',
        'src/vite-env.d.ts',
        'src/routeTree.gen.ts',
      ],
      // Floor, not a target: measured 2026-09-17 across 250 files / 2,020
      // tests at 60.41% statements, 52.19% branches, 49.40% functions,
      // 61.92% lines. Set a few points below that so today's suite passes but
      // a real coverage regression (e.g. a deleted test file) fails CI. Raise
      // these as real coverage is added — do not lower them to make a change
      // pass.
      //
      // The previous figures here (~3% statements, recorded 2026-07-12) were
      // low by a factor of twenty, which left the gate ~24x below actual and
      // therefore unable to fail: most of the suite could have been deleted
      // without CI noticing. Re-measure with `bunx vitest run --coverage`
      // before editing these, rather than trusting this comment.
      thresholds: {
        statements: 55,
        branches: 47,
        functions: 44,
        lines: 55,
      },
    },
  },
});