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

/** Two dev delivery paths: this index-html tag, and the import prepended at
 *  transform time — the only one document-rendering SSR hosts reach. */

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
    // A document served without the bridge has no adopted stylesheet for the
    // life of the page, and the hook holds no per-server state to spend.
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
    // Vite serializes the head-prepend bucket in array order, so array order
    // is document order; a module script still runs before the body entry.
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
    // component modules, so the module body also evaluates on the server.
    const source = bridgeModuleSource();

    const scriptable = source
      .replace(/^import css from .*$/m, "const css = '';")
      .replaceAll('import.meta.hot', 'undefined');

    const context = withGlobalThis({});
    expect(() => runInNewContext(scriptable, context)).not.toThrow();
    expect(Object.keys(context)).toEqual(['globalThis']);
  });

  test('the hot-accept callback is also a no-op without a document', () => {
    // The server module runner has its own hot channel, so a style edit runs
    // the accept callback where `sheet` is null and the fallback needs a DOM.
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
