/**
 * Wrapping a stylesheet Animus did not produce into the vendor layer, so its
 * normal declarations lose to every Animus layer. Its text is kept as
 * written: nothing is reprinted, stripped or weakened. What the layer
 * cannot hold back (`!important`, animations, transitions) is reported.
 */
import { tokenize } from '@animus-ui/properties';

import {
  ANIMUS_LAYERS,
  resolveLayerOrder,
  VENDOR_LAYER,
} from './assemble-stylesheet';
import { contentHash } from './content-hash';
import {
  effectiveLevel,
  VENDOR_ANIMATION,
  VENDOR_COVERAGE,
  VENDOR_IMPORTANT,
  VENDOR_OPT_OUT,
  warnLine,
} from './manifest-diagnostics';

import type {
  DiagnosticPolicy,
  ManifestDiagnostic,
} from './manifest-diagnostics';
import type { ResolvedStylesheetPlan } from './stylesheet-plan';
import type { CssToken } from '@animus-ui/properties';

/** How the wrapper treats an `@import` left in the stylesheet. */
export type VendorImportMode =
  /** The host leaves it to the browser (Vite, after it inlines local
   *  imports): it takes the vendor layer, nested under any layer it names. */
  | 'layer'
  /** The host loads it as a stylesheet of its own, which is wrapped in turn
   *  (webpack's css-loader): it stays as written. */
  | 'keep';

/** A top-level statement or rule: its at-keyword (`''` for a rule), its
 *  span, the tokens before its `;` or block, whitespace left out, and
 *  whether it has a block. */
interface TopLevel {
  name: string;
  start: number;
  end: number;
  prelude: CssToken[];
  block: boolean;
}

/** The host's `layers` option as the wrapper reads it, when it names layers
 *  of the consumer's own: their full order, and their names. */
export interface ConsumerLayers {
  order: readonly string[];
  names: ReadonlySet<string>;
}

/** The consumer layers a host's `layers` option names, or null when it
 *  names none. Throws as `resolveLayerOrder` does on an invalid order. */
export function consumerLayers(
  layers: readonly string[] | undefined
): ConsumerLayers | null {
  if (!layers) return null;
  const order = resolveLayerOrder(layers);
  const animus = new Set<string>(ANIMUS_LAYERS);
  const names = new Set(order.filter((name) => !animus.has(name)));
  return names.size > 0 ? { order, names } : null;
}

/** The statements a stylesheet must keep at its top level. */
const LEADING = new Set(['charset', 'import', 'namespace', 'layer']);

/** The stylesheet's top-level items, in order, each to its closing `;` or
 *  `}`; an item left open at the end closes nothing and is not listed. */
function topLevel(tokens: CssToken[]): TopLevel[] {
  const items: TopLevel[] = [];
  let index = 0;
  while (index < tokens.length) {
    const first = tokens[index]!;
    if (first.type === 'whitespace') {
      index += 1;
      continue;
    }
    const name = first.type === 'at-keyword' ? first.value.toLowerCase() : '';
    const prelude: CssToken[] = [];
    let depth = 0;
    let at = name ? index + 1 : index;
    for (; at < tokens.length; at++) {
      const type = tokens[at]!.type;
      if (depth === 0 && (type === ';' || type === '{')) break;
      if (type === '(' || type === '[' || type === 'function') depth += 1;
      else if ((type === ')' || type === ']') && depth > 0) depth -= 1;
      if (type !== 'whitespace') prelude.push(tokens[at]!);
    }
    if (at < tokens.length && tokens[at]!.type === '{') {
      for (let braces = 0; at < tokens.length; at++) {
        const type = tokens[at]!.type;
        if (type === '{') braces += 1;
        else if (type === '}' && --braces === 0) break;
      }
    }
    if (at >= tokens.length) break;
    const block = tokens[at]!.type === '}';
    items.push({
      name,
      start: first.start,
      end: tokens[at]!.end,
      prelude,
      block,
    });
    index = at + 1;
  }
  return items;
}

/** Where the component value starting at `index` ends: past the `)` that
 *  closes a function. */
function valueEnd(prelude: CssToken[], index: number): number {
  if (prelude[index]?.type !== 'function') return index;
  let depth = 0;
  for (let at = index; at < prelude.length; at++) {
    const type = prelude[at]!.type;
    if (type === 'function' || type === '(') depth += 1;
    else if (type === ')' && --depth === 0) return at;
  }
  return prelude.length - 1;
}

