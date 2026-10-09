/**
 * CSS tokens as CSS Syntax Level 3 reads them, with their source offsets.
 * Comments are trivia and make no token. Identifiers, function names,
 * at-keywords, hashes and units are decoded, escapes included. A quoted
 * string and an unquoted `url()` are each one opaque token, so nothing inside
 * them reads as a name or a function.
 */

export type CssTokenType =
  | 'whitespace'
  | 'ident'
  | 'function'
  | 'at-keyword'
  | 'hash'
  | 'string'
  | 'bad-string'
  | 'url'
  | 'bad-url'
  | 'number'
  | 'percentage'
  | 'dimension'
  | 'delim'
  | 'CDO'
  | 'CDC'
  | '('
  | ')'
  | '['
  | ']'
  | '{'
  | '}'
  | ','
  | ':'
  | ';';

export interface CssToken {
  type: CssTokenType;
  start: number;
  end: number;
  /** The decoded name of an ident, function, at-keyword or hash, the
   *  decoded unit of a dimension, or a delim's character; otherwise `''`. */
  value: string;
  /** A number, percentage or dimension's numeric value; otherwise `0`. */
  number: number;
}

const at = (css: string, index: number): number =>
  index < css.length ? css.charCodeAt(index) : -1;

const isNewline = (c: number) => c === 0x0a || c === 0x0d || c === 0x0c;
const isWhitespace = (c: number) => c === 0x20 || c === 0x09 || isNewline(c);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isHexDigit = (c: number) =>
  isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isIdentStart = (c: number) =>
  (c >= 0x41 && c <= 0x5a) ||
  (c >= 0x61 && c <= 0x7a) ||
  c === 0x5f ||
  c >= 0x80;
const isIdentChar = (c: number) => isIdentStart(c) || isDigit(c) || c === 0x2d;
const isNonPrintable = (c: number) =>
  (c >= 0 && c <= 0x08) || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;

/** Whether a `\` at `index` starts an escape. */
const isEscape = (css: string, index: number) =>
  at(css, index) === 0x5c && !isNewline(at(css, index + 1));

function startsIdentifier(css: string, index: number): boolean {
  const c = at(css, index);
  if (c === 0x2d) {
    const next = at(css, index + 1);
    return isIdentStart(next) || next === 0x2d || isEscape(css, index + 1);
  }
  return isIdentStart(c) || isEscape(css, index);
}

function startsNumber(css: string, index: number): boolean {
  const signed = at(css, index) === 0x2b || at(css, index) === 0x2d ? 1 : 0;
  const c = at(css, index + signed);
  return isDigit(c) || (c === 0x2e && isDigit(at(css, index + signed + 1)));
}

/** The code point the escape at `index` stands for, and the index after it. */
function readEscape(css: string, index: number): [string, number] {
  let i = index + 1;
  if (i >= css.length) return ['\ufffd', i];
  if (!isHexDigit(at(css, i))) {
    const char = String.fromCodePoint(css.codePointAt(i) ?? 0xfffd);
    return [char, i + char.length];
  }
  const digitsEnd = Math.min(i + 6, css.length);
  let value = 0;
  while (i < digitsEnd && isHexDigit(at(css, i))) {
    value = value * 16 + parseInt(css[i], 16);
    i += 1;
  }
  if (at(css, i) === 0x0d && at(css, i + 1) === 0x0a) i += 2;
  else if (isWhitespace(at(css, i))) i += 1;
  const valid =
    value !== 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff);
  return [String.fromCodePoint(valid ? value : 0xfffd), i];
}

/** The identifier sequence at `index`, decoded, and the index after it. */
function readName(css: string, index: number): [string, number] {
  let name = '';
  let from = index;
  let i = index;
  for (;;) {
    if (isIdentChar(at(css, i))) {
      i += 1;
    } else if (isEscape(css, i)) {
      const [char, next] = readEscape(css, i);
      name += css.slice(from, i) + char;
      i = next;
      from = i;
    } else {
      return [name + css.slice(from, i), i];
    }
  }
}

