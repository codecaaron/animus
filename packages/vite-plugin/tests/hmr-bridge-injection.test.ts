import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';

import {
  BRIDGE_SCRIPT_SRC,
  RESOLVED_BRIDGE_ID,
  VIRTUAL_BRIDGE_ID,
  VIRTUAL_FONT_PRELOADS_ID,
} from '../src/constants';
import { animusExtract } from '../src/index';
import {
  buildIndexHtmlTags,
  duplicatedFontPreloads,
  injectHeadTags,
} from '../src/index-html';
import { loadVirtualModule, resolveVirtualId } from '../src/virtual-modules';
import { publicationWith } from './context-probe';
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
    expect(ctx.storedManifest).toBeNull();

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

// Contract: `virtual:animus/font-preloads` exports each file the build
// preloads, at the href index.html preloads it, with the faces that preload
// it, so a page can show the build's own selection.
describe('the font-preloads module', () => {
  test('exports the preloads index.html carries, with their faces', () => {
    const faces = [
      { family: 'Inter', weight: '400', unicodeRange: 'U+0000-00FF' },
    ];
    const ctx = contextWith({ isProd: true });
    ctx.served = publicationWith({
      fontPreloads: [
        {
          href: 'animus-asset:@acme/fonts/inter.woff2',
          type: 'font/woff2',
          faces,
        },
        { href: '/fonts/mono.woff2', faces: [{ family: 'Mono' }] },
      ],
    });
    ctx.assetUrlBySpecifier.set(
      '@acme/fonts/inter.woff2',
      '__VITE_ASSET__inter__'
    );
    const id = resolveVirtualId(ctx, VIRTUAL_FONT_PRELOADS_ID);
    expect(typeof id).toBe('string');
    const exported = runInNewContext(
      loadVirtualModule(ctx, id as string)!.replace('export default', 'm =')
    );
    expect(exported).toEqual([
      { href: '__VITE_ASSET__inter__', type: 'font/woff2', faces },
      { href: '/fonts/mono.woff2', faces: [{ family: 'Mono' }] },
    ]);
    expect(
      buildIndexHtmlTags(ctx).map((tag) => tag.attrs?.href)
    ).toEqual(exported.map(({ href }: { href: string }) => href));
  });
});

describe('head tags after the charset', () => {
  const HTML = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width" />',
    '    <title>t</title>',
    '    <link rel="stylesheet" href="/app.css" />',
    '  </head>',
    '</html>',
  ].join('\n');

  function transformed(
    fontPreloads: { href: string; type?: string }[],
    bootstrap?: string
  ): string {
    const overrides: Parameters<typeof contextWith>[0] = {
      isProd: true,
      layerDeclaration: LAYER_DECLARATION,
    };
    if (bootstrap !== undefined) {
      overrides.appearanceBootstrap = { code: bootstrap, cspHash: '' };
    }
    const ctx = contextWith(overrides);
    ctx.served = publicationWith({ fontPreloads });
    const result = injectHeadTags(HTML, buildIndexHtmlTags(ctx, HTML));
    if (Array.isArray(result)) {
      throw new Error('a document with a <head> gets its tags written in');
    }
    return result;
  }

  test("a preload another hook adds again is told from Animus's own", () => {
    // A hook running after Animus's sees no reason to skip its own preload;
    // the build warns for each file both tags name, compared as the browser
    // resolves them against the page.
    const html = transformed([
      { href: '/fonts/a.woff2', type: 'font/woff2' },
      { href: '/fonts/b.woff2', type: 'font/woff2' },
    ]).replace(
      '</head>',
      '<link rel="preload" href="./fonts/a.woff2" as="font" crossorigin></head>'
    );
    expect(
      duplicatedFontPreloads(html, 'https://animus.invalid/index.html')
    ).toEqual(['/fonts/a.woff2']);
    // Character references decode as the browser reads the attribute.
    const encoded = html.replace('./fonts/a.woff2', '&#x2F;fonts&#47;a.woff2');
    expect(
      duplicatedFontPreloads(encoded, 'https://animus.invalid/index.html')
    ).toEqual(['/fonts/a.woff2']);
  });

  test('a preload of no known type carries no type attribute', () => {
    // An undefined attribute serializes as type="undefined", which a
    // browser must refuse as an unsupported type.
    const html = transformed([
      { href: '/a.woff2', type: 'font/woff2' },
      { href: '/b' },
    ]);
    expect(html).toContain(
      '<link rel="preload" href="/a.woff2" as="font" type="font/woff2" crossorigin data-animus-preload>'
    );
    expect(html).toContain(
      '<link rel="preload" href="/b" as="font" crossorigin data-animus-preload>'
    );
    expect(html).not.toContain('undefined');
  });

  test('the charset stays in the first 1024 bytes, then bootstrap, layers, preloads, stylesheet', () => {
    // Before the charset, a long bootstrap or many faces push it past the
    // bytes a browser sniffs for it.
    const html = transformed(
      Array.from({ length: 12 }, (_, i) => ({
        href: `/fonts/face-${i}.woff2`,
        type: 'font/woff2',
      })),
      `/*${'x'.repeat(2000)}*/`
    );
    const charsetEnd = html.indexOf('>', html.indexOf('<meta charset')) + 1;
    expect(
      new TextEncoder().encode(html.slice(0, charsetEnd)).length
    ).toBeLessThanOrEqual(1024);
    const order = [
      'name="viewport"',
      'data-animus-bootstrap',
      'data-animus-layers',
      'rel="preload"',
      'rel="stylesheet"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at > charsetEnd)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
