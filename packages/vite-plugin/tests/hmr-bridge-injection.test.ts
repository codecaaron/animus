import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';

import {
  BRIDGE_SCRIPT_SRC,
  RESOLVED_BRIDGE_ID,
  VIRTUAL_BRIDGE_ID,
} from '../src/constants';
import { animusExtract } from '../src/index';
import { buildIndexHtmlTags } from '../src/index-html';
import { loadVirtualModule } from '../src/virtual-modules';
import {
  contextWith,
  HTML_HOOK_CONTEXT,
  LAYER_DECLARATION,
} from './index-html-context';

import type { HtmlTagDescriptor } from 'vite';

/**
 * HMR bridge delivery (openspec: dev-stylesheet-management, "HMR bridge
 * auto-injected in dev mode"): TWO dev paths, none in production. The
 * `transformIndexHtml` tag fires once per SERVED DOCUMENT and never on HMR,
 * so document apps get delivery that no server-lifetime flag can spend and no
 * transform-cache invalidation can strand (the deps-optimizer's
 * `invalidateAll()` discards transform results with no file change behind
 * them). The transform-time import prepended to every component-bearing
 * module is the MODULE-GRAPH path: unconditional per transform, so a
 * re-transform re-adds it — and it is the only path that reaches
 * document-rendering SSR hosts (Remix, React Router), which never invoke
 * `transformIndexHtml`. That path is covered in transform-source.test.ts;
 * the bridge body's server-side no-op is pinned below.
 *
 * The bridge module tolerates loading before any analysis has completed: its
 * body is generated at request time from whatever `resolvedComponentCss` holds
 * (empty string included) and it dedupes the `CSSStyleSheet` behind a
 * `globalThis` key, so a document served ahead of the first analysis simply
 * adopts an empty sheet and picks up content on the next
 * `virtual:animus/components.js` update. Hence: no `storedSheets` gate.
 */

const BRIDGE_TAG: HtmlTagDescriptor = {
  tag: 'script',
  attrs: {
    type: 'module',
    src: BRIDGE_SCRIPT_SRC,
    'data-animus-bridge': '',
  },
  injectTo: 'head-prepend',
};

function bridgeModuleSource(): string {
  const source = loadVirtualModule(
    contextWith({ isProd: false }),
    RESOLVED_BRIDGE_ID
  );
  if (source === null) throw new Error('bridge module did not resolve');
  return source;
}

function withGlobalThis<Context extends object>(context: Context) {
  return Object.assign(context, { globalThis: context });
}

describe('bridge delivery via transformIndexHtml', () => {
  test('dev emits a module script on every served document, before any analysis', () => {
    // index.html can be served before the first analysis completes; a document
    // without the bridge has no adopted stylesheet for the life of the page.
    // The hook holds no per-server state, so re-serving must keep emitting.
    const ctx = contextWith({ isProd: false });
    expect(ctx.storedSheets).toBeNull();

    for (const tags of [
      buildIndexHtmlTags(ctx),
      buildIndexHtmlTags(ctx),
      buildIndexHtmlTags(ctx),
    ]) {
      expect(tags).toContainEqual(BRIDGE_TAG);
    }
  });

  test('the src is the browser-addressable form of the virtual id', () => {
    // Why `/@id/` and why the UNPREFIXED specifier: see BRIDGE_SCRIPT_SRC in
    // src/constants.ts. That the resulting URL is actually servable is proven
    // against a real dev server in tests/dev-lane/dev-server.test.ts.
    expect(BRIDGE_SCRIPT_SRC).toBe(`/@id/${VIRTUAL_BRIDGE_ID}`);
  });

  test('production emits no bridge tag at all', () => {
    const tags = buildIndexHtmlTags(
      contextWith({ isProd: true, layerDeclaration: LAYER_DECLARATION })
    );

    expect(
      tags.some((tag) => tag.attrs?.['data-animus-bridge'] !== undefined)
    ).toBe(false);
    expect(JSON.stringify(tags)).not.toContain('hmr-bridge');
    expect(JSON.stringify(tags)).not.toContain('/@id/');
  });

  test('the bridge rides head-prepend, after the bootstrap and layer tags', () => {
    // All three share the `head-prepend` bucket, which Vite serializes in array
    // order, so array order is document order. A `type="module"` script is
    // deferred, so its position cannot delay the inline classic bootstrap; the
    // guarantee that matters is that a HEAD module script evaluates before the
    // BODY entry module, i.e. before any component module runs.
    const tags = buildIndexHtmlTags(
      contextWith({
        isProd: false,
        appearanceBootstrap: { code: 'void 0;', cspHash: 'sha256-x' },
        layerDeclaration: LAYER_DECLARATION,
      })
    );

    expect(tags.every((tag) => tag.injectTo === 'head-prepend')).toBe(true);
    expect(tags.map((tag) => tag.tag)).toEqual(['script', 'style', 'script']);
    expect(tags.at(-1)).toEqual(BRIDGE_TAG);
  });
});

describe('the wired hook delivers the bridge', () => {
  test('the real plugin hook returns the bridge tag in its dev default state', async () => {
    const plugin = animusExtract({ system: './ds.ts' });
    const hook = plugin.transformIndexHtml;

    if (hook === undefined || !('handler' in hook)) {
      throw new Error(
        'transformIndexHtml must stay in object-with-handler form'
      );
    }

    // `isProd` is false and `layerDeclaration` is '' until `configResolved` /
    // `buildStart` run, so this observes exactly the bridge branch.
    const result = await hook.handler.call(HTML_HOOK_CONTEXT, '', {
      path: '/',
      filename: join(process.cwd(), 'index.html'),
    });
    if (!Array.isArray(result)) {
      throw new Error('transformIndexHtml must return tag descriptors');
    }

    expect(result).toEqual([BRIDGE_TAG]);
  });
});

describe('the bridge module is server-safe', () => {
  test('evaluating the bridge body without a document is a no-op, not a throw', () => {
    // SSR hosts reach the bridge through the import prepended to transformed
    // component modules, so the module body evaluates on the server too. The
    // ESM shell is swapped for scriptable equivalents; the DOM logic under
    // test is byte-identical.
    const source = bridgeModuleSource();

    const scriptable = source
      .replace(/^import css from .*$/m, "const css = '';")
      .replaceAll('import.meta.hot', 'undefined');

    const context = withGlobalThis({});
    expect(() => runInNewContext(scriptable, context)).not.toThrow();
    // No sheet was created and no global key was written.
    expect(Object.keys(context)).toEqual(['globalThis']);
  });

  test('the hot-accept callback is also a no-op without a document', () => {
    // The server module runner has a hot channel of its own: any style edit
    // dispatches the accept callback server-side, where `sheet` is null and
    // the <style> fallback would dereference `document`.
    const source = bridgeModuleSource();

    const scriptable = source
      .replace(/^import css from .*$/m, "const css = '';")
      .replaceAll('import.meta.hot', '__hot__');

    const accepted: Array<(m: { default: string }) => void> = [];
    const context = withGlobalThis({
      __hot__: {
        accept: (_id: string, cb: (m: { default: string }) => void) =>
          accepted.push(cb),
      },
    });
    runInNewContext(scriptable, context);

    expect(accepted).toHaveLength(1);
    expect(() => accepted[0]({ default: '.x{}' })).not.toThrow();
  });
});
