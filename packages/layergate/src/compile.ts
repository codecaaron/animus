/**
 * Compiles one owned stylesheet graph into one finished stylesheet: every
 * local `@import` inlined at its position, under its media, supports and
 * layer conditions, and each file's own text placed inside the quarantine
 * layer, or outside it for a file opted out. Each file is decided on its
 * own, before assembly, so a parent's decision never reaches a child's
 * text. File text is kept as written; only relative URLs are rewritten, to
 * resolve from the finished stylesheet's location.
 */
import MagicString, { Bundle } from 'magic-string';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';

import { readSheet } from './sheet';

import type { ImportStatement, Sheet } from './sheet';

export type Severity = 'error' | 'warning' | 'info';

export interface LayergateDiagnostic {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** A file's text and structure, which a host may keep between compiles
 *  until the file changes. */
export interface ParsedSheet {
  text: string;
  sheet: Sheet;
}

export interface CompileOptions {
  /** The quarantine layer each owned file's own text goes into. */
  layer: string;
  /** The full layer order the finished stylesheet declares first. */
  order: readonly string[];
  /** The host's CSS resolver: the absolute file `specifier` reaches from
   *  `importer`, or null. */
  resolve(
    specifier: string,
    importer: string
  ): Promise<string | null> | string | null;
  read(file: string): Promise<string> | string;
  /** Whether `file`'s own text goes into the quarantine layer; false for a
   *  file opted out, which still loads, outside it. */
  quarantined(file: string): boolean;
  /** Parsed files by path, read and filled by the compile. */
  cache?: Map<string, ParsedSheet>;
}

export interface CompiledUnit {
  css: string;
  map: ReturnType<Bundle['generateMap']>;
  /** Every file read, the root first. */
  files: string[];
  diagnostics: LayergateDiagnostic[];
}

/** A condition an import puts its stylesheet under. */
interface Frame {
  kind: 'media' | 'supports' | 'layer';
  text: string;
}

const open = (frame: Frame) =>
  frame.kind === 'media'
    ? `@media ${frame.text} {\n`
    : frame.kind === 'supports'
      ? `@supports (${frame.text}) {\n`
      : `@layer ${frame.text} {\n`;

/** A URL the finished stylesheet leaves to the browser. */
const isRemote = (url: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);

/** A URL that resolves the same from any stylesheet location. */
const isLocationFree = (url: string) =>
  url === '' || /^(?:[a-z][a-z0-9+.-]*:|\/|#|%23)/i.test(url);

const quoted = (url: string) =>
  `"${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;

/** `@import "x"` names a stylesheet relative to its own; a bare name that
 *  is no relative file is the package a bundler resolves. */
function candidates(url: string): string[] {
  if (url.startsWith('~')) return [url.slice(1)];
  if (url.startsWith('.') || url.startsWith('/')) return [url];
  return [`./${url}`, url];
}

/** Line and column (1-based) of each offset in `text`. */
function locator(text: string) {
  const starts = [0];
  for (let at = 0; at < text.length; at++)
    if (text[at] === '\n') starts.push(at + 1);
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}

/** A URL's path and its `?query#fragment`. */
function splitSuffix(url: string): [string, string] {
  const at = url.search(/[?#]/);
  return at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at)];
}

/** The frames an import adds, media, then supports, then layer; an
 *  anonymous layer as `anonymous`. */
function importFrames(
  statement: ImportStatement,
  anonymous: () => string
): Frame[] {
  const frames: Frame[] = [];
  if (statement.media) frames.push({ kind: 'media', text: statement.media });
  if (statement.supports !== null)
    frames.push({ kind: 'supports', text: statement.supports });
  if (statement.layer.kind === 'named')
    frames.push({ kind: 'layer', text: statement.layer.name });
  else if (statement.layer.kind === 'anonymous')
    frames.push({ kind: 'layer', text: anonymous() });
  return frames;
}

/** A remote `@import` hoisted to the top of the finished stylesheet: its
 *  layer is every layer on its way, its supports every supports, and its
 *  media the innermost media. */
function remoteImport(url: string, frames: Frame[]): string {
  const of = (kind: Frame['kind']) =>
    frames.filter((frame) => frame.kind === kind).map((frame) => frame.text);
  const [layers, supports, media] = [of('layer'), of('supports'), of('media')];
  return [
    `@import url(${quoted(url)})`,
    layers.length > 0 ? ` layer(${layers.join('.')})` : '',
    supports.length > 0
      ? ` supports(${supports.map((text) => `(${text})`).join(' and ')})`
      : '',
    media.length > 0 ? ` ${media.at(-1)}` : '',
    ';',
  ].join('');
}

export async function compileUnit(
  root: string,
  options: CompileOptions
): Promise<CompiledUnit> {
  const deliveryDir = dirname(root);
  const bundle = new Bundle({ separator: '' });
  const diagnostics: LayergateDiagnostic[] = [];
  const loaded = new Map<
    string,
    | (ParsedSheet & {
        source: MagicString;
        locate: ReturnType<typeof locator>;
      })
    | null
  >();
  const remote: string[] = [];
  const emitted = new Set<string>();

  const report = (
    code: string,
    severity: Severity,
    message: string,
    file: string,
    at: number
  ) => {
    diagnostics.push({
      code,
      severity,
      message,
      file,
      ...loaded.get(file)!.locate(at),
    });
  };

  /** A stable private name for the anonymous layer an import site creates:
   *  unique per importing file and import, and the same on every machine. */
  const anonymousName = (importer: string, index: number) => () => {
    const site = `${relative(deliveryDir, importer).split(sep).join('/')}\0${index}`;
    return `layergate-anonymous-${createHash('sha256').update(site).digest('hex').slice(0, 10)}`;
  };

  /** What a file holds that the layer cannot hold back, or that layergate
   *  cannot place, reported once per file. */
  const reportFile = (file: string, sheet: Sheet) => {
    const effect = (offsets: number[], code: string, what: string) => {
      if (offsets.length === 0 || !options.quarantined(file)) return;
      const them = offsets.length === 1 ? 'it' : 'them';
      report(
        code,
        'warning',
        `${offsets.length} ${what} kept: the quarantine layer does not hold ${them} back`,
        file,
        offsets[0]!
      );
    };
    effect(sheet.important, 'layergate.important', '!important declaration(s)');
    effect(sheet.keyframes, 'layergate.animation', '@keyframes rule(s)');
    effect(sheet.animations, 'layergate.animation', 'animation declaration(s)');
    if (sheet.namespaces.length > 0) {
      report(
        'layergate.namespace',
        'error',
        '@namespace applies to a whole stylesheet, which layergate cannot place yet',
        file,
        sheet.namespaces[0]!
      );
    }
  };

  const load = async (file: string) => {
    if (loaded.has(file)) return loaded.get(file)!;
    let entry = null;
    try {
      let parsed = options.cache?.get(file);
      if (!parsed) {
        const text = String(await options.read(file));
        parsed = { text, sheet: readSheet(text) };
        options.cache?.set(file, parsed);
      }
      const source = new MagicString(parsed.text);
      // A file beside the finished stylesheet keeps every URL as written.
      for (const reference of dirname(file) === deliveryDir
        ? []
        : parsed.sheet.urls) {
        if (isLocationFree(reference.url) || isRemote(reference.url)) continue;
        const [path, suffix] = splitSuffix(reference.url);
        const rebased =
          relative(deliveryDir, join(dirname(file), path))
            .split(sep)
            .join('/') + suffix;
        if (rebased === reference.url) continue;
        source.overwrite(
          reference.start,
          reference.end,
          reference.kind === 'token'
            ? `url(${quoted(rebased)})`
            : quoted(rebased)
        );
      }
      for (const [from, to] of parsed.sheet.removed) source.remove(from, to);
      entry = { ...parsed, source, locate: locator(parsed.text) };
    } catch (error) {
      diagnostics.push({
        code: 'layergate.unreadable',
        severity: 'error',
        message: `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
        file,
      });
    }
    loaded.set(file, entry);
    if (entry) reportFile(file, entry.sheet);
    return entry;
  };

  /** The file's text from `from` to `to` inside `frames`, unless it holds
   *  only whitespace. */
  const emit = (file: string, frames: Frame[], from: number, to: number) => {
    const entry = loaded.get(file)!;
    // Its own text: what the removed leading statements leave.
    let kept = '';
    let at = from;
    for (const [start, end] of entry.sheet.removed) {
      if (end <= at || start >= to) continue;
      kept += entry.text.slice(at, start);
      at = end;
    }
    if (!/\S/.test(kept + entry.text.slice(at, to))) return;
    if (frames.length > 0)
      bundle.addSource({ content: new MagicString(frames.map(open).join('')) });
    bundle.addSource({ filename: file, content: entry.source.snip(from, to) });
    bundle.addSource({
      content: new MagicString(`\n${'}\n'.repeat(frames.length)}`),
    });
  };

  const visit = async (file: string, frames: Frame[], stack: string[]) => {
    const key = `${file}\0${frames.map(open).join('')}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    const entry = await load(file);
    if (!entry) return;
    const own: Frame[] = options.quarantined(file)
      ? [{ kind: 'layer', text: options.layer }, ...frames]
      : frames;
    // What precedes the last import (layer statements and comments), each
    // import's stylesheet, then the rest.
    const split = entry.sheet.imports.at(-1)?.end ?? 0;
    emit(file, own, 0, split);
    for (const [index, statement] of entry.sheet.imports.entries()) {
      const added = importFrames(statement, anonymousName(file, index));
      if (isRemote(statement.url)) {
        const media = [...own, ...added].filter(
          (frame) => frame.kind === 'media'
        ).length;
        const kept =
          media > 1
            ? `; of its ${media} media conditions only the innermost is kept`
            : '';
        report(
          'layergate.remote',
          'warning',
          `@import "${statement.url}" stays remote, so its contents are not inspected${kept}`,
          file,
          statement.start
        );
        remote.push(remoteImport(statement.url, [...own, ...added]));
        continue;
      }
      let child: string | null = null;
      for (const candidate of candidates(statement.url)) {
        child = await options.resolve(candidate, file);
        if (child) break;
      }
      if (!child) {
        report(
          'layergate.unresolved',
          'error',
          `cannot resolve @import "${statement.url}"`,
          file,
          statement.start
        );
      } else if (stack.includes(child)) {
        report(
          'layergate.cycle',
          'warning',
          `@import "${statement.url}" imports a stylesheet already being imported; skipped`,
          file,
          statement.start
        );
      } else {
        await visit(child, [...frames, ...added], [...stack, child]);
      }
    }
    emit(file, own, split, entry.text.length);
  };

  await visit(root, [], [root]);

  bundle.prepend(
    [
      `@layer ${options.order.join(', ')};\n`,
      ...remote.map((line) => `${line}\n`),
    ].join('')
  );
  for (const file of loaded.keys()) {
    if (!options.quarantined(file)) {
      diagnostics.push({
        code: 'layergate.opt-out',
        severity: 'info',
        message: `opted out: its own rules stay outside @layer ${options.layer}`,
        file,
      });
    }
  }
  return {
    css: bundle.toString(),
    map: bundle.generateMap({ hires: 'boundary', includeContent: true }),
    files: [...loaded.keys()],
    diagnostics,
  };
}
