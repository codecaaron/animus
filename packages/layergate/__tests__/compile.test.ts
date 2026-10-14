import { dirname, join, normalize } from 'node:path';
import { describe, expect, test } from 'vitest';

import { compileUnit } from '../src';

import type { CompileOptions } from '../src';

/** Compiles `root` from an in-memory file set. */
function compile(
  files: Record<string, string>,
  root: string,
  options: Partial<CompileOptions> = {}
) {
  return compileUnit([root], {
    layer: 'vendor',
    order: ['vendor', 'app'],
    resolve: (specifier, importer) => {
      const file = normalize(join(dirname(importer), specifier));
      return file in files ? file : null;
    },
    read: (file) => files[file]!,
    ...options,
  });
}

/** Whitespace-insensitive CSS, for comparing structure. */
const flat = (css: string) =>
  css
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};])\s*/g, '$1')
    .trim();

describe('compileUnit', () => {
  // Contract: each file is decided on its own, before assembly. An opted-out
  // file's own rules stay outside the layer, under its import's conditions;
  // its child and its siblings keep their own decisions (E5: a parent's
  // decision never reaches a child flattened into it).
  test('decides each file on its own', async () => {
    const files = {
      '/p/root.css':
        '@import "./out.css" layer(x);\n@import "./sibling.css";\n.root{color:red}\n',
      '/p/out.css': '@import "./child.css";\n.out{color:green}\n',
      '/p/child.css': '.child{color:blue}\n',
      '/p/sibling.css': '.sibling{color:gray}\n',
    };
    const unit = await compile(files, '/p/root.css', {
      quarantined: (file) => file !== '/p/out.css',
    });
    expect(flat(unit.css)).toBe(
      flat(`@layer vendor, app;
        @layer vendor{@layer x{.child{color:blue}}}
        @layer x{.out{color:green}}
        @layer vendor{.sibling{color:gray}}
        @layer vendor{.root{color:red}}`)
    );
    expect(unit.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'layergate.opt-out', file: '/p/out.css' })
    );
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
    const names = [
      ...first.css.matchAll(/@layer (layergate-anonymous-[0-9a-f]+)/g),
    ].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect((await compile(files, '/p/root.css')).css).toBe(first.css);
  });

  // Contract: statements are classified by their decoded name, so an
  // escaped at-keyword is the rule it spells (E7).
  test('reads escaped at-keywords by meaning', async () => {
    const files = {
      '/p/root.css':
        '@l\\61yer one, two;\n@\\69mport "./a.css";\n.r{color:red}\n',
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
      '/p/css/root.css':
        '@import "../parts/grid.css";\n.r { background: url(img/r.png) ; color : RED !important }\n',
      '/p/parts/grid.css':
        '.g{background:url(../img/a.png?v=1#x);src:url("./f.woff2");mask:image-set("m.png" 1x);b:url(/abs.png);c:url(data:x);d:url(https://e/x.png)}\n',
    };
    const unit = await compile(files, '/p/css/root.css');
    expect(unit.css).toContain(
      '.r { background: url(img/r.png) ; color : RED !important }'
    );
    expect(unit.css).toContain(
      '.g{background:url(../img/a.png?v=1#x);src:url("../parts/f.woff2");mask:image-set("../parts/m.png" 1x);b:url(/abs.png);c:url(data:x);d:url(https://e/x.png)}'
    );
  });

  // Contract: an import's media, supports and layer wrap its stylesheet, in
  // that order, inside the quarantine layer.
  test('wraps an import in its conditions', async () => {
    const files = {
      '/p/root.css':
        '@import url("./c.css") layer(named.inner) supports(display: grid) screen and (min-width: 10px);\n',
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
  // The layers keep the order the original cascade creates them in, though
  // the hoisted import would create its own first.
  test('hoists a remote import into its layer, keeping layer order', async () => {
    const unit = await compile(
      {
        '/p/root.css':
          '@import "./a.css" layer(first);\n@import "https://fonts.example/f.css" layer(second) print;\n.r{color:red}\n',
        '/p/a.css': '.a{color:blue}\n',
      },
      '/p/root.css'
    );
    expect(unit.css.split('\n').slice(0, 3)).toEqual([
      '@layer vendor, app;',
      '@layer vendor, vendor.first, vendor.second;',
      '@import url("https://fonts.example/f.css") layer(vendor.second) print;',
    ]);
    expect(unit.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'layergate.remote' })
    );
  });

  // Contract: nested media conditions on a remote import's way are joined
  // when each is a bare condition.
  test('joins bare media conditions on a remote import', async () => {
    const unit = await compile(
      {
        '/p/root.css': '@import "./m.css" (min-width: 1px);\n',
        '/p/m.css': '@import "https://e/x.css" (max-width: 9px);\n',
      },
      '/p/root.css'
    );
    expect(unit.css).toContain(
      '@import url("https://e/x.css") layer(vendor) (min-width: 1px) and (max-width: 9px);'
    );
  });

  // Contract: an anonymous import layer is one per import occurrence: the
  // same file reached by two import chains creates two layers, as in the
  // browser (E6).
  test('gives each import occurrence its own anonymous layer', async () => {
    const files = {
      '/p/root.css': '@import "./p1.css";\n@import "./p2.css";\n',
      '/p/p1.css': '@import "./mid.css";\n',
      '/p/p2.css': '@import "./mid.css";\n',
      '/p/mid.css': '@import "./leaf.css" layer;\n',
      '/p/leaf.css': '.leaf{color:red}\n',
    };
    const unit = await compile(files, '/p/root.css');
    const names = [
      ...unit.css.matchAll(/@layer (layergate-anonymous-[0-9a-f]+) \{/g),
    ].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  // Contract: a stylesheet imported twice applies at each import, so the
  // later import decides the cascade, as in the browser.
  test('applies a repeated import at each occurrence', async () => {
    const unit = await compile(
      {
        '/p/root.css':
          '@import "./a.css";\n@import "./b.css";\n@import "./a.css";\n',
        '/p/a.css': '.x{color:red}\n',
        '/p/b.css': '.x{color:blue}\n',
      },
      '/p/root.css'
    );
    expect(unit.css.lastIndexOf('color:red')).toBeGreaterThan(
      unit.css.indexOf('color:blue')
    );
  });

  // Contract: a leading byte-order mark is no content: the imports after it
  // are inlined and it never reaches the output. An import past other rules
  // is reported, since a browser ignores it.
  test('reads past a byte-order mark and reports an ignored import', async () => {
    const unit = await compile(
      {
        '/p/root.css':
          '\ufeff@import "./a.css";\n.r{color:red}\n@import "./late.css";\n',
        '/p/a.css': '.a{color:blue}\n',
      },
      '/p/root.css'
    );
    expect(unit.css).toContain('.a{color:blue}');
    expect(unit.css).not.toContain('\ufeff');
    expect(unit.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'layergate.ignored-import', line: 3 })
    );
  });

  // Contract: what the layer cannot hold back is kept and reported, never
  // stripped.
  test('reports important declarations and animations, and keeps them', async () => {
    const css =
      '.a{color:red ! IMPORTANT;animation:spin 1s}\n@-webkit-keyframes spin{to{opacity:0}}\n';
    const unit = await compile({ '/p/root.css': css }, '/p/root.css');
    expect(unit.css).toContain(css);
    expect(
      unit.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.line])
    ).toEqual([
      ['layergate.important', 1],
      ['layergate.animation', 2],
      ['layergate.animation', 1],
    ]);
  });

  test('reports an import it cannot resolve', async () => {
    const unit = await compile(
      { '/p/root.css': '@import "./missing.css";\n' },
      '/p/root.css'
    );
    expect(unit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'layergate.unresolved',
        severity: 'error',
        line: 1,
      })
    );
  });
});
