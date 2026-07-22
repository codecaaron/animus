import { assembleStylesheet } from '@animus-ui/extract/pipeline';
import { describe, expect, test } from 'vitest';

/**
 * End-to-end proof of the property-registration split contract through the REAL
 * shared `assembleStylesheet` — the same function both the Vite and Next plugins
 * call (packages/vite-plugin/src/virtual-modules.ts and
 * packages/next-plugin/src/extraction-session.ts import it identically).
 *
 * `@property` registration rules ride at the head of the theme's variable CSS
 * (emitted by createTheme's build()). This asserts assembleStylesheet keeps them
 * in the `variables` part — before the `@layer` declaration owns the cascade —
 * with no assembly change: they flow through purely because variableCss → the
 * variables part.
 */

// Exactly the shape createTheme's serialize().variableCss produces for a
// registered contextual var (see packages/system/__tests__/theme.test.ts).
const VARIABLE_CSS = [
  '@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }',
  '',
  ':root {\n  --color-primary: #abc;\n}',
].join('\n');

const COMPONENT_CSS = '@layer anm-base { .animus-card { padding: 8px; } }';

describe('assembleStylesheet: @property registration split contract', () => {
  test('places @property in the variables part, absent from body/declaration', () => {
    const { declaration, variables, body } = assembleStylesheet({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
      split: true,
    });

    expect(variables).toContain('@property --current-bg');
    expect(body).not.toContain('@property');
    expect(declaration).not.toContain('@property');
    // declaration remains only the @layer ordering statement.
    expect(declaration).toMatch(/@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/);
  });

  test('concatenation invariant: rejoined split equals the non-split output', () => {
    const split = assembleStylesheet({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
      split: true,
    });
    const nonSplit = assembleStylesheet({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
    });

    const rejoined = [split.declaration, split.variables, split.body]
      .filter(Boolean)
      .join('\n');
    expect(rejoined).toBe(nonSplit);
  });

  test('@property appears before the @layer declaration in assembled output', () => {
    const nonSplit = assembleStylesheet({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
    });

    const propIdx = nonSplit.indexOf('@property --current-bg');
    const layerBaseIdx = nonSplit.indexOf('@layer anm-base {');
    const declIdx = nonSplit.search(/@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/);

    expect(propIdx).toBeGreaterThanOrEqual(0);
    // @property sits in the variables part, after the ordering declaration line
    // but before any component @layer block.
    expect(propIdx).toBeGreaterThan(declIdx);
    expect(layerBaseIdx).toBeGreaterThan(propIdx);
  });

  test('opt-in: variableCss without @property yields no @property anywhere', () => {
    const nonSplit = assembleStylesheet({
      variableCss: ':root {\n  --color-primary: #abc;\n}',
      componentCss: COMPONENT_CSS,
    });
    expect(nonSplit).not.toContain('@property');
  });
});
