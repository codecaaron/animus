import { describe, expect, it } from 'vitest';

import {
  AssertionError,
  assertClassNameFormat,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  assertNoUnresolvedTokens,
} from '../src/assert-css';

const ORDERED_CSS = `
@layer anm-global, anm-base, anm-variants;
:root {
  --colors-primary: #abc;
}
@layer anm-global { html { box-sizing: border-box; } }
@layer anm-base { .animus-card { padding: 8px; } }
@layer anm-variants { .animus-card--primary { color: red; } }
`.trim();

describe('assertLayerOrder', () => {
  it('passes for correctly ordered CSS', () => {
    expect(() => assertLayerOrder(ORDERED_CSS)).not.toThrow();
  });

  it('fails when :root appears after a layer block', () => {
    const broken =
      '@layer anm-global, anm-base, anm-variants; @layer anm-base { .x {} } :root { --c: red; } @layer anm-global {} @layer anm-variants {}';
    expect(() => assertLayerOrder(broken)).toThrow(AssertionError);
  });

  it('fails when an expected layer is missing', () => {
    const missing =
      '@layer anm-global, anm-base; :root {} @layer anm-global {} @layer anm-base {}';
    expect(() => assertLayerOrder(missing)).toThrow(/anm-variants/);
  });

  it('honors a custom layer list', () => {
    const css = '@layer x; :root {} @layer x {}';
    expect(() =>
      assertLayerOrder(css, { layers: ['@layer ', ':root', '@layer x {'] })
    ).not.toThrow();
  });

  it('accepts regex markers including minified (no-space) layer blocks', async () => {
    const { layerBlock } = await import('../src/assert-css');
    const minified =
      '@layer anm-base,anm-variants;@layer anm-base{.x{}}@layer anm-variants{.y{}}';
    expect(() =>
      assertLayerOrder(minified, {
        layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
      })
    ).not.toThrow();
  });
});

describe('assertNoPlaceholders', () => {
  it('passes for clean CSS', () => {
    expect(() => assertNoPlaceholders(ORDERED_CSS)).not.toThrow();
  });

  it('fails when __TRANSFORM__ is present', () => {
    expect(() => assertNoPlaceholders('.x { color: __TRANSFORM__; }')).toThrow(
      AssertionError
    );
  });
});

describe('assertClassNameFormat', () => {
  it('passes when prefix is present', () => {
    expect(() => assertClassNameFormat('.animus-button {}')).not.toThrow();
  });

  it('fails when prefix is absent', () => {
    expect(() => assertClassNameFormat('.foo {}')).toThrow(AssertionError);
  });

  it('honors custom prefix', () => {
    expect(() =>
      assertClassNameFormat('.anm-x {}', { prefix: 'anm-' })
    ).not.toThrow();
  });
});

describe('assertNoUnresolvedTokens', () => {
  it('passes when no unresolved tokens are present', () => {
    expect(() =>
      assertNoUnresolvedTokens('.x { color: var(--colors-primary); }')
    ).not.toThrow();
  });

  it('fails when {colors.primary} appears unresolved', () => {
    expect(() =>
      assertNoUnresolvedTokens('.x { color: {colors.primary}; }')
    ).toThrow(AssertionError);
  });

  it('honors custom forbidden patterns', () => {
    expect(() =>
      assertNoUnresolvedTokens('.x { z-index: {z.primary}; }', {
        forbiddenPatterns: [/\{z\.[a-zA-Z][\w.-]*\}/],
      })
    ).toThrow(AssertionError);
  });
});

describe('assertNoEmotionImports', () => {
  it('passes for clean JS', () => {
    expect(() =>
      assertNoEmotionImports("import { render } from 'react-dom';")
    ).not.toThrow();
  });

  it('fails when @emotion import is present', () => {
    expect(() =>
      assertNoEmotionImports("import x from '@emotion/css';")
    ).toThrow(AssertionError);
  });
});

