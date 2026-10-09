import { describe, expect, test } from 'vitest';

import {
  ASSET_PLACEHOLDER_PREFIX,
  findAssetSpecifiers,
  findSheetAssetSpecifiers,
  generatedModuleCode,
  reportSurvivingAssetPlaceholders,
  substituteAssetPlaceholders,
  UNSUBSTITUTED_ASSET_CODE,
} from '../pipeline/asset-placeholders';

test('the scanner-side scheme matches the producer constant in @animus-ui/system', () => {
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

  test('placeholder text outside url() is ordinary text', () => {
    const css =
      '.note::after { content: "animus-asset:foo"; } .hero { background: url("animus-asset:@acme/rock.jpg"); }';
    expect(findAssetSpecifiers(css)).toEqual(['@acme/rock.jpg']);
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

  test('placeholder text outside url() is left as written', () => {
    const css =
      '.note::after { content: "animus-asset:@acme/rock.jpg"; } .hero { background: url( "animus-asset:@acme/rock.jpg" ); }';
    expect(
      substituteAssetPlaceholders(
        css,
        new Map([['@acme/rock.jpg', '/rock.1.jpg']])
      )
    ).toBe(
      '.note::after { content: "animus-asset:@acme/rock.jpg"; } .hero { background: url( "/rock.1.jpg" ); }'
    );
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

test('every sheet contributes its specifiers, once each', () => {
  expect(
    findSheetAssetSpecifiers({
      variableCss: ":root{--rock:url('animus-asset:@acme/rock.jpg')}",
      globalCss: "body{background:url('animus-asset:@acme/rock.jpg')}",
      componentCss: ".hero{background:url('animus-asset:@acme/sky.jpg')}",
    }).sort()
  ).toEqual(['@acme/rock.jpg', '@acme/sky.jpg']);
});

describe('reportSurvivingAssetPlaceholders', () => {
  const leaked = ".hero{background:url('animus-asset:@acme/rock.jpg')}";

  test('a placeholder in emitted CSS fails a strict build, naming it and the code', () => {
    expect(() =>
      reportSurvivingAssetPlaceholders(leaked, {
        strict: true,
        warn: () => {},
        prefix: '[animus]',
      })
    ).toThrow(`@acme/rock.jpg (${UNSUBSTITUTED_ASSET_CODE})`);
  });

  test('a non-strict build warns, and clean CSS reports nothing', () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    reportSurvivingAssetPlaceholders(leaked, { warn, prefix: '[animus]' });
    reportSurvivingAssetPlaceholders(
      ".hero{background:url('./assets/rock.1.jpg')}",
      {
        warn,
        prefix: '[animus]',
      }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(UNSUBSTITUTED_ASSET_CODE);
  });
});

describe('generated runtime modules', () => {
  const placeholder = 'url("animus-asset:@acme/rock.jpg")';

  test('carry the dynamic prop configs and every component replacement', () => {
    const code = generatedModuleCode({
      dynamic_props: {
        bgImage: {
          varName: '--animus-bg-image',
          slotClass: 'animus-dyn-bg-image',
          scaleValues: { rock: placeholder },
        },
      },
      components: {
        'a.tsx::Box': { replacement: 'createComponent("div", "a", {})' },
      },
    });
    expect(findAssetSpecifiers(code)).toEqual(['@acme/rock.jpg']);
    expect(code).toContain('createComponent("div", "a", {})');
  });

  test('a placeholder in them fails a strict build, naming where it surfaced', () => {
    expect(() =>
      reportSurvivingAssetPlaceholders(placeholder, {
        strict: true,
        warn: () => {},
        prefix: '[animus]',
        surface: 'generated runtime modules',
      })
    ).toThrow(
      `asset() placeholders reached generated runtime modules unsubstituted: @acme/rock.jpg (${UNSUBSTITUTED_ASSET_CODE})`
    );
  });
});

describe('asset reference referenceForms', () => {
  const urls = new Map([
    ['./hero.png', '/assets/hero.1.png'],
    ['./a.png', '/assets/a.1.png'],
    ['./b.png', '/assets/b.1.png'],
  ]);
  const referenceForms: [string, string, string[], string][] = [
    [
      'an image-set() candidate',
      '.a{background:image-set("animus-asset:./hero.png" 1x)}',
      ['./hero.png'],
      '.a{background:image-set("/assets/hero.1.png" 1x)}',
    ],
    [
      'every image-set() candidate',
      '.a{background:image-set("animus-asset:./a.png" 1x, \'animus-asset:./b.png\' 2x)}',
      ['./a.png', './b.png'],
      '.a{background:image-set("/assets/a.1.png" 1x, \'/assets/b.1.png\' 2x)}',
    ],
    [
      'a -webkit-image-set() candidate',
      '.a{background:-webkit-image-set("animus-asset:./a.png" 1x)}',
      ['./a.png'],
      '.a{background:-webkit-image-set("/assets/a.1.png" 1x)}',
    ],
    [
      'a URL() argument in capitals',
      '.a{background:URL("animus-asset:./hero.png")}',
      ['./hero.png'],
      '.a{background:URL("/assets/hero.1.png")}',
    ],
    [
      'a url() candidate inside image-set()',
      '.a{background:image-set(url(animus-asset:./a.png) 1x, "animus-asset:./b.png" 2x)}',
      ['./a.png', './b.png'],
      '.a{background:image-set(url(/assets/a.1.png) 1x, "/assets/b.1.png" 2x)}',
    ],
  ];

  test.each(referenceForms)(
    '%s is a reference',
    (_form, css, specifiers, substituted) => {
      expect(findAssetSpecifiers(css).sort()).toEqual(specifiers);
      expect(substituteAssetPlaceholders(css, urls)).toBe(substituted);
    }
  );

  test('a string outside url() and image-set() is ordinary text', () => {
    const css = '.a::after{content:"animus-asset:./hero.png"}';
    expect(findAssetSpecifiers(css)).toEqual([]);
    expect(substituteAssetPlaceholders(css, urls)).toBe(css);
  });

  test.each([
    [
      'an unmapped image-set() candidate',
      '.a{background:image-set("animus-asset:./gone.png" 1x)}',
    ],
    [
      'an unmapped URL() argument',
      '.a{background:URL(animus-asset:./gone.png)}',
    ],
    [
      'placeholder text elsewhere in image-set()',
      '.a{background:image-set("/x.png" 1x, local "animus-asset:./gone.png")}',
    ],
  ])('%s left after substitution is reported', (_form, css) => {
    expect(() =>
      reportSurvivingAssetPlaceholders(css, {
        strict: true,
        warn: () => {},
        prefix: '[animus]',
      })
    ).toThrow(`./gone.png (${UNSUBSTITUTED_ASSET_CODE})`);
  });

  test('a content string is not reported', () => {
    const warnings: string[] = [];
    reportSurvivingAssetPlaceholders(
      '.a::after{content:"animus-asset:./note"}',
      { warn: (message) => warnings.push(message), prefix: '[animus]' }
    );
    expect(warnings).toEqual([]);
  });
});
