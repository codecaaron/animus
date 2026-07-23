import { describe, expect, it } from 'vitest';

import {
  AssertionError,
  assertConditionsInsideLayers,
} from '../src/assert-css';

/**
 * Guardrail G2 (modern-css-surface) — FIRST ARMED RUN.
 *
 * The structural check `assertConditionsInsideLayers` lands with the first
 * condition-emitting increment (03). These cases arm it: a passing shape that
 * mirrors the extractor's real emission (condition at-rules nested inside the
 * owning @layer block), a failing shape (a condition at-rule hoisted to the
 * top level), and a vacuous shape (no conditions) that must stay green.
 */

// Real emission shape: every condition at-rule nests inside a named @layer.
const CONDITIONS_IN_LAYERS = `
@layer anm-global, anm-base, anm-variants, anm-system;
:root { --color-primary: #abc; }
@layer anm-base {
  .animus-Card-abcd1234 {
    display: flex;
  }
  @media (min-width: 768px) {
    .animus-Card-abcd1234 {
      gap: 1rem;
    }
  }
  @container card (min-width: 400px) {
    .animus-Card-abcd1234 {
      font-size: 18px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animus-Card-abcd1234 {
      transition: none;
    }
  }
  @supports (display: grid) {
    .animus-Card-abcd1234 {
      display: grid;
    }
  }
}
@layer anm-variants {
  @layer standalone, composed;
  @layer composed {
    @container (min-width: 600px) {
      .animus-Card-abcd1234--size-lg { padding: 2rem; }
    }
  }
}
`.trim();

describe('assertConditionsInsideLayers (Guardrail G2)', () => {
  it('passes when every condition at-rule nests inside a named @layer block', () => {
    expect(() =>
      assertConditionsInsideLayers(CONDITIONS_IN_LAYERS)
    ).not.toThrow();
  });

  it('passes even for nested sublayers (@layer composed inside @layer anm-variants)', () => {
    // The `@container (min-width: 600px)` lives inside `@layer composed`, itself
    // nested in `@layer anm-variants` — still "inside a named @layer block".
    expect(() =>
      assertConditionsInsideLayers(CONDITIONS_IN_LAYERS, {
        atRules: ['@container'],
      })
    ).not.toThrow();
  });

  it('fails when a @container rule appears outside any @layer block', () => {
    const hoisted = `
@layer anm-base { .animus-Card { display: flex; } }
@container (min-width: 400px) { .animus-Card { font-size: 18px; } }
`.trim();
    expect(() => assertConditionsInsideLayers(hoisted)).toThrow(AssertionError);
  });

  it('fails when a @supports rule is hoisted to the top level', () => {
    const hoisted = `
@supports (display: grid) { .animus-Card { display: grid; } }
@layer anm-base { .animus-Card { display: flex; } }
`.trim();
    expect(() => assertConditionsInsideLayers(hoisted)).toThrow(AssertionError);
  });

  it('fails when a non-breakpoint @media is outside a layer', () => {
    const hoisted = `
@layer anm-base { .animus-Card { color: red; } }
@media (prefers-reduced-motion: reduce) { .animus-Card { transition: none; } }
`.trim();
    expect(() => assertConditionsInsideLayers(hoisted)).toThrow(AssertionError);
  });

  it('is vacuously green on output with no condition at-rules', () => {
    const plain = `
@layer anm-base { .animus-Card { display: flex; padding: 8px; } }
`.trim();
    expect(() => assertConditionsInsideLayers(plain)).not.toThrow();
  });

  it('reports the offending at-rule family and offset in the error', () => {
    const hoisted =
      '@layer anm-base { .x { color: red; } } @container (min-width: 400px) { .x { gap: 1rem; } }';
    try {
      assertConditionsInsideLayers(hoisted);
      throw new Error('expected assertion to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      expect((err as AssertionError).message).toContain('@container');
      expect((err as AssertionError).details).toHaveProperty('offenders');
    }
  });
});
