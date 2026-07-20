import { join } from 'node:path';
/**
 * Selector-rule extraction regression tests.
 *
 * Audits the extractor's handling of:
 *   - `_aliased` selector keys inside `.styles({...})` (e.g. `_focusVisible`)
 *   - raw `'&:selector'` keys inside `.styles({...})`
 *   - scale lookup of typed props inside aliased blocks
 *   - component-usage recognition via `createElement(bareIdent, ...)`
 *
 * Exercises the full 14-arg `analyzeProject` signature matching the production
 * vite-plugin invocation. `runPipeline` passes `selectorAliasesJson` and a
 * `null` placeholder in the retained selector-order slot, closing the coverage
 * gap that let this regression class slip past integration.
 *
 * Historical regressions, now fixed and retained as active guards:
 *   - Bare-identifier `createElement` usage is recognized as rendering, so the
 *     reconciler retains the referenced component. (Pattern E)
 *   - Pass-through CSS props such as `outlineColor` resolve scale values inside
 *     nested selector-alias blocks. (Pattern C)
 */
import { describe, expect, test } from 'vitest';

import { readFixtureFile } from '../fixtures/read-fixtures';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { runPipeline } from './run-pipeline';

const FIXTURES = join(
  __dirname,
  '..',
  'fixtures',
  'components',
  'selector-rules'
);

// ─── Patterns that currently extract correctly (regression guards) ────

describe('selector rules — clean _aliased key with literal values', () => {
  const entry = readFixtureFile(FIXTURES, 'selector-rules-clean.tsx');
  const { css } = runPipeline([entry]);

  test('base rule emitted', () => {
    expect(css).toMatch(
      /\.animus-PatternC-\w+\s*\{[^}]*color:\s*var\(--color-text\)/
    );
  });

  test('_focusVisible alias resolves to :focus-visible selector', () => {
    expect(css).toMatch(/\.animus-PatternC-\w+:focus-visible/);
  });

  test('[Bug 2] outlineColor inside _focusVisible resolves via colors scale', () => {
    expect(css).toMatch(
      /\.animus-PatternC-\w+:focus-visible[^}]*outline-color:\s*var\(--color-primary\)/
    );
  });
});

describe('selector rules — raw & + _alias mix', () => {
  const entry = readFixtureFile(FIXTURES, 'selector-rules-raw-mix.tsx');
  const { css } = runPipeline([entry]);

  test('raw &:hover resolves correctly', () => {
    expect(css).toMatch(/\.animus-PatternA-\w+:hover/);
    expect(css).toMatch(
      /\.animus-PatternA-\w+:hover[^}]*color:\s*var\(--color-primary\)/
    );
  });

  test('_focusVisible alias in same block resolves correctly', () => {
    expect(css).toMatch(/\.animus-PatternA-\w+:focus-visible/);
  });
});

describe('selector rules — token ref in shorthand inside _alias', () => {
  const entry = readFixtureFile(FIXTURES, 'selector-rules-token-shorthand.tsx');
  const { css } = runPipeline([entry]);

  test('token ref inside shorthand resolves to var()', () => {
    expect(css).toMatch(
      /\.animus-PatternB-\w+:focus-visible[^}]*outline:\s*2px\s*solid\s*var\(--color-primary\)/
    );
  });

  test('no unresolved tokens', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('selector rules — compound _selected + token ref', () => {
  const entry = readFixtureFile(FIXTURES, 'selector-rules-compound-alias.tsx');
  const { css } = runPipeline([entry]);

  test('compound selector emitted with both aria and data attrs', () => {
    expect(css).toMatch(/\.animus-PatternD-\w+\[aria-selected="true"\]/);
    expect(css).toMatch(/\.animus-PatternD-\w+\[data-selected\]/);
  });

  test('token ref inside compound-sibling _focusVisible resolves', () => {
    expect(css).toMatch(
      /\.animus-PatternD-\w+:focus-visible[^}]*outline:\s*2px\s*solid\s*var\(--color-primary\)/
    );
  });
});

// ─── Fixed-regression acceptance guards ──────────────────────────────

describe('[Bug 1] createElement(bareIdent, ...) usage recognition', () => {
  const entry = readFixtureFile(FIXTURES, 'selector-rules-create-element.tsx');
  const { manifest, css } = runPipeline([entry]);

  test('[Bug 1] bare-identifier createElement is recognized as render usage', () => {
    expect(manifest.report.components_eliminated).toBe(0);
    expect(css).toMatch(/\.animus-PatternE-\w+/);
  });
});

// ─── Behavioral characterization ──────────────────────────────────────

describe('unresolvable token ref inside _alias — v2 drops the declaration', () => {
  const entry = readFixtureFile(
    FIXTURES,
    'selector-rules-unresolvable-token.tsx'
  );
  const { css } = runPipeline([entry]);

  // v2 intentionally drops the unresolvable declaration (per-property skip) and
  // emits the diagnostic captured by verify:parity, but keeps the surrounding
  // selector. (v1 preserved the raw `{colors.…}` text as CSS — retired.)
  test('surrounding selector is emitted and the raw unresolved token text is dropped', () => {
    expect(css).toMatch(/\.animus-PatternF-\w+:focus-visible/);
    expect(css).not.toContain('{colors.does-not-exist.999}');
  });
});

// ─── Dev/build reconciler parity (Position 3) ─────────────────────────

describe('dev/build reconciler parity — prospective elimination in dev mode', () => {
  const entry = readFixtureFile(
    FIXTURES,
    'selector-rules-prospective-unrendered.tsx'
  );

  test('prod mode eliminates the unrendered component with kind="component"', () => {
    const { manifest } = runPipeline([entry]);
    const details = manifest.report?.eliminated_details ?? [];
    const patternH = details.filter(
      (d: { component: string; kind: string }) =>
        d.component === 'PatternH' && d.kind === 'component'
    );
    expect(patternH.length).toBe(1);
    expect(manifest.report?.components_eliminated).toBeGreaterThanOrEqual(1);
  });

  test('dev mode retains component but surfaces prospective entry with kind="prospective_component"', () => {
    const { manifest } = runPipeline([entry], { devMode: true });
    const details = manifest.report?.eliminated_details ?? [];
    const prospective = details.filter(
      (d: { component: string; kind: string }) =>
        d.component === 'PatternH' && d.kind === 'prospective_component'
    );
    expect(prospective.length).toBe(1);
    expect(prospective[0].reason).toContain('would be eliminated');
    // Dev mode must NOT report actual eliminations
    expect(manifest.report?.components_eliminated ?? 0).toBe(0);
  });
});
