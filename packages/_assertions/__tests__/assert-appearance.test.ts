import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assertColorSchemeEmission,
  assertSystemFallbackParity,
  assertSystemSchemeGuard,
  systemSchemeVariableSpans,
} from '../src/assert-appearance';
import {
  AssertionError,
  assertConditionsInsideLayers,
} from '../src/assert-css';
import {
  assertBootstrapScriptFirst,
  assertCharsetWithinByteBudget,
  assertNoBootstrapScript,
} from '../src/assert-html';

/**
 * Arming cases for the system-color-scheme structural checks
 * (openspec: system-color-scheme, increment 04).
 *
 * The fixtures below are transcribed from REAL build output, minifier artifacts
 * included, so a matcher that only works on pretty-printed emission fails here
 * instead of in a consumer lane:
 * - `e2e/vite-app/dist/assets/index-*.css` (Lightning CSS): unquoted attribute
 *   selectors and the injected `--lightningcss-light` / `--lightningcss-dark`
 *   pair on every rule that declares `color-scheme`;
 * - `e2e/next-app/.next/static/css/*.css` (Next): unquoted attribute selectors,
 *   no injected pair.
 */

// Shape of `e2e/vite-app` after Lightning CSS — theme blocks AND an
// application-authored `_osDark` condition block in the same sheet.
const VITE_SHAPED = `:root{--color-primary:var(--color-blue-500);--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}@media (prefers-color-scheme:light){:root:not([data-color-mode]){--color-primary:#1d4ed8;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light}}@media (prefers-color-scheme:dark){:root:not([data-color-mode]){--color-primary:#3b82f6;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}}[data-color-mode=dark]{--color-primary:#3b82f6;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}[data-color-mode=light]{--color-primary:#1d4ed8;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light}@layer anm-base{@media (prefers-color-scheme:dark){.animus-Card-74286a66{border-color:var(--color-border)}}}`;

describe('assertSystemSchemeGuard', () => {
  it('accepts guarded theme blocks alongside an unguarded author condition block', () => {
    expect(() =>
      assertSystemSchemeGuard(VITE_SHAPED, { expectSchemes: ['light', 'dark'] })
    ).not.toThrow();
  });

  it('rejects a root-targeting rule inside a prefers-color-scheme block that drops the guard', () => {
    const unguarded = VITE_SHAPED.replace(
      '@media (prefers-color-scheme:dark){:root:not([data-color-mode])',
      '@media (prefers-color-scheme:dark){:root'
    );
    expect(() => assertSystemSchemeGuard(unguarded)).toThrow(AssertionError);
  });

  it('rejects a partially guarded selector list', () => {
    const partial = VITE_SHAPED.replace(
      '@media (prefers-color-scheme:light){:root:not([data-color-mode])',
      '@media (prefers-color-scheme:light){:root:not([data-color-mode]),html'
    );
    expect(() => assertSystemSchemeGuard(partial)).toThrow(AssertionError);
  });

  it('ignores an app-authored html rule inside a prefers-color-scheme block', () => {
    // `html { _osDark: { … } }` in an app's global styles emits an unguarded
    // root-element block that is the app's own business — the guard contract
    // governs the emitter's fallback blocks, which are always `:root`-based.
    const authored = `${VITE_SHAPED}@media (prefers-color-scheme:dark){html{--app-owned:1}}`;
    expect(() =>
      assertSystemSchemeGuard(authored, { expectSchemes: ['light', 'dark'] })
    ).not.toThrow();
  });

  it('stays green on an unconfigured sheet but refuses to claim presence', () => {
    const unconfigured = ':root{--color-primary:#3b82f6}';
    expect(() => assertSystemSchemeGuard(unconfigured)).not.toThrow();
    expect(() =>
      assertSystemSchemeGuard(unconfigured, { expectSchemes: ['dark'] })
    ).toThrow(AssertionError);
  });

  it('refuses a guarded block that carries no custom properties', () => {
    const schemeOnly =
      ':root{--a:1}@media (prefers-color-scheme:dark){:root:not([data-color-mode]){color-scheme:dark}}';
    expect(() =>
      assertSystemSchemeGuard(schemeOnly, { expectSchemes: ['dark'] })
    ).toThrow(AssertionError);
  });
});

