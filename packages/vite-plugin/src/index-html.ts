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

/** The head elements Animus's tags go after (the charset and viewport
 *  metas), the stylesheets they go before, and what holds neither. */
const HEAD_SCAN_RE =
  /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<\/head\s*>|<style\b|<(?:meta|link)\b[^>]*>/gi;

/** Where Animus's head tags go: after the head's charset and viewport
 *  metas, so they cannot push the charset past the 1024 bytes a browser
 *  sniffs for it, and before its first stylesheet; -1 without a `<head>`. */
function headTagOffset(html: string): number {
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

/** As `escape-html` escapes, which Vite applies to attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A tag as Vite serializes it, `children` as written, except that an
 *  undefined attribute is left out rather than written "undefined". */
function serializeTag({
  tag,
  attrs = {},
  children,
}: HtmlTagDescriptor): string {
  const serialized = Object.entries(attrs)
    .map(([key, value]) => {
      if (value === true) return ` ${key}`;
      if (value === false || value === undefined) return '';
      return ` ${key}="${escapeHtml(value)}"`;
    })
    .join('');
  if (tag === 'link' || tag === 'meta' || tag === 'base') {
    return `<${tag}${serialized}>`;
  }
  const body = Array.isArray(children) ? '' : (children ?? '');
  return `<${tag}${serialized}>${body}</${tag}>`;
}

/**
 * The hook's result: the tags written after the charset and viewport metas,
 * each on its own line indented as the element it follows, so the charset
 * stays in the first 1024 bytes however long the tags are; as `head-prepend`
 * tags for a document without a `<head>`.
 */
export function injectHeadTags(
  html: string,
  tags: HtmlTagDescriptor[]
): string | HtmlTagDescriptor[] {
  const offset = headTagOffset(html);
  if (offset === -1) return tags;
  if (tags.length === 0) return html;
  const lineStart = html.lastIndexOf('\n', offset - 1) + 1;
  const indent = /^[ \t]*/.exec(html.slice(lineStart))![0];
  const inserted = tags
    .map((tag) => `\n${indent}${serializeTag(tag)}`)
    .join('');
  return html.slice(0, offset) + inserted + html.slice(offset);
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
  const preloads = substituteFontPreloads(published, ctx.assetUrlBySpecifier)
    .map((preload) =>
      ctx.isProd
        ? preload
        : { ...preload, href: ctx.devRootRelativeUrl(preload.href) }
    )
    .filter(({ href }) => !existing.has(href));
  return [
    ...fontPreloadOrigins(preloads.map(({ href }) => href)).map(
      (origin): HtmlTagDescriptor => ({
        tag: 'link',
        attrs: { rel: 'preconnect', href: origin, crossorigin: true },
        injectTo: 'head-prepend',
      })
    ),
    ...preloads.map(({ href, type }): HtmlTagDescriptor => {
      const attrs: NonNullable<HtmlTagDescriptor['attrs']> = {
        rel: 'preload',
        href,
        as: 'font',
      };
      // An undefined attribute serializes as "undefined", a type that tells
      // the browser to refuse the preload.
      if (type !== undefined) attrs.type = type;
      attrs.crossorigin = true;
      return { tag: 'link', attrs, injectTo: 'head-prepend' };
    }),
  ];
}

/**
 * Animus's head tags in document order: the bootstrap script, so it runs
 * before first paint and ahead of every stylesheet, the layer declaration,
 * the font preloads, then the development bridge.
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

  if (ctx.layerDeclaration) {
    tags.push({
      tag: 'style',
      attrs: { 'data-animus-layers': '' },
      children: ctx.layerDeclaration,
      injectTo: 'head-prepend',
    });
  }

  tags.push(...fontPreloadTags(ctx, html));

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
