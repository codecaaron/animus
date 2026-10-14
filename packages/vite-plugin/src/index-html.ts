import {
  renderFontPreloads,
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

/** The head elements a font preload goes after (the charset and viewport
 *  metas), the stylesheets it goes before, and what holds neither. */
const HEAD_SCAN_RE =
  /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<\/head\s*>|<style\b|<(?:meta|link)\b[^>]*>/gi;

/** Where the font preloads go: after the head's charset and viewport metas,
 *  so they cannot push the charset past the 1024 bytes a browser sniffs for
 *  it, and before its first stylesheet; -1 without a `<head>`. */
function fontPreloadOffset(html: string): number {
  const open = /<head\b[^>]*>/i.exec(html);
  if (open === null) return -1;
  const start = open.index + open[0].length;
  let offset = start;
  for (const match of html.slice(start).matchAll(HEAD_SCAN_RE)) {
    const [element] = match;
    const lower = element.toLowerCase();
    if (lower.startsWith('</head') || lower.startsWith('<style')) break;
    if (lower.startsWith('<link')) {
      const rel = attribute(element, REL_RE)?.toLowerCase().split(/\s+/);
      if (rel?.includes('stylesheet')) break;
    } else if (
      lower.startsWith('<meta') &&
      (/\scharset\s*=/i.test(element) ||
        /\shttp-equiv\s*=\s*["']?content-type\b/i.test(element) ||
        /\sname\s*=\s*["']?viewport\b/i.test(element))
    ) {
      offset = start + match.index + element.length;
    }
  }
  return offset;
}

/**
 * `html` with the preconnects and preloads for the faces that ask for one,
 * by the URL the stylesheet's own `url()` gets, after the charset and
 * viewport metas and ahead of every stylesheet; one the document already
 * preloads is left out.
 */
export function injectFontPreloads(ctx: PluginContext, html: string): string {
  const published = ctx.served?.fontPreloads ?? [];
  if (published.length === 0) return html;
  const existing = preloadedHrefs(html);
  const preloads = substituteFontPreloads(published, ctx.assetUrlBySpecifier)
    .map((preload) =>
      ctx.isProd
        ? preload
        : { ...preload, href: ctx.devRootRelativeUrl(preload.href) }
    )
    .filter(({ href }) => !existing.has(href));
  const offset = fontPreloadOffset(html);
  if (preloads.length === 0 || offset === -1) return html;
  // Each tag on its own line, indented as the element it follows.
  const lineStart = html.lastIndexOf('\n', offset - 1) + 1;
  const indent = /^[ \t]*/.exec(html.slice(lineStart))![0];
  const tags = renderFontPreloads(preloads)
    .split('\n')
    .map((tag) => `\n${indent}${tag}`)
    .join('');
  return html.slice(0, offset) + tags + html.slice(offset);
}

/**
 * Vite serializes one `head-prepend` bucket in array order, so the bootstrap
 * script precedes the layer declaration and every stylesheet reference.
 */
export function buildIndexHtmlTags(ctx: PluginContext): HtmlTagDescriptor[] {
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