/** The identifier starting at `index`, decoded, or `undefined` when none
 *  starts there. */
export function identifierAt(
  css: string,
  index: number
): { name: string; end: number } | undefined {
  if (!startsIdentifier(css, index)) return undefined;
  const [name, end] = readName(css, index);
  return { name, end };
}

/** `name` decoded when it is one whole identifier, else as written. */
export function decodedIdentifier(name: string): string {
  const read = identifierAt(name, 0);
  return read?.end === name.length ? read.name : name;
}

function readString(
  css: string,
  index: number
): ['string' | 'bad-string', number] {
  const quote = at(css, index);
  let i = index + 1;
  for (;;) {
    const c = at(css, i);
    if (c === -1) return ['string', i];
    if (c === quote) return ['string', i + 1];
    if (isNewline(c)) return ['bad-string', i];
    if (c === 0x5c) {
      const next = at(css, i + 1);
      if (next === -1) i += 1;
      else if (isNewline(next)) {
        i += next === 0x0d && at(css, i + 2) === 0x0a ? 3 : 2;
      } else i = readEscape(css, i)[1];
    } else {
      i += 1;
    }
  }
}

function badUrlEnd(css: string, index: number): number {
  let i = index;
  for (;;) {
    const c = at(css, i);
    if (c === -1) return i;
    if (c === 0x29) return i + 1;
    i = isEscape(css, i) ? readEscape(css, i)[1] : i + 1;
  }
}

/** An unquoted `url(` body starting at `index`. */
function readUrl(css: string, index: number): ['url' | 'bad-url', number] {
  let i = index;
  while (isWhitespace(at(css, i))) i += 1;
  for (;;) {
    const c = at(css, i);
    if (c === -1) return ['url', i];
    if (c === 0x29) return ['url', i + 1];
    if (isWhitespace(c)) {
      while (isWhitespace(at(css, i))) i += 1;
      const next = at(css, i);
      if (next === -1) return ['url', i];
      if (next === 0x29) return ['url', i + 1];
      return ['bad-url', badUrlEnd(css, i)];
    }
    if (c === 0x22 || c === 0x27 || c === 0x28 || isNonPrintable(c)) {
      return ['bad-url', badUrlEnd(css, i)];
    }
    if (c === 0x5c) {
      if (!isEscape(css, i)) return ['bad-url', badUrlEnd(css, i)];
      i = readEscape(css, i)[1];
    } else {
      i += 1;
    }
  }
}

function numberEnd(css: string, index: number): number {
  let i = index;
  if (at(css, i) === 0x2b || at(css, i) === 0x2d) i += 1;
  while (isDigit(at(css, i))) i += 1;
  if (at(css, i) === 0x2e && isDigit(at(css, i + 1))) {
    i += 2;
    while (isDigit(at(css, i))) i += 1;
  }
  const e = at(css, i);
  if (e === 0x45 || e === 0x65) {
    const sign = at(css, i + 1) === 0x2b || at(css, i + 1) === 0x2d ? 1 : 0;
    if (isDigit(at(css, i + 1 + sign))) {
      i += 2 + sign;
      while (isDigit(at(css, i))) i += 1;
    }
  }
  return i;
}

const SINGLE = new Map<string, CssTokenType>(
  (['(', ')', '[', ']', '{', '}', ',', ':', ';'] as const).map((c) => [c, c])
);

