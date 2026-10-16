import { describe, expect, test } from 'vitest';

import {
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  unbundledComponents,
} from '../pipeline/bundle-removal';

import type { ManifestComponentDescriptor } from '../pipeline/manifest-schema';

const component = (
  binding: string,
  className: string,
  extendsFrom: string | null = null
) =>
  // SAFETY: the functions under test read only `binding`, `class_name` and
  // `extends_from` of a descriptor.
  ({
    binding,
    class_name: className,
    extends_from: extendsFrom,
  }) as ManifestComponentDescriptor;

describe('removeComponentRules', () => {
  // Contract: a rule goes only where every selector requires an element
  // carrying a removed component's class, or a class derived from it; a
  // class inside `:not()`, `:is()`, `:where()` or `:has()` requires nothing,
  // and every other rule, keyframes included, stays whole.
  test('removes only the rules every selector of which needs a removed class', () => {
    const css = [
      '@layer anm-base{.dead{color:red}.live{color:blue}}',
      '@layer anm-variants{.dead--size-sm{padding:1px}.live--size-sm{padding:2px}}',
      '@layer anm-compounds{.live--x .dead{margin:0}.dead,.live{order:1}}',
      '@layer anm-states{.live:not(.dead){gap:1px}:is(.dead,.live) span{gap:2px}}',
      '@layer anm-system{.u_a{gap:4px}}',
      '@keyframes dead{to{opacity:1}}',
    ].join('');
    const out = removeComponentRules(css, new Set(['dead']), { targets: {} });
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/\.dead\{|\.dead--size-sm|\.live--x \.dead/);
    for (const kept of [
      '.live{color:#00f}',
      '.live--size-sm{padding:2px}',
      '.dead,.live{order:1}',
      '.live:not(.dead){gap:1px}',
      ':is(.dead,.live) span{gap:2px}',
      '.u_a{gap:4px}',
      '@keyframes dead',
    ]) {
      expect(out).toContain(kept);
    }
    expect(
      removeComponentRules(css, new Set(['other']), { targets: {} })
    ).toBeNull();
  });
});

describe('unbundledComponents', () => {
  // Contract: a component is removed only when no output file names its
  // class, or a class derived from it; `staticCss` keeps one by binding,
  // and a kept extension keeps every parent.
  test('keeps what the output names, staticCss declares, or a kept extension extends', () => {
    const components = {
      'a::Shipped': component('Shipped', 'c-shipped'),
      'a::Derived': component('Derived', 'c-derived'),
      'a::Forced': component('Forced', 'c-forced'),
      'a::Root': component('Root', 'c-root'),
      'a::Parent': component('Parent', 'c-parent', 'a::Root'),
      'a::Child': component('Child', 'c-child', 'a::Parent'),
      'a::Gone': component('Gone', 'c-gone'),
    };
    const shipped = shippedClasses(
      ['z(Tag,"c-shipped",{}); x=`${"c-derived--size-sm"}`; y("c-child")'],
      Object.values(components).map((c) => c.class_name)
    );
    const removed = unbundledComponents(
      components,
      shipped,
      new Set(['Forced'])
    );
    expect([...removed.keys()]).toEqual(['a::Gone']);
  });
});

describe('unbundledComponents by class', () => {
  // Contract: a class any kept component owns is never removed, though
  // another id that carries it is unkept: copies of one definition share
  // their class, and with it their CSS.
  test('a class any kept component owns is never removed', () => {
    const components = {
      'one::Parent': component('Parent', 'c-parent'),
      'two::Parent': component('Parent', 'c-parent'),
      'a::Child': component('Child', 'c-child', 'one::Parent'),
      'a::Gone': component('Gone', 'c-gone'),
    };
    const removed = unbundledComponents(
      components,
      new Set(['c-child']),
      new Set()
    );
    expect([...removed.keys()]).toEqual(['a::Gone']);
  });
});

describe('shippedClasses', () => {
  // Contract: removal keeps any candidate whose literal it cannot prove
  // absent: a name found anywhere in the output, even inside a longer
  // token, and a name with a character an output may escape (`é`, `$`),
  // found or not.
  test('removal keeps any candidate whose literal it cannot prove absent', () => {
    const names = [
      'animus-Café-a20deb9c',
      'animus-$Box-5ad1e15c',
      'animus-Inside-11111111',
      'animus-Gone-22222222',
    ];
    const shipped = shippedClasses(
      ['x="xanimus-Inside-11111111z"; y=`animus-Caf\\u00e9-a20deb9c`'],
      names
    );
    expect([...shipped].sort()).toEqual(
      [
        'animus-$Box-5ad1e15c',
        'animus-Café-a20deb9c',
        'animus-Inside-11111111',
      ].sort()
    );
  });
});

describe('outputEvidence', () => {
  // Contract: every output file but the skipped style sheets and media is
  // evidence, and so is the decoded payload of each data URL in one, nested
  // too; bytes that are no UTF-8 text, in a file or a data URL, are named
  // as unreadable, which keeps every component.
  test('every output text and decoded data URL is evidence, and unreadable data keeps everything', () => {
    const inner = Buffer.from('{"className":"c-nested"}').toString('base64');
    const json = Buffer.from(
      `{"className":"c-json","more":"data:application/json;base64,${inner}"}`
    ).toString('base64');
    const { texts, unreadable } = outputEvidence(
      [
        {
          fileName: 'assets/index.js',
          code: `fetch("data:application/json;base64,${json}")`,
        },
        {
          fileName: 'assets/classes.json',
          bytes: Buffer.from('{"className":"c-asset"}'),
        },
        {
          fileName: 'assets/page.html',
          code: '<a href="data:text/plain,c-percent%2Dx">',
        },
        { fileName: 'assets/animus-components.css', code: '.c-skipped{}' },
        { fileName: 'assets/logo.png', bytes: new Uint8Array([0xff, 0xfe]) },
      ],
      new Set(['assets/animus-components.css'])
    );
    expect(unreadable).toBeNull();
    // A template substitution is no payload: its text is evidence where it
    // is written.
    expect(
      outputEvidence(
        [
          {
            fileName: 'a.js',
            code: 'x=`data:text/html;charset=UTF-8;base64,${ya}`;y=`data:application/json;base64,${zb}`',
          },
        ],
        new Set()
      ).unreadable
    ).toBeNull();
    const all = texts.map(({ text }) => text).join('\n');
    for (const name of ['c-json', 'c-nested', 'c-asset', 'c-percent-x']) {
      expect(all).toContain(name);
    }
    expect(all).not.toContain('c-skipped');
    expect(
      outputEvidence(
        [
          {
            fileName: 'assets/blob.bin',
            bytes: new Uint8Array([0xff, 0xfe]),
          },
        ],
        new Set()
      ).unreadable
    ).toBe('assets/blob.bin');
    expect(
      outputEvidence(
        [
          {
            fileName: 'a.js',
            code: `x="data:application/octet-stream;base64,${Buffer.from([0xff, 0xfe]).toString('base64')}"`,
          },
        ],
        new Set()
      ).unreadable
    ).toBe('a data URL in a.js');
  });
});
