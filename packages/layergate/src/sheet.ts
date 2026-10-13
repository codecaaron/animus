/**
 * One stylesheet's structure, read from its tokens: the leading statements
 * (`@charset`, `@import`, `@namespace`, `@layer` statements), the URLs it
 * references and the effects a layer cannot hold back.
 */
import { tokenize } from './tokenize';

import type { Token } from './tokenize';

/** The layer an `@import` puts its stylesheet in. */
export type ImportLayer =
  | { kind: 'none' }
  | { kind: 'anonymous' }
  /** `layer(name)`: the name as written. */
  | { kind: 'named'; name: string };

export interface ImportStatement {
  /** The statement's span, through its `;`. */
  start: number;
  end: number;
  /** The decoded URL. */
  url: string;
  layer: ImportLayer;
  /** The text inside `supports(…)`, as written, or null. */
  supports: string | null;
  /** The media query list as written, or `''`. */
  media: string;
}

/** A URL reference: the span to replace and the decoded URL. `token`
 *  replaces a whole `url(…)` token, `string` only a string argument
 *  (`url("x")`, `image-set("x" 1x)`). */
export interface UrlReference {
  start: number;
  end: number;
  url: string;
  kind: 'token' | 'string';
}

export interface Sheet {
  imports: ImportStatement[];
  /** Spans of the leading statements that are not the file's own content:
   *  `@charset` and `@import`. */
  removed: Array<[number, number]>;
  /** Offsets of the `@namespace` statements. */
  namespaces: number[];
  urls: UrlReference[];
  /** Offsets of `!important`, `@keyframes` and `animation` declarations. */
  important: number[];
  keyframes: number[];
  animations: number[];
}

const skippable = (token: Token) =>
  token.type === 'whitespace' || token.type === 'comment' || token.type === 'cdo' || token.type === 'cdc';

/** The index of the first significant token at or after `at`, before `to`. */
function significant(tokens: Token[], at: number, to = tokens.length): number {
  while (at < to && skippable(tokens[at]!)) at += 1;
  return at;
}

/** Where a statement or block rule ends: the index past its `;` (or the
 *  end), and whether it has a block, whose end is not sought. */
interface StatementEnd {
  end: number;
  block: boolean;
}

function statementEnd(tokens: Token[], index: number): StatementEnd {
  let depth = 0;
  for (let at = index; at < tokens.length; at++) {
    const type = tokens[at]!.type;
    if (type === '(' || type === '[' || type === 'function') depth += 1;
    else if ((type === ')' || type === ']') && depth > 0) depth -= 1;
    else if (depth === 0 && type === ';') return { end: at + 1, block: false };
    else if (depth === 0 && type === '{') return { end: tokens.length, block: true };
  }
  return { end: tokens.length, block: false };
}

/** The index of the token closing the function or `(` at `index`. */
function closing(tokens: Token[], index: number): number {
  let depth = 0;
  for (let at = index; at < tokens.length; at++) {
    const type = tokens[at]!.type;
    if (type === '(' || type === 'function') depth += 1;
    else if (type === ')' && --depth === 0) return at;
  }
  return tokens.length - 1;
}

/** An `@import`'s URL, layer, supports and media, from the tokens after
 *  its at-keyword (`from`) through its `;` (`to`, exclusive). */
