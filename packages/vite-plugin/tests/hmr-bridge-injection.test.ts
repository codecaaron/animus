import { describe, expect, test } from 'vitest';

import { BRIDGE_SCRIPT_SRC, VIRTUAL_BRIDGE_ID } from '../src/constants';
import { animusExtract } from '../src/index';
import { buildIndexHtmlTags } from '../src/index-html';
import { contextWith, LAYER_DECLARATION } from './index-html-context';

import type { HtmlTagDescriptor } from 'vite';

/**
 * HMR bridge delivery (openspec: dev-stylesheet-management, "HMR bridge
 * auto-injected in dev mode": the plugin SHALL inject the bridge via the
 * `transformIndexHtml` hook, and it MUST NOT be injected during production
 * builds).
 *
 * The constraint the hook satisfies: delivery must not depend on any single
 * module's transform result surviving in the graph, and must not be spent by a
 * server-lifetime flag. Vite discards transform results routinely — the
 * deps-optimizer's `fullReload()` → `invalidateAll()` does it with no file
 * change behind it, so nothing re-runs to notice — and a document that missed
 * the bridge has ZERO adopted stylesheets for the life of the page.
 * `transformIndexHtml` fires once per SERVED DOCUMENT and never on HMR
 * (layer-declaration-delivery: "Declaration stable across HMR"), so delivery is
 * idempotent-per-document by construction and holds no state that can be spent.
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
  test('the real plugin hook returns the bridge tag in its dev default state', () => {
    const plugin = animusExtract({ system: './ds.ts' });
    const hook = plugin.transformIndexHtml;

    if (typeof hook !== 'object' || hook === null || !('handler' in hook)) {
      throw new Error(
        'transformIndexHtml must stay in object-with-handler form'
      );
    }

    // `isProd` is false and `layerDeclaration` is '' until `configResolved` /
    // `buildStart` run, so this observes exactly the bridge branch.
    const result = (
      hook.handler as (...args: never[]) => HtmlTagDescriptor[]
    ).call(plugin as never);

    expect(result).toEqual([BRIDGE_TAG]);
  });
});