/** Every token of `css`, in order. */
export function tokenize(css: string): CssToken[] {
  const tokens: CssToken[] = [];
  let index = 0;
  const push = (type: CssTokenType, end: number, value = '', number = 0) => {
    tokens.push({ type, start: index, end, value, number });
    index = end;
  };
  while (index < css.length) {
    const c = css.charCodeAt(index);
    if (c === 0x2f && at(css, index + 1) === 0x2a) {
      const close = css.indexOf('*/', index + 2);
      index = close === -1 ? css.length : close + 2;
    } else if (isWhitespace(c)) {
      let end = index + 1;
      while (isWhitespace(at(css, end))) end += 1;
      push('whitespace', end);
    } else if (c === 0x22 || c === 0x27) {
      const [type, end] = readString(css, index);
      push(type, end);
    } else if (startsNumber(css, index)) {
      const end = numberEnd(css, index);
      const number = Number(css.slice(index, end));
      if (startsIdentifier(css, end)) {
        const [unit, unitEnd] = readName(css, end);
        push('dimension', unitEnd, unit, number);
      } else if (at(css, end) === 0x25) {
        push('percentage', end + 1, '', number);
      } else {
        push('number', end, '', number);
      }
    } else if (c === 0x2d && css.startsWith('->', index + 1)) {
      push('CDC', index + 3);
    } else if (startsIdentifier(css, index)) {
      const [name, end] = readName(css, index);
      if (at(css, end) !== 0x28) {
        push('ident', end, name);
      } else if (!/^url$/i.test(name)) {
        push('function', end + 1, name);
      } else {
        let body = end + 1;
        while (isWhitespace(at(css, body)) && isWhitespace(at(css, body + 1))) {
          body += 1;
        }
        const first = at(css, body);
        const quote = isWhitespace(first) ? at(css, body + 1) : first;
        if (quote === 0x22 || quote === 0x27) {
          push('function', body, name);
        } else {
          const [type, urlEnd] = readUrl(css, end + 1);
          push(type, urlEnd);
        }
      }
    } else if (
      c === 0x23 &&
      (isIdentChar(at(css, index + 1)) || isEscape(css, index + 1))
    ) {
      const [name, end] = readName(css, index + 1);
      push('hash', end, name);
    } else if (c === 0x40 && startsIdentifier(css, index + 1)) {
      const [name, end] = readName(css, index + 1);
      push('at-keyword', end, name);
    } else if (c === 0x3c && css.startsWith('!--', index + 1)) {
      push('CDO', index + 4);
    } else {
      const single = SINGLE.get(css[index]);
      if (single === undefined) push('delim', index + 1, css[index]);
      else push(single, index + 1);
    }
  }
  return tokens;
}

/** A component value: a function, or a `()`, `[]` or `{}` block, with its
 *  contents, or a single token. Offsets span the whole value. */
export type ComponentValue =
  | {
      kind: 'block';
      /** The function token, or the `(`, `[` or `{` token. */
      open: CssToken;
      /** `undefined` when the block is never closed. */
      close: CssToken | undefined;
      children: ComponentValue[];
      start: number;
      end: number;
    }
  | { kind: 'token'; token: CssToken; start: number; end: number };

type Block = Extract<ComponentValue, { kind: 'block' }>;