function readImport(css: string, tokens: Token[], from: number, to: number): ImportStatement | null {
  const start = tokens[from - 1]!.start;
  const last = tokens[to - 1]!;
  const end = last.end;
  let at = significant(tokens, from, to);
  const target = tokens[at];
  if (!target || at >= to) return null;
  let url: string;
  if (target.type === 'string' || target.type === 'url') {
    url = target.value;
    at += 1;
  } else if (target.type === 'function' && target.value.toLowerCase() === 'url') {
    const close = closing(tokens, at);
    const inner = tokens[significant(tokens, at + 1, close)];
    if (inner?.type !== 'string') return null;
    url = inner.value;
    at = close + 1;
  } else return null;
  let layer: ImportLayer = { kind: 'none' };
  at = significant(tokens, at, to);
  let token = tokens[at];
  if (token?.type === 'ident' && token.value.toLowerCase() === 'layer') {
    layer = { kind: 'anonymous' };
    at += 1;
  } else if (token?.type === 'function' && token.value.toLowerCase() === 'layer') {
    const close = closing(tokens, at);
    layer = { kind: 'named', name: css.slice(token.end, tokens[close]!.start).trim() };
    at = close + 1;
  }
  let supports: string | null = null;
  at = significant(tokens, at, to);
  token = tokens[at];
  if (token?.type === 'function' && token.value.toLowerCase() === 'supports') {
    const close = closing(tokens, at);
    supports = css.slice(token.end, tokens[close]!.start).trim();
    at = close + 1;
  }
  at = significant(tokens, at, to);
  token = tokens[at];
  const mediaEnd = last.type === ';' ? last.start : end;
  const media = token && at < to && token.type !== ';' ? css.slice(token.start, mediaEnd).trim() : '';
  return { start, end, url, layer, supports, media };
}

export function readSheet(css: string): Sheet {
  const tokens = tokenize(css);
  const sheet: Sheet = { imports: [], removed: [], namespaces: [], urls: [], important: [], keyframes: [], animations: [] };
  // The leading statements a stylesheet keeps at its top level; the first
  // other rule starts the body.
  let index = significant(tokens, 0);
  let leading = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const name = token.type === 'at-keyword' ? token.value.toLowerCase() : '';
    if (name !== 'charset' && name !== 'import' && name !== 'namespace' && name !== 'layer') break;
    const { end, block } = statementEnd(tokens, index);
    if (block) break;
    const span: [number, number] = [token.start, tokens[end - 1]!.end];
    if (name === 'charset') sheet.removed.push(span);
    else if (name === 'import') {
      const statement = readImport(css, tokens, index + 1, end);
      if (statement) sheet.imports.push(statement);
      sheet.removed.push(span);
    } else if (name === 'namespace') sheet.namespaces.push(token.start);
    index = significant(tokens, end);
    leading = index;
  }
  // URLs and effects, past the removed leading statements.
  let previous: Token | undefined;
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!;
    if (at < leading && sheet.removed.some(([from, to]) => token.start >= from && token.start < to)) continue;
    if (token.type === 'url') {
      sheet.urls.push({ start: token.start, end: token.end, url: token.value, kind: 'token' });
    } else if (token.type === 'function') {
      const fn = token.value.toLowerCase();
      if (fn === 'url' || fn === 'src') {
        const inner = tokens[significant(tokens, at + 1, closing(tokens, at))];
        if (inner?.type === 'string') sheet.urls.push({ start: inner.start, end: inner.end, url: inner.value, kind: 'string' });
      } else if (fn === 'image-set' || fn === '-webkit-image-set') {
        const close = closing(tokens, at);
        let depth = 0;
        for (let inner = at + 1; inner < close; inner++) {
          const candidate = tokens[inner]!;
          if (candidate.type === '(' || candidate.type === 'function') depth += 1;
          else if (candidate.type === ')') depth -= 1;
          else if (depth === 0 && candidate.type === 'string') {
            sheet.urls.push({ start: candidate.start, end: candidate.end, url: candidate.value, kind: 'string' });
          }
        }
      }
    } else if (token.type === 'delim' && token.value === '!') {
      const next = tokens[significant(tokens, at + 1)];
      if (next?.type === 'ident' && next.value.toLowerCase() === 'important') sheet.important.push(token.start);
    } else if (token.type === 'at-keyword' && /^(-[a-z]+-)?keyframes$/i.test(token.value)) {
      sheet.keyframes.push(token.start);
    } else if (
      token.type === 'ident' &&
      /^(-[a-z]+-)?animation(-name)?$/i.test(token.value) &&
      (previous?.type === '{' || previous?.type === ';') &&
      tokens[significant(tokens, at + 1)]?.type === ':'
    ) {
      sheet.animations.push(token.start);
    }
    if (!skippable(token)) previous = token;
  }
  return sheet;
}
