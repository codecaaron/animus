import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, test } from 'vitest';

import { layergate } from '../src/vite';

import type { LayergateOptions } from '../src/vite';
import type { Rolldown } from 'vite';

const root = mkdtempSync(join(tmpdir(), 'layergate-vite-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files: Record<string, string> = {
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
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

async function builtCss(main: string, options: LayergateOptions): Promise<string> {
  writeFileSync(join(root, 'main.js'), main);
  const output = (await build({
    root,
    logLevel: 'silent',
    configFile: false,
    plugins: [layergate(options)],
    build: { write: false, minify: false },
  })) as Rolldown.RolldownOutput;
  return output.output
    .filter((item): item is Rolldown.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((asset) => String(asset.source))
    .join('\n');
}

const count = (css: string, text: string) => css.split(text).length - 1;

/** The layer statement around `selector`'s rule, or null for none. */
function layerOf(css: string, selector: string): string | null {
  const at = css.indexOf(selector);
  let depth = 0;
  for (let index = at; index >= 0; index--) {
    if (css[index] === '}') depth += 1;
    else if (css[index] === '{') {
      if (depth === 0) {
        const head = css.slice(css.lastIndexOf('\n', index - 1) + 1, index).trim();
        if (head.startsWith('@layer')) return head.slice('@layer'.length).trim();
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
});
