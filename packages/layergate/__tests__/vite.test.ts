import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { build, createServer } from 'vite';
import { afterAll, describe, expect, test, vi } from 'vitest';

import { layergate } from '../src/vite';

import type { LayergateOptions } from '../src/vite';
import type { Rolldown } from 'vite';

const root = mkdtempSync(join(tmpdir(), 'layergate-vite-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files = {
  'package.json': '{"name":"app","private":true,"type":"module"}',
  'index.html': '<!doctype html><script type="module" src="/main.js"></script>',
  'node_modules/owned/package.json': '{"name":"owned","version":"1.0.0"}',
  'node_modules/owned/a.css': '@import "./nested.css";\n.owned-a{color:red}\n',
  'node_modules/owned/nested.css': '.owned-nested{color:red}\n',
  'node_modules/other/package.json': '{"name":"other","version":"1.0.0"}',
  'node_modules/other/b.css': '.other-b{color:red}\n',
  'styles/declared.css': '.declared{color:red}\n',
  'styles/app.css': '.app-own{color:red}\n',
  'styles/x.module.css': '.moduled{color:red}\n',
  'styles/first.css': '.first{color:red}\n',
  'styles/shared.css': '.shared{color:red}\n',
  'styles/app-imports.css':
    '@import "./shared.css";\n@import "owned/a.css";\n.app-own-rule{color:red}\n',
  'styles/second.css': '.second{color:red}\n',
  'styles/uses-style-field.css': '@import "stylepkg";\n',
  'node_modules/stylepkg/package.json':
    '{"name":"stylepkg","version":"1.0.0","main":"index.js","style":"style.css"}',
  'node_modules/stylepkg/index.js': 'export const script = 1;\n',
  'node_modules/stylepkg/style.css': '.from-style{color:red}\n',
} satisfies Record<string, string>;
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

async function builtCss(
  main: string,
  options: LayergateOptions,
  at: { root?: string; preserveSymlinks?: boolean } = {}
): Promise<string> {
  writeFileSync(join(root, 'main.js'), main);
  // SAFETY: a build with no watcher and one environment returns one output.
  const output = (await build({
    root: at.root ?? root,
    logLevel: 'silent',
    configFile: false,
    resolve: { preserveSymlinks: at.preserveSymlinks ?? false },
    plugins: [layergate(options)],
    build: { write: false, minify: false },
  })) as Rolldown.RolldownOutput;
  return output.output
    .filter(
      (item): item is Rolldown.OutputAsset =>
        item.type === 'asset' && item.fileName.endsWith('.css')
    )
    .map((asset) => String(asset.source))
    .join('\n');
}

const count = (css: string, text: string) => css.split(text).length - 1;

/** The layer statement around `selector`'s rule, or null for none. */
function layerOf(css: string, selector: string): string | null {
  return layerAt(css, css.indexOf(selector));
}

/** The layer statement around the rule at offset `at`, or null for none. */
function layerAt(css: string, at: number): string | null {
  let depth = 0;
  for (let index = at; index >= 0; index--) {
    if (css[index] === '}') depth += 1;
    else if (css[index] === '{') {
      if (depth === 0) {
        const head = css
          .slice(css.lastIndexOf('\n', index - 1) + 1, index)
          .trim();
        if (head.startsWith('@layer'))
          return head.slice('@layer'.length).trim();
      } else depth -= 1;
    }
  }
  return null;
}

describe('layergate/vite', () => {
  // Contract: one delivery per stylesheet. A declared sheet is delivered by
  // `virtual:layergate`, and an ordinary import of it, by any spelling,
  // reaches the same unit rather than a second, unlayered copy.
  test('delivers a declared and imported sheet once', async () => {
    const css = await builtCss(
      "import 'virtual:layergate';\nimport './styles/declared.css';\nimport 'owned/a.css';\nimport './node_modules/owned/a.css';\n",
      { sheets: ['./styles/declared.css', 'owned/a.css'] }
    );
    expect(count(css, '.declared{')).toBe(1);
    expect(count(css, '.owned-a{')).toBe(1);
    expect(count(css, '.owned-nested{')).toBe(1);
    expect(layerOf(css, '.declared{')).toBe('vendor');
    expect(layerOf(css, '.owned-nested{')).toBe('vendor');
  });

  // Contract: only what the plan names is owned. A listed dependency's CSS
  // imported from JS is layered; another package's, the app's own CSS and
  // CSS Modules are left to Vite.
  test('owns only declared sheets and listed dependencies', async () => {
    const css = await builtCss(
      "import 'owned/a.css';\nimport 'other/b.css';\nimport './styles/app.css';\nimport s from './styles/x.module.css';\nconsole.log(s);\n",
      { dependencies: ['owned'] }
    );
    expect(layerOf(css, '.owned-a{')).toBe('vendor');
    expect(layerOf(css, '.other-b{')).toBeNull();
    expect(layerOf(css, '.app-own{')).toBeNull();
    expect(css).toMatch(/\._moduled_[\w-]+\{/);
    expect(layerOf(css, '._moduled_')).toBeNull();
  });

  // Contract: no unlayered copy of an owned file escapes through a
  // stylesheet Vite loads itself: an app sheet's own `@import` of a declared
  // sheet or an owned dependency is inlined layered, its own rules stay
  // unlayered. The declared copy and this one may both remain.
  test('layers an owned file an app sheet imports', async () => {
    const css = await builtCss(
      "import 'virtual:layergate';\nimport './styles/app-imports.css';\n",
      { sheets: ['./styles/shared.css'], dependencies: ['owned'] }
    );
    const shared = [...css.matchAll(/\.shared\{/g)].map((match) => match.index);
    expect(shared.length).toBeGreaterThan(0);
    for (const at of shared) expect(layerAt(css, at!)).toBe('vendor');
    expect(layerOf(css, '.owned-a{')).toBe('vendor');
    expect(layerOf(css, '.app-own-rule{')).toBeNull();
  });

  // Contract: declared sheets come first, in their declared order, even
  // when the app imports a later one before anything imports
  // `virtual:layergate`.
  test('keeps the declared order against an earlier authored import', async () => {
    const css = await builtCss("import './styles/second.css';\n", {
      sheets: ['./styles/first.css', './styles/second.css'],
    });
    expect(count(css, '.second{')).toBe(1);
    expect(css.indexOf('.first{')).toBeGreaterThan(-1);
    expect(css.indexOf('.first{')).toBeLessThan(css.indexOf('.second{'));
  });

  // Contract: the app is the app by realpath: reached through a symlinked
  // root under `resolve.preserveSymlinks`, its own CSS is not a dependency.
  test('keeps app CSS its own through a symlinked root', async () => {
    const linked = join(mkdtempSync(join(tmpdir(), 'layergate-link-')), 'app');
    symlinkSync(realpathSync(root), linked);
    const css = await builtCss(
      "import './styles/app.css';\nimport 'owned/a.css';\n",
      { dependencies: true },
      { root: linked, preserveSymlinks: true }
    );
    expect(layerOf(css, '.app-own{')).toBeNull();
    expect(layerOf(css, '.owned-a{')).toBe('vendor');
  });

  // Contract: an owned sheet's `@import` of a package resolves as a CSS
  // import does: its `style` entry, never its script entry.
  test('resolves a nested package import as CSS', async () => {
    const css = await builtCss("import 'virtual:layergate';\n", {
      sheets: ['./styles/uses-style-field.css'],
    });
    expect(css).toContain('.from-style{');
    expect(css).not.toContain('script');
  });
});

describe('layergate/vite in dev', () => {
  // Contract: an installed owned file is watched while a finished
  // stylesheet reads it: one its stylesheet stops importing is no longer
  // watched, and one deleted and created again is watched again.
  test('watches the installed files a unit reads, and only those', async () => {
    const entry = join(root, 'node_modules/owned/a.css');
    const nested = join(root, 'node_modules/owned/nested.css');
    const server = await createServer({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [layergate({ sheets: ['owned/a.css'] })],
      server: { middlewareMode: true, ws: false },
    });
    const changes: string[] = [];
    server.watcher.on('change', (file) => changes.push(file));
    // The watcher reports files by realpath.
    const real = (file: string) =>
      join(realpathSync(dirname(file)), basename(file));
    const changed = (file: string) => changes.includes(real(file));
    try {
      const environment = server.environments.client;
      const id = `${realpathSync(entry)}?layergate`;
      await environment.transformRequest(id);

      // Deleted and created again, the file is watched again.
      unlinkSync(nested);
      await vi.waitUntil(() => changed(nested), { timeout: 5000 });
      changes.length = 0;
      writeFileSync(nested, '.owned-recreated{color:red}\n');
      await vi.waitUntil(() => changed(nested), { timeout: 5000 });

      // Dropped from the graph, it is no longer watched.
      writeFileSync(entry, '.owned-a{color:red}\n');
      await vi.waitUntil(() => changed(entry), { timeout: 5000 });
      await vi.waitUntil(
        () => !environment.moduleGraph.getModuleById(id)?.transformResult,
        { timeout: 5000 }
      );
      await environment.transformRequest(id);
      changes.length = 0;
      writeFileSync(nested, '.owned-nested{color:blue}\n');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(changed(nested)).toBe(false);
    } finally {
      writeFileSync(entry, files['node_modules/owned/a.css']);
      writeFileSync(nested, files['node_modules/owned/nested.css']);
      await server.close();
    }
  });
});