describe('assertColorSchemeEmission', () => {
  it('reads color-scheme off :root, both attribute blocks and both guarded blocks', () => {
    expect(() =>
      assertColorSchemeEmission(VITE_SHAPED, {
        root: 'dark',
        modes: { dark: 'dark', light: 'light' },
        system: { light: 'light', dark: 'dark' },
      })
    ).not.toThrow();
  });

  it('rejects a :root classification that does not match the initial mode', () => {
    expect(() =>
      assertColorSchemeEmission(VITE_SHAPED, {
        root: 'light',
        modes: { dark: 'dark' },
      })
    ).toThrow(AssertionError);
  });

  it('rejects a mode block whose color-scheme contradicts the classification', () => {
    expect(() =>
      assertColorSchemeEmission(VITE_SHAPED, {
        root: 'dark',
        modes: { light: 'dark' },
      })
    ).toThrow(AssertionError);
  });
});

describe('assertSystemFallbackParity', () => {
  it('accepts declaration lists that match the mapped mode block byte-for-byte', () => {
    expect(() =>
      assertSystemFallbackParity(VITE_SHAPED, {
        mapping: { light: 'light', dark: 'dark' },
      })
    ).not.toThrow();
  });

  it('rejects a fallback whose declarations drifted from the mode block', () => {
    const drifted = VITE_SHAPED.replace(
      '@media (prefers-color-scheme:dark){:root:not([data-color-mode]){--color-primary:#3b82f6',
      '@media (prefers-color-scheme:dark){:root:not([data-color-mode]){--color-primary:#000000'
    );
    expect(() =>
      assertSystemFallbackParity(drifted, { mapping: { dark: 'dark' } })
    ).toThrow(AssertionError);
  });

  it('rejects a fallback emitted ahead of the :root block', () => {
    const media =
      '@media (prefers-color-scheme:dark){:root:not([data-color-mode]){--color-primary:#3b82f6}}';
    const reordered = `${media}:root{--color-primary:#000}[data-color-mode=dark]{--color-primary:#3b82f6}`;
    expect(() =>
      assertSystemFallbackParity(reordered, { mapping: { dark: 'dark' } })
    ).toThrow(AssertionError);
  });
});

/**
 * `systemSchemeVariableSpans` is the only thing in this package that LOOSENS a
 * gate: each span it returns switches `assertConditionsInsideLayers` off across
 * that character range. Its three earning conditions are therefore the load-
 * bearing code here, and every one of them gets a case that goes red when the
 * condition is deleted.
 *
 * Contract (arch-css-structural-gates): a `prefers-color-scheme` block earns a
 * span only when it sits unlayered ahead of the first `@layer` block, every
 * rule inside it is the root guard, and it contains no nested at-rule.
 */
