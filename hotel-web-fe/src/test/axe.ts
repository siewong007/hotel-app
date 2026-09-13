import { expect } from 'vitest';
import axe from 'axe-core';

/**
 * Runs axe-core against a rendered tree and fails on critical-impact
 * violations. `color-contrast` is disabled — jsdom has no layout engine so
 * axe cannot measure real contrast ratios (it reports false positives).
 */
export async function expectNoCriticalAxeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const critical = results.violations.filter((v) => v.impact === 'critical');
  expect(
    critical.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
    `critical axe violations:\n${critical
      .map((v) => `${v.id} — ${v.help} (${v.helpUrl})`)
      .join('\n')}`,
  ).toEqual([]);
  return results;
}
