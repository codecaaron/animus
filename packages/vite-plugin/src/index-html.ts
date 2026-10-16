import { posix } from 'path';

import { BRIDGE_SCRIPT_SRC, SPLIT_STYLESHEET_MARKER_RE } from './constants';

import type { PluginContext } from './context';
import type { HtmlTagDescriptor, Rolldown } from 'vite';

const LINK_TAG_RE = /<link\b[^>]*>/gi;
/** Marks the preloads Animus writes, so another preload of the same file
 *  can be told from Animus's own. */
const ANIMUS_PRELOAD_MARKER = 'data-animus-preload';
const MARKER_RE = /\sdata-animus-preload(?=[\s=/>])/i;
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
  if (offset === -1) return tags;
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
  return preloads.map(({ href, type, fetchpriority }): HtmlTagDescriptor => {
    const attrs: NonNullable<HtmlTagDescriptor['attrs']> = {
      rel: 'preload',
      href,
      as: 'font',
    };
    // An undefined attribute serializes as "undefined", a type that tells
    // the browser to refuse the preload.
    if (type !== undefined) attrs.type = type;
    if (fetchpriority !== undefined) attrs.fetchpriority = fetchpriority;
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

/**
 * A built file's URL in a page, as Vite writes its own links: the host's
 * `renderBuiltUrl` first, then relative to the page under a relative base,
 * else under the base.
 */
function builtUrl(ctx: PluginContext, page: string, fileName: string): string {
  let relative = ctx.base === '' || ctx.base === './';
  const rendered = ctx.renderBuiltUrl?.(fileName, {
    hostId: page,
    hostType: 'html',
    type: 'asset',
    ssr: false,
  });
  if (rendered instanceof Object) {
    if (rendered.runtime !== undefined) {
      throw new Error(
        `[animus-extract] renderBuiltUrl returned { runtime } for ${fileName}, which a page's <link> cannot load`
      );
    }
    if (rendered.relative !== undefined) relative = rendered.relative;
  } else if (rendered) {
    return rendered;
  }
  if (relative) {
    return `${posix.join(posix.relative(page, '').slice(0, -2), './')}${fileName}`;
  }
  return `${decodeURI(ctx.base).replace(/\/$/, '')}/${fileName}`;
}

/** `tag`, a stylesheet link, linking `href` instead, with `attributes`. */
function linkingInstead(tag: string, href: string, attributes = ''): string {
  return tag
    .replace(HREF_RE, ` href="${escapeHtml(href)}"`)
    .replace(/\s*\/?>$/, `${attributes}>`);
}

/** The slice `file` holds, by its id, or a path to it from the root, as
 *  Vite versions spell it. */
export function sliceIdOf(
  file: Rolldown.OutputAsset | Rolldown.OutputChunk,
  sliceIds: readonly string[]
): string | undefined {
  if (file.type !== 'asset') return undefined;
  return sliceIds.find((slice) =>
    file.originalFileNames.some((name) => name.endsWith(slice))
  );
}

/**
 * Puts a split build's slices where the single stylesheet would have been.
 * The stylesheet module held only a marker rule, so it kept its place in
 * Vite's CSS: the file holding the marker is cut there, and each page's
 * link to it becomes the file's CSS before the marker, the slices in
 * order, then its CSS after the marker, in a file of its own when CSS
 * precedes the marker too. A carrier left empty is kept, unlinked, for a
 * lazy chunk that names it. The build fails when no page links the
 * carrier: its stylesheet loads with a lazy chunk, or no page is built.
 */
export function placeStylesheetSlices(
  ctx: PluginContext,
  bundle: Rolldown.OutputBundle,
  sliceIds: readonly string[],
  emitAsset: (name: string, source: string) => string,
  /** The file emitted in a slice's place, or `null` to ship Vite's own. */
  replace?: (file: Rolldown.OutputAsset) => string | null
): void {
  const fileOf = new Map<string, string>();
  const pages: Rolldown.OutputAsset[] = [];
  const carriers: Rolldown.OutputAsset[] = [];
  for (const file of Object.values(bundle)) {
    if (file.type !== 'asset') continue;
    if (file.fileName.endsWith('.html')) pages.push(file);
    if (
      file.fileName.endsWith('.css') &&
      SPLIT_STYLESHEET_MARKER_RE.test(String(file.source))
    ) {
      carriers.push(file);
    }
    const id = sliceIdOf(file, sliceIds);
    if (id === undefined) continue;
    const replacement = replace?.(file);
    if (replacement === undefined || replacement === null) {
      fileOf.set(id, file.fileName);
      continue;
    }
    delete bundle[file.fileName];
    fileOf.set(id, replacement);
  }
  const slices = sliceIds.map((id) => {
    const fileName = fileOf.get(id);
    if (fileName === undefined) {
      throw new Error(
        `[animus-extract] stylesheets: 'split' emitted ${id}, and the bundle holds no file for it, so the stylesheet would load without it.`
      );
    }
    return fileName;
  });
  // Nothing the browser loads imports the stylesheet, as in one sheet.
  if (carriers.length === 0) {
    for (const fileName of slices) delete bundle[fileName];
    return;
  }
  if (carriers.length > 1) {
    throw new Error(
      `[animus-extract] stylesheets: 'split' found Animus's stylesheet in ${carriers.map((file) => file.fileName).join(' and ')}, and places it once.`
    );
  }
  const carrier = carriers[0]!;
  const text = String(carrier.source);
  const marker = SPLIT_STYLESHEET_MARKER_RE.exec(text)!;
  const before = text.slice(0, marker.index);
  const after = text.slice(marker.index + marker[0].length);
  const precedes = before.trim() !== '';
  const follows = after.trim() !== '';
  carrier.source = precedes ? before : after;
  const rest =
    precedes && follows
      ? emitAsset(carrier.names[0] ?? 'index.css', after)
      : null;
  // `null` stands for the carrier, which keeps the page's own link to it.
  const sequence: Array<string | null> = [
    ...(precedes ? [null] : []),
    ...slices,
    ...(follows ? [rest] : []),
  ];
  let linked = false;
  for (const page of pages) {
    const html = Buffer.from(page.source).toString('utf8');
    const carrierUrl = builtUrl(ctx, page.fileName, carrier.fileName);
    const placed = html.replace(LINK_TAG_RE, (tag, offset: number) => {
      const rel = attribute(tag, REL_RE)?.toLowerCase().split(/\s+/) ?? [];
      const href = attribute(tag, HREF_RE);
      if (!rel.includes('stylesheet') || href === undefined) return tag;
      if (attributeText(href) !== carrierUrl) return tag;
      linked = true;
      const lineStart = html.lastIndexOf('\n', offset - 1) + 1;
      const indent = /^[ \t]*/.exec(html.slice(lineStart))![0];
      return sequence
        .map((fileName) =>
          fileName === null
            ? tag
            : linkingInstead(
                tag,
                builtUrl(ctx, page.fileName, fileName),
                fileName === rest ? '' : ' data-animus-stylesheet'
              )
        )
        .join(`\n${indent}`);
    });
    page.source = placed;
  }
  if (!linked) {
    throw new Error(
      `[animus-extract] stylesheets: 'split' links the stylesheet's files where a page links ${carrier.fileName}, which holds Animus's stylesheet, and no page links it: it loads with a lazy chunk, or the build has no HTML page. Import Animus's components from the page's entry, or leave \`stylesheets\` unset for one sheet.`
    );
  }
}
