import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
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
      // Floor, not a target: measured baseline on 2026-07-12 was ~3.07%
      // statements / 1.89% branches / 3.28% functions / 2.97% lines. Set a
      // few points below that so today's suite passes but a real coverage
      // regression (e.g. a deleted test file) fails CI. Raise these as real
      // coverage is added — do not lower them to make a change pass.
      thresholds: {
        statements: 2.5,
        branches: 1.5,
        functions: 2.5,
        lines: 2.5,
      },
    },
  },
});