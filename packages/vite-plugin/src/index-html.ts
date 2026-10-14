import {
  fontPreloadOrigins,
  substituteFontPreloads,
} from '@animus-ui/extract/pipeline';

import { BRIDGE_SCRIPT_SRC } from './constants';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor } from 'vite';

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const REL_RE = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function attribute(tag: string, re: RegExp): string | undefined {
  const match = re.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/** The hrefs the document already preloads. */
function preloadedHrefs(html: string): Set<string> {
  const hrefs = new Set<string>();
  for (const [tag] of html.matchAll(LINK_TAG_RE)) {
    const rel = attribute(tag, REL_RE)?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, HREF_RE);
    if (rel.includes('preload') && href !== undefined) hrefs.add(href);
  }
  return hrefs;
}

/** The preconnects and preloads for the faces that ask for one, by the
 *  URL the stylesheet's own `url()` gets; one the document already
 *  preloads is left out. */
function fontPreloadTags(
  ctx: PluginContext,
  html: string
): HtmlTagDescriptor[] {
  const published = ctx.served?.fontPreloads ?? [];
  if (published.length === 0) return [];
  const existing = preloadedHrefs(html);
  const preloads = substituteFontPreloads(
    published,
    ctx.assetUrlBySpecifier
  ).filter(({ href }) => !existing.has(href));
  return [
    ...fontPreloadOrigins(preloads.map(({ href }) => href)).map(
      (origin): HtmlTagDescriptor => ({
        tag: 'link',
        attrs: { rel: 'preconnect', href: origin, crossorigin: true },
        injectTo: 'head-prepend',
      })
    ),
    ...preloads.map(({ href, type }): HtmlTagDescriptor => ({
      tag: 'link',
      attrs: { rel: 'preload', href, as: 'font', type, crossorigin: true },
      injectTo: 'head-prepend',
    })),
  ];
}

/**
 * Vite serializes one `head-prepend` bucket in array order, so the bootstrap
 * script precedes the font preloads, the layer declaration and every
 * stylesheet reference.
 */
export function buildIndexHtmlTags(
  ctx: PluginContext,
  html = ''
): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [];

  const bootstrap = ctx.options.appearanceBootstrap;
  if (bootstrap?.code) {
    tags.push({
      tag: 'script',
      attrs: { 'data-animus-bootstrap': '' },
      children: bootstrap.code,
      injectTo: 'head-prepend',
    });
  }

  tags.push(...fontPreloadTags(ctx, html));

  if (ctx.layerDeclaration) {
    tags.push({
      tag: 'style',
      attrs: { 'data-animus-layers': '' },
      children: ctx.layerDeclaration,
      injectTo: 'head-prepend',
    });
  }

  // Dev only, never gated on a publication: index.html can be served before
  // the first analysis, and a document missing the tag stays unstyled.
  if (!ctx.isProd) {
    tags.push({
      tag: 'script',
      attrs: {
        type: 'module',
        src: BRIDGE_SCRIPT_SRC,
        'data-animus-bridge': '',
      },
      injectTo: 'head-prepend',
    });
  }

  return tags;
}