describe('systemSchemeVariableSpans', () => {
  // Offset of the AUTHOR-written `_osDark` component block, which lives inside
  // `@layer anm-base` and must never be covered.
  const authorBlock = VITE_SHAPED.indexOf(
    '@media (prefers-color-scheme:dark){.animus-Card'
  );
  const covers = (
    spans: readonly (readonly [number, number])[],
    index: number
  ): boolean => spans.some(([start, end]) => index >= start && index <= end);

  it('(a) emits a span for each all-guarded unlayered block, and only those', () => {
    const spans = systemSchemeVariableSpans(VITE_SHAPED);
    expect(spans).toHaveLength(2);
    for (const [start, end] of spans) {
      const block = VITE_SHAPED.slice(start, end + 1);
      expect(block.startsWith('@media')).toBe(true);
      expect(block).toContain(':root:not([data-color-mode])');
    }
    expect(authorBlock).toBeGreaterThan(-1);
    expect(covers(spans, authorBlock)).toBe(false);
  });

  it('(b) withholds the span from a block whose rule targets a class, not the root', () => {
    const classScoped = VITE_SHAPED.replace(
      '@media (prefers-color-scheme:light){:root:not([data-color-mode])',
      '@media (prefers-color-scheme:light){.animus-Card-74286a66'
    );
    const spans = systemSchemeVariableSpans(classScoped);
    expect(spans).toHaveLength(1);
    expect(
      covers(spans, classScoped.indexOf('@media (prefers-color-scheme:light)'))
    ).toBe(false);
  });

  it('(c) withholds the span when one extra unguarded rule joins the block', () => {
    // The guard is still there; a second, unguarded rule rides beside it.
    const extraRule = VITE_SHAPED.replace(
      'color-scheme:dark}}',
      'color-scheme:dark}.animus-Card-74286a66{color:red}}'
    );
    expect(extraRule).not.toBe(VITE_SHAPED);
    const spans = systemSchemeVariableSpans(extraRule);
    expect(spans).toHaveLength(1);
    expect(
      covers(spans, extraRule.indexOf('@media (prefers-color-scheme:dark)'))
    ).toBe(false);
  });

  it('(d) withholds the span from a block with no rules at all', () => {
    const empty = ':root{--a:1}@media (prefers-color-scheme:dark){}';
    expect(systemSchemeVariableSpans(empty)).toHaveLength(0);
  });

  it('(e) the gate it loosens is non-vacuous — without spans, VITE_SHAPED throws', () => {
    expect(() => assertConditionsInsideLayers(VITE_SHAPED)).toThrow(
      AssertionError
    );
    expect(() =>
      assertConditionsInsideLayers(VITE_SHAPED, {
        exemptSpans: systemSchemeVariableSpans(VITE_SHAPED),
      })
    ).not.toThrow();
  });

  it('(f) forfeits the exemption when an at-rule nests inside the guarded block', () => {
    // The nested rule is ITSELF the root guard, so the all-guarded condition
    // alone still passes — this is exactly the shape that would otherwise ride
    // into the sheet under blanket cover.
    const nested = VITE_SHAPED.replace(
      'color-scheme:dark}}',
      'color-scheme:dark}@supports (color:red){:root:not([data-color-mode]){--color-primary:red}}}'
    );
    expect(nested).not.toBe(VITE_SHAPED);
    const spans = systemSchemeVariableSpans(nested);
    expect(spans).toHaveLength(1);
    expect(
      covers(spans, nested.indexOf('@media (prefers-color-scheme:dark)'))
    ).toBe(false);
    expect(() =>
      assertConditionsInsideLayers(nested, { exemptSpans: spans })
    ).toThrow(AssertionError);
  });

  it('(g) forfeits the exemption for an all-guarded block that trails a layer block', () => {
    const guarded =
      '@media (prefers-color-scheme:dark){:root:not([data-color-mode]){--color-primary:#3b82f6}}';
    const relocated = `:root{--color-primary:#000}@layer anm-base{.animus-Card-74286a66{color:red}}${guarded}`;
    const spans = systemSchemeVariableSpans(relocated);
    expect(spans).toHaveLength(0);
    expect(() =>
      assertConditionsInsideLayers(relocated, { exemptSpans: spans })
    ).toThrow(AssertionError);

    // Same block, same bytes, positioned in the variables part → earns its span.
    const inPlace = `:root{--color-primary:#000}${guarded}@layer anm-base{.animus-Card-74286a66{color:red}}`;
    expect(systemSchemeVariableSpans(inPlace)).toHaveLength(1);
  });
});