/** An `@import` with the vendor layer: a `layer(x)` it names nests under
 *  it, and an anonymous `layer` becomes `anonymous`, a sublayer of its own;
 *  without one, the layer follows its URL. */
function layeredImport(
  css: string,
  statement: TopLevel,
  anonymous: string
): string {
  const { prelude, start, end } = statement;
  const target = valueEnd(prelude, 0);
  if (target >= prelude.length) return css.slice(start, end);
  const afterTarget = prelude[target]!.end;
  const layer = prelude[target + 1];
  const named = (token: CssToken | undefined, type: string) =>
    token?.type === type && token.value.toLowerCase() === 'layer';
  if (named(layer, 'ident')) {
    return `${css.slice(start, layer!.start)}layer(${VENDOR_LAYER}.${anonymous})${css.slice(layer!.end, end)}`;
  }
  if (named(layer, 'function')) {
    const close = prelude[valueEnd(prelude, target + 1)]!;
    const inner = css.slice(layer!.end, close.start).trim();
    return `${css.slice(start, layer!.start)}layer(${VENDOR_LAYER}.${inner})${css.slice(close.end, end)}`;
  }
  return `${css.slice(start, afterTarget)} layer(${VENDOR_LAYER})${css.slice(afterTarget, end)}`;
}

/** A top-level `:export` or `:import(…)` rule, which css-loader's CSS
 *  Modules read only at the top level. */
function isIcss(item: TopLevel): boolean {
  const [colon, name] = item.prelude;
  return (
    item.name === '' &&
    colon?.type === ':' &&
    (name?.type === 'ident' || name?.type === 'function') &&
    (name.value === 'export' || name.value === 'import')
  );
}

/** A top-level `@layer` block of a layer the host's `layers` option names,
 *  or of one nested in it. */
function isConsumerLayer(
  item: TopLevel,
  consumer: ConsumerLayers | null
): boolean {
  const [name] = item.prelude;
  return (
    consumer !== null &&
    item.name === 'layer' &&
    item.block &&
    name?.type === 'ident' &&
    consumer.names.has(name.value)
  );
}

/** Text a stylesheet must hold for the wrapper to read its tokens: a
 *  leading at-rule, CSS Modules interchange rules, a layer block when the
 *  host names consumer layers, or a word naming an effect the layer cannot
 *  hold back. */
const LEADS_WITH_AT_RULE = /^(?:\s|\/\*[\s\S]*?\*\/)*@/;
const HAS_ICSS = /:(?:export|import)\b/;
const HAS_LAYER = /@layer\b/i;
/** An escape can spell any of these words: `@l\61 yer`. */
const HAS_ESCAPE = /\\/;
const MAY_HAVE_EFFECTS = /important|keyframes|animation|transition/i;

const ANIMATION_PROPERTIES = new Set([
  'animation',
  'animation-name',
  'transition',
  'transition-property',
]);

/** 1-based line of `offset`. */
function lineOf(css: string, offset: number): number {
  let line = 1;
  for (
    let at = css.indexOf('\n');
    at !== -1 && at < offset;
    at = css.indexOf('\n', at + 1)
  ) {
    line += 1;
  }
  return line;
}