describe('assertKeyframesExtracted', () => {
  const GOOD_CSS = `
    @layer anm-global {
      @keyframes animus-kf-abc { 0% { opacity: 0 } 100% { opacity: 1 } }
      @keyframes animus-kf-def { 0% { transform: scale(1) } 50% { transform: scale(1.1) } }
    }
    .animus-x { animation-name: animus-kf-abc }
    .animus-y { animation-name: animus-kf-def }
  `;

  it('passes for well-formed keyframes CSS', () => {
    expect(() =>
      assertKeyframesExtracted(GOOD_CSS, {
        minBlocks: 2,
        minReferences: 2,
        insideLayer: 'anm-global',
      })
    ).not.toThrow();
  });

  it('fails when no @keyframes blocks are present', () => {
    const css = '.x { animation-name: animus-kf-xyz }';
    expect(() => assertKeyframesExtracted(css)).toThrow(
      /expected at least 1 @keyframes block/
    );
  });

  it('fails when no prefixed animation-name references are present', () => {
    const css = '@keyframes animus-kf-abc { 0% {} }';
    expect(() => assertKeyframesExtracted(css)).toThrow(
      /expected at least 1 animation-name reference/
    );
  });

  it('fails when a reference has no matching @keyframes block', () => {
    const css =
      '@keyframes animus-kf-abc { 0% {} } .x { animation-name: animus-kf-xyz }';
    expect(() => assertKeyframesExtracted(css)).toThrow(
      /no matching @keyframes block: animus-kf-xyz/
    );
  });

  it('fails when unit-fallback mangles the identifier with trailing px', () => {
    const css =
      '@keyframes animus-kf-1w7pb41 {} .x { animation-name: animus-kf-1w7pb41px }';
    expect(() => assertKeyframesExtracted(css)).toThrow(/trailing 'px'/);
  });

  it('skips CSS keyword values when counting references', () => {
    const css =
      '@keyframes animus-kf-abc {} .x { animation-name: animus-kf-abc } .y { animation-name: none } .z { animation-name: INHERIT }';
    expect(() => assertKeyframesExtracted(css)).not.toThrow();
  });

  it('passes when a block is inside the expected @layer span', () => {
    const css =
      '@layer anm-global { @keyframes animus-kf-abc {} } .x { animation-name: animus-kf-abc }';
    expect(() =>
      assertKeyframesExtracted(css, { insideLayer: 'anm-global' })
    ).not.toThrow();
  });

  it('fails when a block is outside the expected @layer span', () => {
    const css =
      '@keyframes animus-kf-abc {} @layer anm-global {} .x { animation-name: animus-kf-abc }';
    expect(() =>
      assertKeyframesExtracted(css, { insideLayer: 'anm-global' })
    ).toThrow(/outside @layer anm-global/);
  });

  it('fails when insideLayer block is entirely absent', () => {
    const css =
      '@keyframes animus-kf-abc {} .x { animation-name: animus-kf-abc }';
    expect(() =>
      assertKeyframesExtracted(css, { insideLayer: 'anm-global' })
    ).toThrow(/no @layer anm-global block was found/);
  });

  it('honors minBlocks threshold', () => {
    const css =
      '@keyframes animus-kf-abc {} .x { animation-name: animus-kf-abc }';
    expect(() => assertKeyframesExtracted(css, { minBlocks: 2 })).toThrow(
      /expected at least 2/
    );
  });

  it('honors custom namePrefix', () => {
    const css = '@keyframes custom-abc {} .x { animation-name: custom-abc }';
    expect(() =>
      assertKeyframesExtracted(css, { namePrefix: 'custom-' })
    ).not.toThrow();
    // And default prefix should fail on the same CSS.
    expect(() => assertKeyframesExtracted(css)).toThrow(
      /expected at least 1 @keyframes block/
    );
  });

  it('tolerates multiple @layer anm-global blocks (chunk concatenation)', () => {
    const css =
      '@layer anm-global { @keyframes animus-kf-abc {} } @layer anm-global { @keyframes animus-kf-def {} } .x { animation-name: animus-kf-abc } .y { animation-name: animus-kf-def }';
    expect(() =>
      assertKeyframesExtracted(css, {
        insideLayer: 'anm-global',
        minBlocks: 2,
        minReferences: 2,
      })
    ).not.toThrow();
  });

  it('accepts minified CSS (no whitespace around braces)', () => {
    const css =
      '@layer anm-global{@keyframes animus-kf-abc{0%{opacity:0}100%{opacity:1}}}.animus-x{animation-name:animus-kf-abc}';
    expect(() =>
      assertKeyframesExtracted(css, { insideLayer: 'anm-global' })
    ).not.toThrow();
  });
});
