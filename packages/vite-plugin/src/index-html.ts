import { posix } from 'path';

import { BRIDGE_SCRIPT_SRC } from './constants';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor, Rolldown } from 'vite';

const LINK_TAG_RE = /<link\b[^>]*>/gi;
/** Marks the preloads Animus writes, so another preload of the same file
 *  can be told from Animus's own. */
const ANIMUS_PRELOAD_MARKER = 'data-animus-preload';
const MARKER_RE = new RegExp(`\\s${ANIMUS_PRELOAD_MARKER}(?=[\\s=/>])`, 'i');
/** Marks Animus's layer declaration, which a split build's slice links
 *  follow. */
const ANIMUS_LAYERS_MARKER = 'data-animus-layers';
const REL_RE = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function attribute(tag: string, re: RegExp): string | undefined {
  const match = re.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/** Each `<link rel="preload">` in `html`, with its href. */
function* preloadLinks(html: string): Generator<[tag: string, href: string]> {
  for (const [tag] of html.matchAll(LINK_TAG_RE)) {
    const rel = attribute(tag, REL_RE)?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, HREF_RE);
    if (rel.includes('preload') && href !== undefined) yield [tag, href];
  }
}

const ENTITY_RE = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** An attribute value as the browser reads it: character references decoded. */
function attributeText(value: string): string {
  return value.replace(ENTITY_RE, (_, hex, decimal, named) =>
    named === undefined
      ? String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10))
      : NAMED_ENTITIES.get(named.toLowerCase())!
  );
}

/**
 * The hrefs a finished document preloads both through Animus's tag and
 * through another, which the page wrote or a hook running after Animus's
 * added: the browser may then fetch the file twice. Each href is compared
 * as the browser resolves it against `pageUrl`, the URL the page is served
 * at, and reported as Animus wrote it.
 */
export function duplicatedFontPreloads(
  html: string,
  pageUrl: string
): string[] {
  const resolved = (href: string) => {
    try {
      return new URL(attributeText(href), pageUrl).href;
    } catch {
      return href;
    }
  };
  const ours = new Map<string, string>();
  const others = new Set<string>();
  for (const [tag, href] of preloadLinks(html)) {
    if (MARKER_RE.test(tag)) ours.set(resolved(href), href);
    else others.add(resolved(href));
  }
  return [...ours].filter(([url]) => others.has(url)).map(([, href]) => href);
}

/** The hrefs the document already preloads. */
function preloadedHrefs(html: string): Set<string> {
  return new Set([...preloadLinks(html)].map(([, href]) => href));
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
  return offset === -1 ? tags : insertHeadTags(html, tags, offset);
}

/** `tags` written at `offset` in `html`, each on its own line indented as
 *  the element it follows. */
function insertHeadTags(
  html: string,
  tags: HtmlTagDescriptor[],
  offset: number
): string {
  if (tags.length === 0) return html;
  const lineStart = html.lastIndexOf('\n', offset - 1) + 1;
  const indent = /^[ \t]*/.exec(html.slice(lineStart))![0];
  const inserted = tags
    .map((tag) => `\n${indent}${serializeTag(tag)}`)
    .join('');
  return html.slice(0, offset) + inserted + html.slice(offset);
}

/** The preloads for the faces that ask for one, each marked as Animus's;
 *  one the document already preloads is left out. */
function fontPreloadTags(
  ctx: PluginContext,
  html: string
): HtmlTagDescriptor[] {
  if (!ctx.served?.fontPreloads.length) return [];
  const existing = preloadedHrefs(html);
  const preloads = ctx.fontPreloads.filter(({ href }) => !existing.has(href));
  return preloads.map(({ href, type }): HtmlTagDescriptor => {
    const attrs: NonNullable<HtmlTagDescriptor['attrs']> = {
      rel: 'preload',
      href,
      as: 'font',
    };
    // An undefined attribute serializes as "undefined", a type that tells
    // the browser to refuse the preload.
    if (type !== undefined) attrs.type = type;
    attrs.crossorigin = true;
    attrs[ANIMUS_PRELOAD_MARKER] = true;
    return { tag: 'link', attrs, injectTo: 'head-prepend' };
  });
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
      attrs: { [ANIMUS_LAYERS_MARKER]: '' },
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

/** Animus's layer declaration and font preloads in a built page. */
const ANIMUS_HEAD_TAG_RE = new RegExp(
  `<style\\b[^>]*\\s${ANIMUS_LAYERS_MARKER}\\b[^>]*>[\\s\\S]*?</style\\s*>|<link\\b[^>]*\\s${ANIMUS_PRELOAD_MARKER}\\b[^>]*>`,
  'gi'
);

/** Where a page's stylesheet slices go: after Animus's layer declaration
 *  and font preloads, so the declaration precedes every slice; where its
 *  head tags would go when the page has neither. */
function sliceLinkOffset(html: string): number {
  const close = /<\/head\s*>/i.exec(html)?.index ?? html.length;
  let offset = -1;
  for (const match of html.slice(0, close).matchAll(ANIMUS_HEAD_TAG_RE)) {
    offset = match.index + match[0].length;
  }
  return offset === -1 ? headTagOffset(html) : offset;
}

/** A built file's URL from a page, as Vite writes its own links: under
 *  `base`, or relative to the page under a relative base. */
function builtHref(base: string, page: string, fileName: string): string {
  if (base !== '' && !base.startsWith('.')) {
    return `${base.replace(/\/?$/, '/')}${fileName}`;
  }
  const relative = posix.relative(posix.dirname(page), fileName);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Links each emitted stylesheet slice, in order, from every page of a split
 * build. A build with no page, or whose bundle lost a slice, fails: its
 * stylesheet would never load.
 */
export function linkStylesheetSlices(
  base: string,
  bundle: Rolldown.OutputBundle,
  sliceIds: readonly string[]
): void {
  const fileOf = new Map<string, string>();
  const pages: Rolldown.OutputAsset[] = [];
  for (const file of Object.values(bundle)) {
    if (file.type !== 'asset') continue;
    if (file.fileName.endsWith('.html')) pages.push(file);
    // The id, or a path to it from the root, as Vite versions spell it.
    const id = sliceIds.find((slice) =>
      file.originalFileNames.some((name) => name.endsWith(slice))
    );
    if (id !== undefined) fileOf.set(id, file.fileName);
  }
  const files = sliceIds.map((id) => {
    const fileName = fileOf.get(id);
    if (fileName === undefined) {
      throw new Error(
        `[animus-extract] stylesheets: 'split' emitted ${id}, and the bundle holds no file for it, so the stylesheet would load without it.`
      );
    }
    return fileName;
  });
  if (pages.length === 0) {
    throw new Error(
      `[animus-extract] stylesheets: 'split' links the stylesheet's files from the pages Vite builds, and this build emitted no HTML page, so nothing would load them. Build from an index.html, or leave \`stylesheets\` unset for one sheet the bundle imports.`
    );
  }
  for (const page of pages) {
    const html = Buffer.from(page.source).toString('utf8');
    const tags = files.map((fileName): HtmlTagDescriptor => ({
      tag: 'link',
      attrs: {
        rel: 'stylesheet',
        crossorigin: true,
        href: builtHref(base, page.fileName, fileName),
        'data-animus-stylesheet': true,
      },
    }));
    const offset = sliceLinkOffset(html);
    if (offset === -1) {
      throw new Error(
        `[animus-extract] stylesheets: 'split' links the stylesheet's files in <head>, and ${page.fileName} has none.`
      );
    }
    page.source = insertHeadTags(html, tags, offset);
  }
}