// `e2e/next-app/.next/server/pages/legacy.html`, trimmed: the Pages Router
// document places the script itself, and Next's own CSS preload link is the
// first stylesheet reference after it.
const CODE = '(function(){try{}catch(e){}})();';
const NEXT_SHAPED = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><script data-animus-bootstrap="">${CODE}</script><link rel="preload" href="/_next/static/css/a.css" as="style"/><link rel="stylesheet" href="/_next/static/css/a.css"/></head><body></body></html>`;

describe('assertBootstrapScriptFirst', () => {
  it('accepts a script placed ahead of a preload/stylesheet pair', () => {
    expect(() => assertBootstrapScriptFirst(NEXT_SHAPED)).not.toThrow();
  });

  it('compares the emitted text to the artifact code and its CSP hash', () => {
    // sha256 of CODE, base64 — recomputed the way a browser would.
    const cspHash = `sha256-${createHash('sha256').update(CODE, 'utf8').digest('base64')}`;
    expect(() =>
      assertBootstrapScriptFirst(NEXT_SHAPED, { code: CODE, cspHash })
    ).not.toThrow();
    expect(() =>
      assertBootstrapScriptFirst(NEXT_SHAPED, { cspHash: 'sha256-stale' })
    ).toThrow(AssertionError);
  });

  it('rejects a script that trails a stylesheet reference', () => {
    const trailing = `<html><head><link rel="stylesheet" href="/a.css"/><script data-animus-bootstrap="">${CODE}</script></head></html>`;
    expect(() => assertBootstrapScriptFirst(trailing)).toThrow(AssertionError);
  });

  it('rejects a script that trails an inline <style> element', () => {
    const trailing = `<html><head><style data-animus-layers="">@layer a;</style><script data-animus-bootstrap="">${CODE}</script></head></html>`;
    expect(() => assertBootstrapScriptFirst(trailing)).toThrow(AssertionError);
  });

  it('refuses to pass on a document with no stylesheet reference at all', () => {
    const noCss = `<html><head><script data-animus-bootstrap="">${CODE}</script></head></html>`;
    expect(() => assertBootstrapScriptFirst(noCss)).toThrow(AssertionError);
  });

  it('rejects a document with no bootstrap script', () => {
    expect(() =>
      assertBootstrapScriptFirst(
        '<html><head><link rel="stylesheet"/></head></html>'
      )
    ).toThrow(AssertionError);
  });
});

describe('assertCharsetWithinByteBudget', () => {
  it('accepts a charset declaration inside the byte budget', () => {
    expect(() => assertCharsetWithinByteBudget(NEXT_SHAPED)).not.toThrow();
  });

  it('rejects a declaration pushed past the budget', () => {
    const padded = `<!DOCTYPE html><html><head><script>${'x'.repeat(1024)}</script><meta charset="utf-8"/></head></html>`;
    expect(() => assertCharsetWithinByteBudget(padded)).toThrow(AssertionError);
  });

  it('measures bytes, not UTF-16 code units', () => {
    // é is 1 code unit but 2 UTF-8 bytes: the meta sits inside the limit by
    // string offset yet past it by bytes, which is what the browser counts.
    const padded = `<!DOCTYPE html><html><head><script>/*${'é'.repeat(500)}*/</script><meta charset="utf-8"/></head></html>`;
    expect(padded.indexOf('/></head>')).toBeLessThanOrEqual(1024);
    expect(() => assertCharsetWithinByteBudget(padded)).toThrow(AssertionError);
  });

  it('fails loud when no encoding declaration exists at all', () => {
    expect(() =>
      assertCharsetWithinByteBudget('<html><head></head></html>')
    ).toThrow(AssertionError);
  });
});

describe('assertNoBootstrapScript', () => {
  it('passes on a document the application never touched', () => {
    expect(() =>
      assertNoBootstrapScript(
        '<html><head><link rel="stylesheet" href="/a.css"/></head></html>'
      )
    ).not.toThrow();
  });

  it('fails as soon as the marker appears', () => {
    expect(() => assertNoBootstrapScript(NEXT_SHAPED)).toThrow(AssertionError);
  });
});
