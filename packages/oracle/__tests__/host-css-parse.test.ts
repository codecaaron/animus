import { describe, expect, it } from 'vitest';

import { parseStylesheet } from '../src/host/animus/css-parse';
import { AnimusAdapterError } from '../src/host/animus/errors';
import { analyzeSelector } from '../src/host/animus/selector';

describe('parseStylesheet — the animus emission dialect', () => {
  it('reads a layered rule with its declarations and at-stack', () => {
    const sheet = parseStylesheet(
      [
        '@layer anm-base {',
        '  @supports (display: grid) {',
        '    @media (min-width: 640px) {',
        '      .a {',
        '        font-size: 1rem;',
        '        color: red !important;',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'anm-base'
    );

    expect(sheet.rules).toHaveLength(1);
    const [rule] = sheet.rules;
    expect(rule.selector).toBe('.a');
    expect(rule.layerPath).toEqual(['anm-base']);
    expect(rule.atStack).toEqual([
      { kind: 'supports', raw: '(display: grid)' },
      { kind: 'media-min-width', px: 640 },
    ]);
    expect(rule.declarations).toEqual([
      { property: 'font-size', value: '1rem', important: false },
      { property: 'color', value: 'red', important: true },
    ]);
  });

  it('splits a selector list into one rule per selector, in order', () => {
    const sheet = parseStylesheet('*, *::before, *::after { margin: 0; }', 'g');

    expect(sheet.rules.map((rule) => rule.selector)).toEqual([
      '*',
      '*::before',
      '*::after',
    ]);
    expect(sheet.rules.map((rule) => rule.orderIndex)).toEqual([0, 1, 2]);
  });

  it('reads both container query spellings and names anonymous ones', () => {
    const sheet = parseStylesheet(
      [
        '@container card (min-width: 400px) { .a { gap: 1px; } }',
        '@container (width >= 600px) { .b { gap: 2px; } }',
      ].join('\n'),
      'anm-base'
    );

    expect(sheet.rules[0].atStack).toEqual([
      { kind: 'container', name: 'card', feature: 'min-width', px: 400 },
    ]);
    expect(sheet.rules[1].atStack).toEqual([
      { kind: 'container', feature: 'width>=', px: 600 },
    ]);
  });

  it('keeps an undecomposable media query as an opaque raw condition', () => {
    const sheet = parseStylesheet(
      '@media screen and (min-width: 400px) { .a { gap: 1px; } }',
      'anm-base'
    );

    expect(sheet.rules[0].atStack).toEqual([
      { kind: 'media-raw', raw: 'screen and (min-width: 400px)' },
    ]);
  });

  it('catalogues keyframes, font-face and layer statements', () => {
    const sheet = parseStylesheet(
      [
        '@layer anm-variants {',
        '  @layer standalone, composed;',
        '  @font-face { font-family: X; src: url(a.woff2) format("woff2"); }',
        '  @keyframes spin { 0% { opacity: 0; } 100% { opacity: 1; } }',
        '  @layer standalone {',
        '    .a { color: red; }',
        '  }',
        '}',
      ].join('\n'),
      'anm-variants'
    );

    expect(sheet.layerStatements).toEqual([
      { layerPath: ['anm-variants'], names: ['standalone', 'composed'] },
    ]);
    expect(sheet.keyframes.map((block) => block.name)).toEqual(['spin']);
    expect(sheet.fontFaces[0].declarations.map((d) => d.property)).toEqual([
      'font-family',
      'src',
    ]);
    expect(sheet.rules).toHaveLength(1);
    expect(sheet.rules[0].layerPath).toEqual(['anm-variants', 'standalone']);
  });

  it('throws on an unmodeled at-rule, naming the construct', () => {
    const corrupt = '@layer anm-base {\n@scope (.a) { .b { color: red; } }\n}';

    expect(() => parseStylesheet(corrupt, 'anm-base')).toThrow(
      AnimusAdapterError
    );
    expect(() => parseStylesheet(corrupt, 'anm-base')).toThrow(/@scope/);
  });

  it('throws rather than silently flattening a nested style rule', () => {
    expect(() =>
      parseStylesheet('.a { color: red; .b { color: blue; } }', 'anm-base')
    ).toThrow(/nested block/);
  });

  it('throws on a declaration with no separator', () => {
    expect(() => parseStylesheet('.a { color red; }', 'anm-base')).toThrow(
      /declaration without a `:` separator/
    );
  });
});

describe('analyzeSelector', () => {
  it('classifies a class compound with a pseudo as class-simple', () => {
    const analyzed = analyzeSelector('.animus-Card-9aa7af5d:focus-visible');

    expect(analyzed.classification).toBe('class-simple');
    expect(analyzed.model.classNames).toEqual(['animus-Card-9aa7af5d']);
    expect(analyzed.model.pseudo).toEqual([':focus-visible']);
    expect(analyzed.model.attributes).toBeUndefined();
  });

  it('classifies any combinator as relational and keeps every class', () => {
    const analyzed = analyzeSelector('.group:hover .animus-GroupItem-32b2d32f');

    expect(analyzed.classification).toBe('relational');
    expect(analyzed.model.classNames).toEqual([
      'group',
      'animus-GroupItem-32b2d32f',
    ]);
  });

  it('records attribute qualifiers and does not split inside them', () => {
    const analyzed = analyzeSelector('[data-active="a b"].x');

    expect(analyzed.classification).toBe('class-simple');
    expect(analyzed.model.attributes).toEqual(['[data-active="a b"]']);
    expect(analyzed.model.classNames).toEqual(['x']);
  });

  it('classifies element and universal selectors as element', () => {
    expect(analyzeSelector('body').classification).toBe('element');
    expect(analyzeSelector('*::before').classification).toBe('element');
    expect(analyzeSelector(':root').classification).toBe('element');
  });
});
