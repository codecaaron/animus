import { dirname, join, normalize } from 'node:path';
import { describe, expect, test } from 'vitest';

import { compileUnit } from '../src';

import type { CompileOptions } from '../src';

/** Compiles `root` from an in-memory file set. */
function compile(files: Record<string, string>, root: string, options: Partial<CompileOptions> = {}) {
  return compileUnit(root, {
    layer: 'vendor',
    order: ['vendor', 'app'],
    resolve: (specifier, importer) => {
      const file = normalize(join(dirname(importer), specifier));
      return file in files ? file : null;
    },
    read: (file) => files[file]!,
    quarantined: () => true,
    ...options,
  });
}

/** Whitespace-insensitive CSS, for comparing structure. */
const flat = (css: string) => css.replace(/\s+/g, ' ').replace(/\s*([{};])\s*/g, '$1').trim();

describe('compileUnit', () => {
  // Contract: each file is decided on its own, before assembly. An opted-out
  // file's own rules stay outside the layer, under its import's conditions;
  // its child and its siblings keep their own decisions (E5: a parent's
  // decision never reaches a child flattened into it).
  test('decides each file on its own', async () => {
    const files = {
      '/p/root.css': '@import "./out.css" layer(x);\n@import "./sibling.css";\n.root{color:red}\n',
      '/p/out.css': '@import "./child.css";\n.out{color:green}\n',
      '/p/child.css': '.child{color:blue}\n',
      '/p/sibling.css': '.sibling{color:gray}\n',
    };
    const unit = await compile(files, '/p/root.css', { quarantined: (file) => file !== '/p/out.css' });
    expect(flat(unit.css)).toBe(
      flat(`@layer vendor, app;
        @layer vendor{@layer x{.child{color:blue}}}
        @layer x{.out{color:green}}
        @layer vendor{.sibling{color:gray}}
        @layer vendor{.root{color:red}}`)
    );
    expect(unit.diagnostics).toContainEqual(expect.objectContaining({ code: 'layergate.opt-out', file: '/p/out.css' }));
  });

  // Contract: an anonymous import layer stays its own layer: a private name
  // per import site, never the quarantine layer itself (E6), stable across
  // builds and distinct between sites.
  test('keeps an anonymous import layer its own', async () => {
    const files = {
      '/p/root.css': '@import "./a.css" layer;\n@import "./a.css" layer;\n',
      '/p/a.css': '.a{display:inline}\n',
    };
    const first = await compile(files, '/p/root.css');
    const names = [...first.css.matchAll(/@layer (layergate-anonymous-[0-9a-f]+)/g)].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect((await compile(files, '/p/root.css')).css).toBe(first.css);
  });

  // Contract: statements are classified by their decoded name, so an
  // escaped at-keyword is the rule it spells (E7).
  test('reads escaped at-keywords by meaning', async () => {
    const files = {
      '/p/root.css': '@l\\61yer one, two;\n@\\69mport "./a.css";\n.r{color:red}\n',
      '/p/a.css': '.a{color:blue}\n',
    };
    const unit = await compile(files, '/p/root.css');
    expect(flat(unit.css)).toBe(
      flat(`@layer vendor, app;
        @layer vendor{@l\\61yer one, two;}
        @layer vendor{.a{color:blue}}
        @layer vendor{.r{color:red}}`)
    );
  });

  // Contract: a file's own text is kept as written; only a relative URL in a
  // file away from the finished stylesheet changes, to resolve from it, with
  // its query and fragment.
  test('keeps text as written and rebases relative URLs', async () => {
    const files = {
      '/p/css/root.css': '@import "../parts/grid.css";\n.r { background: url(img/r.png) ; color : RED !important }\n',
      '/p/parts/grid.css':
        '.g{background:url(../img/a.png?v=1#x);src:url("./f.woff2");mask:image-set("m.png" 1x);b:url(/abs.png);c:url(data:x);d:url(https://e/x.png)}\n',
    };
    const unit = await compile(files, '/p/css/root.css');
    expect(unit.css).toContain('.r { background: url(img/r.png) ; color : RED !important }');
    expect(unit.css).toContain(
      '.g{background:url(../img/a.png?v=1#x);src:url("../parts/f.woff2");mask:image-set("../parts/m.png" 1x);b:url(/abs.png);c:url(data:x);d:url(https://e/x.png)}'
    );
  });

  // Contract: an import's media, supports and layer wrap its stylesheet, in
  // that order, inside the quarantine layer.
  test('wraps an import in its conditions', async () => {
    const files = {
      '/p/root.css': '@import url("./c.css") layer(named.inner) supports(display: grid) screen and (min-width: 10px);\n',
      '/p/c.css': '.c{display:grid}\n',
    };
    const unit = await compile(files, '/p/root.css');
    expect(flat(unit.css)).toBe(
      flat(`@layer vendor, app;
        @layer vendor{@media screen and (min-width: 10px){@supports (display: grid){@layer named.inner{.c{display:grid}}}}}`)
    );
  });

  // Contract: a remote import stays remote, hoisted ahead of every rule, in
  // the layer of the file that imports it, and is reported as uninspected.
  test('hoists a remote import into its layer', async () => {
    const unit = await compile(
      { '/p/root.css': '@import "https://fonts.example/f.css" layer(fonts) print;\n.r{color:red}\n' },
      '/p/root.css'
    );
    expect(unit.css.split('\n').slice(0, 2)).toEqual([
      '@layer vendor, app;',
      '@import url("https://fonts.example/f.css") layer(vendor.fonts) print;',
    ]);
    expect(unit.diagnostics).toContainEqual(expect.objectContaining({ code: 'layergate.remote' }));
  });

  // Contract: what the layer cannot hold back is kept and reported, never
  // stripped.
  test('reports important declarations and animations, and keeps them', async () => {
    const css = '.a{color:red ! IMPORTANT;animation:spin 1s}\n@-webkit-keyframes spin{to{opacity:0}}\n';
    const unit = await compile({ '/p/root.css': css }, '/p/root.css');
    expect(unit.css).toContain(css);
    expect(unit.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.line])).toEqual([
      ['layergate.important', 1],
      ['layergate.animation', 2],
      ['layergate.animation', 1],
    ]);
  });

  test('reports an import it cannot resolve', async () => {
    const unit = await compile({ '/p/root.css': '@import "./missing.css";\n' }, '/p/root.css');
    expect(unit.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'layergate.unresolved', severity: 'error', line: 1 })
    );
  });
});
