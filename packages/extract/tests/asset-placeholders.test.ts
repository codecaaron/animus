import { describe, expect, test } from 'vitest';

import {
  ASSET_PLACEHOLDER_PREFIX,
  findAssetSpecifiers,
  substituteAssetPlaceholders,
} from '../pipeline/asset-placeholders';

/**
 * Shared asset() placeholder mechanics (global-styles-system). D5 pins the
 * placeholder format as `animus-asset:<specifier>` verbatim, so fidelity for
 * specifiers carrying whitespace or parentheses lives entirely in the
 * quoted-url scan and the delimiter-anchored substitution.
 */

test('the scanner-side scheme matches the producer constant in @animus-ui/system', () => {
  // packages/system/__tests__/global-styles-font-faces.test.ts pins the
  // producer constant to the same literal — the two assertions together tie
  // the wire format across the package boundary without extract taking a
  // runtime dependency on system.
  expect(ASSET_PLACEHOLDER_PREFIX).toBe('animus-asset:');
});

describe('findAssetSpecifiers', () => {
  test('quoted url() form carries the full specifier, whitespace and parens included', () => {
    const css =
      "@font-face { src: url('animus-asset:@acme/fonts/My Font(Regular).woff2') format('woff2'); }";
    expect(findAssetSpecifiers(css)).toEqual([
      '@acme/fonts/My Font(Regular).woff2',
    ]);
  });

  test('the truncated tail of a quoted specifier is never a bogus extra specifier', () => {
    const css =
      "src: url('animus-asset:@acme/a b.woff2'); background: url('animus-asset:@acme/plain.woff2');";
    expect(findAssetSpecifiers(css).sort()).toEqual([
      '@acme/a b.woff2',
      '@acme/plain.woff2',
    ]);
  });

  test('bare unquoted form still scans up to CSS delimiters', () => {
    const css = 'src: url(animus-asset:@acme/tokens/inter.woff2);';
    expect(findAssetSpecifiers(css)).toEqual(['@acme/tokens/inter.woff2']);
  });

  test('duplicate references dedupe', () => {
    const css =
      "url('animus-asset:@acme/x.woff2') url('animus-asset:@acme/x.woff2')";
    expect(findAssetSpecifiers(css)).toEqual(['@acme/x.woff2']);
  });
});

describe('substituteAssetPlaceholders', () => {
  test('replaces whitespace/paren specifiers inside quotes', () => {
    const css = "src: url('animus-asset:@acme/fonts/My Font(Regular).woff2');";
    const out = substituteAssetPlaceholders(
      css,
      new Map([
        ['@acme/fonts/My Font(Regular).woff2', '/assets/font-abc.woff2'],
      ])
    );
    expect(out).toBe("src: url('/assets/font-abc.woff2');");
  });

  test('a specifier that prefixes a longer one never clobbers it', () => {
    const css =
      "url('animus-asset:@acme/a.woff') url('animus-asset:@acme/a.woff2')";
    const out = substituteAssetPlaceholders(
      css,
      new Map([
        ['@acme/a.woff', '/short.woff'],
        ['@acme/a.woff2', '/long.woff2'],
      ])
    );
    expect(out).toBe("url('/short.woff') url('/long.woff2')");
  });

  test('unmapped specifiers keep their placeholder for the caller to gate', () => {
    const css = "url('animus-asset:@acme/unknown.woff2')";
    expect(
      substituteAssetPlaceholders(css, new Map([['@acme/other.woff2', '/x']]))
    ).toBe(css);
  });

  test('substitution values containing $ are inserted literally', () => {
    const css = "url('animus-asset:@acme/x.woff2')";
    const out = substituteAssetPlaceholders(
      css,
      new Map([['@acme/x.woff2', "__VITE_ASSET__a$'b__"]])
    );
    expect(out).toBe("url('__VITE_ASSET__a$'b__')");
  });
});