/** What the vendor layer cannot hold back, as written in `css`. */
function effectDiagnostics(
  css: string,
  tokens: CssToken[],
  file: string
): ManifestDiagnostic[] {
  const important: number[] = [];
  const animated: number[] = [];
  // A declaration begins after `{` or `;` inside a block.
  let depth = 0;
  let declarationStart = false;
  const following = (index: number) => {
    let at = index + 1;
    while (tokens[at]?.type === 'whitespace') at += 1;
    return tokens[at];
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type === 'whitespace') continue;
    if (token.type === '{' || token.type === '}' || token.type === ';') {
      if (token.type === '{') depth += 1;
      else if (token.type === '}') depth = Math.max(0, depth - 1);
      declarationStart = depth > 0;
      continue;
    }
    if (token.type === 'delim' && token.value === '!') {
      const next = following(index);
      if (next?.type === 'ident' && next.value.toLowerCase() === 'important') {
        important.push(token.start);
      }
    } else if (
      token.type === 'at-keyword' &&
      /^(?:-\w+-)?keyframes$/i.test(token.value)
    ) {
      animated.push(token.start);
    } else if (
      declarationStart &&
      token.type === 'ident' &&
      following(index)?.type === ':' &&
      ANIMATION_PROPERTIES.has(token.value.toLowerCase().replace(/^-\w+-/, ''))
    ) {
      animated.push(token.start);
    }
    declarationStart = false;
  }
  const diagnostics: ManifestDiagnostic[] = [];
  const report = (code: string, offsets: number[], what: [string, string]) => {
    if (offsets.length === 0) return;
    const single = offsets.length === 1;
    const lines = offsets.slice(0, 3).map((offset) => lineOf(css, offset));
    // The location names the first; more are listed.
    const listed = single
      ? ''
      : ` (lines ${lines.join(', ')}${offsets.length > lines.length ? ', …' : ''})`;
    diagnostics.push({
      file,
      line: lines[0],
      component: 'stylesheet',
      kind: 'warn',
      severity: 'warn',
      code,
      message: `${offsets.length} ${single ? what[0] : what[1]}${listed}, kept as written: the ${VENDOR_LAYER} layer cannot hold ${single ? 'it' : 'them'} below Animus's styles`,
    });
  };
  report(VENDOR_IMPORTANT, important, [
    '!important declaration, which a lower layer makes stronger, not weaker',
    '!important declarations, which a lower layer makes stronger, not weaker',
  ]);
  report(VENDOR_ANIMATION, animated, [
    'keyframes, animation or transition use, whose animated values override normal declarations in any layer',
    'keyframes, animation or transition uses, whose animated values override normal declarations in any layer',
  ]);
  return diagnostics;
}

export interface WrappedVendorCss {
  code: string;
  diagnostics: ManifestDiagnostic[];
}

/**
 * `css`, a compiled stylesheet Animus did not produce, inside the vendor
 * layer. Its leading `@charset`, `@import` and `@namespace` statements stay
 * at the top, as they must; its leading `@layer` name lists and every rule
 * move inside, so its own layers nest under the vendor layer in their order.
 * Two kinds of top-level rule stay outside the layer: a CSS Module's
 * `:export` and `:import` rules, after it, and a `@layer` block of a layer
 * the host's `layers` option names, where it is written, so it takes that
 * layer's declared place. A sheet with such a block declares the host's
 * full order first, so it holds even when the sheet loads before Animus's.
 * Every line keeps its number: a moved statement or rule leaves its line
 * breaks, and the layer opens on the line the body begins. Only a sheet that
 * may hold one of these is tokenized.
 */
export function wrapVendorCss(
  css: string,
  file: string,
  imports: VendorImportMode,
  consumer: ConsumerLayers | null = null
): WrappedVendorCss {
  const escaped = HAS_ESCAPE.test(css);
  const structured =
    escaped ||
    LEADS_WITH_AT_RULE.test(css) ||
    HAS_ICSS.test(css) ||
    (consumer !== null && HAS_LAYER.test(css));
  const effects = escaped || MAY_HAVE_EFFECTS.test(css);
  const tokens = structured || effects ? tokenize(css) : [];
  const items = structured ? topLevel(tokens) : [];
  let top = '';
  let cursor = 0;
  const moved: string[] = [];
  let anonymous = 0;
  for (const item of items) {
    if (!LEADING.has(item.name) || item.block) break;
    top += css.slice(cursor, item.start);
    const text = css.slice(item.start, item.end);
    if (item.name === 'layer') {
      moved.push(text.replace(/\s+/g, ' '));
      top += text.replace(/[^\n]/g, '');
    } else if (item.name === 'import' && imports === 'layer') {
      // Unique to the file and the import, so it merges with no other.
      top += layeredImport(
        css,
        item,
        `anm-anonymous-${contentHash(file).slice(0, 8)}-${anonymous++}`
      );
    } else {
      top += text;
    }
    cursor = item.end;
  }
  // From the end, so earlier offsets hold.
  let body = css.slice(cursor);
  const icss: string[] = [];
  const kept: TopLevel[] = [];
  for (const item of items.slice().reverse()) {
    if (item.start < cursor) break;
    const text = css.slice(item.start, item.end);
    let replacement: string;
    if (isIcss(item)) {
      icss.unshift(text);
      replacement = text.replace(/[^\n]/g, '');
    } else if (isConsumerLayer(item, consumer)) {
      kept.push(item);
      replacement = `}${text}@layer ${VENDOR_LAYER} {`;
    } else {
      continue;
    }
    body =
      body.slice(0, item.start - cursor) +
      replacement +
      body.slice(item.end - cursor);
  }
  if (kept.length > 0) {
    // After a leading `@charset`, which must come first.
    const at = items[0]?.name === 'charset' ? items[0].end : 0;
    top = `${top.slice(0, at)}@layer ${consumer!.order.join(', ')};${top.slice(at)}`;
  }
  const after = icss.map((text) => `${text}\n`).join('');
  // A kept layer's effects are its own, not the vendor layer's.
  const wrapped = kept.length
    ? tokens.filter(
        (token) =>
          !kept.some(
            (item) => token.start >= item.start && token.end <= item.end
          )
      )
    : tokens;
  return {
    code: `${top}@layer ${VENDOR_LAYER} {${moved.join(' ')}${body}\n}\n${after}`,
    diagnostics: effects ? effectDiagnostics(css, wrapped, file) : [],
  };
}

