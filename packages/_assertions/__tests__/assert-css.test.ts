import { describe, expect, it } from 'bun:test';

import {
  AssertionError,
  assertClassNameFormat,
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