const CLOSERS = new Map<CssTokenType, CssTokenType>([
  ['function', ')'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/**
 * `tokens` as component values. Only the innermost open block's own closer
 * closes it; any other closer stays a token, and a block left open closes at
 * the end, as CSS reads them.
 */
export function componentValues(tokens: readonly CssToken[]): ComponentValue[] {
  const root: ComponentValue[] = [];
  const open: Array<{ block: Block; closer: CssTokenType }> = [];
  for (const token of tokens) {
    const top = open.at(-1);
    if (top !== undefined && token.type === top.closer) {
      top.block.close = token;
      top.block.end = token.end;
      open.pop();
      continue;
    }
    const list = top === undefined ? root : top.block.children;
    const closer = CLOSERS.get(token.type);
    if (closer === undefined) {
      list.push({ kind: 'token', token, start: token.start, end: token.end });
    } else {
      const block: Block = {
        kind: 'block',
        open: token,
        close: undefined,
        children: [],
        start: token.start,
        end: token.end,
      };
      list.push(block);
      open.push({ block, closer });
    }
  }
  for (let i = open.length - 1; i >= 0; i -= 1) {
    const { block } = open[i];
    block.end = Math.max(block.end, block.children.at(-1)?.end ?? block.end);
  }
  return root;
}

/** Whether `test` holds for a value at any depth. */
export function someValue(
  values: readonly ComponentValue[],
  test: (value: ComponentValue) => boolean
): boolean {
  return values.some(
    (value) =>
      test(value) || (value.kind === 'block' && someValue(value.children, test))
  );
}

/** A `var()` read: the decoded custom-property name, the call's offsets,
 *  and its fallback's: after the comma, the first value's start, and before
 *  the closing parenthesis. */
export interface VariableRead {
  name: string;
  start: number;
  end: number;
  fallback: { start: number; first: number; end: number } | undefined;
}

/** Whether `value` is whitespace. */
export const isSpace = (value: ComponentValue | undefined) =>
  value?.kind === 'token' && value.token.type === 'whitespace';

/**
 * Every `var()` call in `values` at any depth, fallbacks included, outer
 * calls first: a function whose decoded name is `var` in any case, and whose
 * first argument is a custom-property name.
 */
export function variableReads(
  values: readonly ComponentValue[]
): VariableRead[] {
  const reads: VariableRead[] = [];
  const visit = (list: readonly ComponentValue[]) => {
    for (const value of list) {
      if (value.kind !== 'block') continue;
      if (value.open.type === 'function' && /^var$/i.test(value.open.value)) {
        const [name, comma, first] = value.children.filter((c) => !isSpace(c));
        if (
          name?.kind === 'token' &&
          name.token.type === 'ident' &&
          name.token.value.startsWith('--')
        ) {
          const end = value.close?.start ?? value.end;
          reads.push({
            name: name.token.value,
            start: value.start,
            end: value.end,
            fallback:
              comma?.kind === 'token' && comma.token.type === ','
                ? { start: comma.end, first: first?.start ?? end, end }
                : undefined,
          });
        }
      }
      visit(value.children);
    }
  };
  visit(values);
  return reads;
}

/** How a value spells the `!important` it ends with: `hidden !important`,
 *  any case and spacing, or the shorthand `hidden!`. */
export type ImportantSpelling = 'important' | 'shorthand';

export interface ImportantPriority {
  spelling: ImportantSpelling;
  /** Where the value before the priority ends. */
  end: number;
}

/**
 * The `!important` `css` ends with; kept in step with `important_priority`
 * in the Rust engine. The value has one `!`, a delim token, so a `!` inside
 * a string, a `url()` or an escape is no priority, and neither is a lone `!`
 * or `!important`.
 */
export function importantPriority(css: string): ImportantPriority | undefined {
  const trimmed = css.trimEnd();
  const endsImportant =
    trimmed.length >= 9 && /^important$/i.test(trimmed.slice(-9));
  if (!css.endsWith('!') && !endsImportant) return undefined;
  const tokens = tokenize(css);
  let bang = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'delim' || tokens[index].value !== '!') continue;
    if (bang !== -1) return undefined;
    bang = index;
  }
  if (bang === -1) return undefined;
  if (bang === tokens.length - 1) {
    const previous = tokens[bang - 1];
    return previous !== undefined &&
      previous.type !== 'whitespace' &&
      previous.end === tokens[bang].start
      ? { spelling: 'shorthand', end: previous.end }
      : undefined;
  }
  const after = tokens.slice(bang + 1).filter((t) => t.type !== 'whitespace');
  if (
    after.length !== 1 ||
    after[0].type !== 'ident' ||
    !/^important$/i.test(after[0].value)
  ) {
    return undefined;
  }
  const value = tokens.slice(0, bang).findLast((t) => t.type !== 'whitespace');
  return value && { spelling: 'important', end: value.end };
}
