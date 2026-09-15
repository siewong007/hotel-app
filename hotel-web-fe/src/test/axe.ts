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

type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeCheckOptions {
  /**
   * Impacts that fail the test. Default `['critical', 'serious']` — the
   * severities axe assigns to WCAG A/AA failures a user can actually hit
   * (missing labels, bad names, invalid ARIA). `moderate`/`minor` stay
   * advisory because bare page renders (no app shell) produce false
   * positives there — see `disabledRules` note on landmarks.
   */
  failOnImpacts?: ReadonlyArray<AxeImpact>;
  /**
   * Rule ids that fail regardless of their impact level. Default
   * `['heading-order']`: a page's internal h1→h2→h3 order is a real property
   * even when rendered without the app shell.
   */
  failOnRules?: ReadonlyArray<string>;
  /**
   * Rule ids disabled for THIS page, each mapped to its justification. An
   * entry without a justification string is rejected — exclusions must be
   * documented, never silent. `color-contrast` is always disabled (jsdom has
   * no layout engine, so computed colors are meaningless).
   */
  disabledRules?: Record<string, string>;
}

const ALWAYS_DISABLED: Record<string, string> = {
  'color-contrast': 'jsdom has no layout engine; axe cannot measure real contrast ratios',
  // Pages are scanned without the app shell that supplies <main>/nav
  // landmarks, so landmark coverage rules would flag a test artifact, not a
  // page defect. Landmark structure belongs to RootLayout, not the page.
  region: 'page renders without the app shell that provides landmark regions',
  'landmark-one-main': 'the <main> landmark lives in RootLayout, not in page components',
  'page-has-heading-one': 'page components may rely on shell-level h1; order is still checked via heading-order',
};

/**
 * Stricter axe check for page-level coverage: fails on critical + serious
 * violations plus `heading-order`, with per-page rule exclusions that must
 * carry a written justification.
 */
export async function expectNoAxeViolations(container: Element, options: AxeCheckOptions = {}) {
  const { failOnImpacts = ['critical', 'serious'], failOnRules = ['heading-order'], disabledRules = {} } = options;

  for (const [ruleId, justification] of Object.entries(disabledRules)) {
    expect(
      justification.trim().length,
      `axe rule "${ruleId}" is disabled without a justification — document why this page legitimately excludes it`,
    ).toBeGreaterThan(0);
  }

  const rules: Record<string, { enabled: boolean }> = {};
  for (const ruleId of [...Object.keys(ALWAYS_DISABLED), ...Object.keys(disabledRules)]) {
    rules[ruleId] = { enabled: false };
  }

  const results = await axe.run(container, { rules });
  const impactSet = new Set<AxeImpact>(failOnImpacts);
  const ruleSet = new Set(failOnRules);
  const failures = results.violations.filter(
    (v) => (v.impact && impactSet.has(v.impact as AxeImpact)) || ruleSet.has(v.id),
  );

  expect(
    failures.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`),
    `axe violations:\n${failures
      .map((v) => `${v.id} [${v.impact}] — ${v.help} (${v.helpUrl})\n  ${v.nodes
        .map((n) => n.target.join(' '))
        .join('\n  ')}`)
      .join('\n')}`,
  ).toEqual([]);
  return results;
}