/** Prints vendor diagnostics once per file and content, at their levels:
 *  at most warnings, whatever `strict` or the `diagnostics` option say, so
 *  no stylesheet fails a build for them. */
export type VendorReporter = (
  file: string,
  content: string,
  diagnostics: readonly ManifestDiagnostic[]
) => void;

/** A reporter that holds one entry per file, its last reported content. */
export function createVendorReporter(
  warn: (message: string) => void,
  policy: Pick<DiagnosticPolicy, 'levels' | 'strict' | 'info'>
): VendorReporter {
  const reported = new Map<string, string>();
  return (file, content, diagnostics) => {
    if (diagnostics.length === 0) return;
    const key = contentHash(content);
    if (reported.get(file) === key) return;
    reported.set(file, key);
    for (const diagnostic of diagnostics) {
      const level = effectiveLevel(diagnostic, policy);
      if (level === 'off') continue;
      if (level === 'info') policy.info?.(`ℹ ${warnLine(diagnostic)}`);
      else warn(`⚠ ${warnLine(diagnostic)}`);
    }
  };
}

/** What a host wraps its CSS units with. */
export interface VendorHost {
  plan: ResolvedStylesheetPlan | null;
  imports: VendorImportMode;
  consumer: ConsumerLayers | null;
  report: VendorReporter;
}

/**
 * One compiled CSS unit as a host delivers it: unchanged when the system
 * opts its file out (reported), otherwise in the vendor layer, its effects
 * reported. `file` is the unit's canonical path, `shown` its name in a
 * report.
 */
export function vendorCssUnit(
  css: string,
  file: string,
  shown: string,
  { plan, imports, consumer, report }: VendorHost
): string {
  if (plan?.optOut.has(file)) {
    report(file, '', [vendorOptOutNotice(shown)]);
    return css;
  }
  const wrapped = wrapVendorCss(css, shown, imports, consumer);
  report(file, css, wrapped.diagnostics);
  return wrapped.code;
}

/** The notice for a host that does not wrap stylesheets in the vendor layer:
 *  `host` names it, `why` says what it lacks. */
export function vendorCoverageNotice(
  host: string,
  why: string
): ManifestDiagnostic {
  return {
    file: host,
    component: 'stylesheets',
    kind: 'warn',
    severity: 'warn',
    code: VENDOR_COVERAGE,
    message: `not wrapped in the ${VENDOR_LAYER} layer: ${why}, so a stylesheet Animus did not produce keeps its own cascade position and can override Animus's styles`,
  };
}

/** The notice for a stylesheet the system opts out of the vendor layer. */
function vendorOptOutNotice(file: string): ManifestDiagnostic {
  return {
    file,
    component: 'stylesheet',
    kind: 'warn',
    severity: 'warn',
    code: VENDOR_OPT_OUT,
    message: `opted out of the ${VENDOR_LAYER} layer by the system's registerVendorStyles: it keeps its own cascade position, and can override Animus's styles`,
  };
}
