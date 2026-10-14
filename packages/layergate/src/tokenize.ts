/**
 * A CSS Syntax Level 3 tokenizer that keeps each token's source span. Names
 * are decoded (`@l\61yer` is the at-keyword `layer`), so a statement is
 * classified by what it means, never by how it is spelled; the source text
 * itself is never reprinted.
 * https://www.w3.org/TR/css-syntax-3/#tokenization
 */

export type TokenType =
  | 'ident'
  | 'function'
  | 'at-keyword'
  | 'hash'
  | 'string'
  | 'bad-string'
  | 'url'
  | 'bad-url'
  | 'delim'
  | 'number'
  | 'percentage'
  | 'dimension'
  | 'whitespace'
  | 'comment'
  | 'cdo'
  | 'cdc'
  | ':'
  | ';'
  | ','
  | '['
  | ']'
  | '('
  | ')'
  | '{'
  | '}';

export interface Token {
  type: TokenType;
  /** Source span, `end` exclusive. */
  start: number;
  end: number;
  /** The decoded name or text: an ident's or function's name (without
   *  `(`), an at-keyword's or hash's name, a string's or url's contents, a
   *  delim's character. Empty for punctuation. */
  value: string;
}

const isNewline = (c: string | undefined) =>
  c === '\n' || c === '\r' || c === '\f';
const isWhitespace = (c: string | undefined) =>
  c === ' ' || c === '\t' || isNewline(c);
const isDigit = (c: string | undefined) =>
  c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined) =>
  c !== undefined &&
  ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));
const isNameStart = (c: string | undefined) =>
  c !== undefined &&
  ((c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    c === '_' ||
    c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined) =>
  isNameStart(c) || isDigit(c) || c === '-';
const isNonPrintable = (c: string | undefined) => {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return (
    code <= 8 || code === 0xb || (code >= 0xe && code <= 0x1f) || code === 0x7f
  );
};

/** Whether the two code points at `at` start a valid escape. */
function validEscape(css: string, at: number): boolean {
  return css[at] === '\\' && !isNewline(css[at + 1]) && at + 1 < css.length;
}

/** Whether the three code points at `at` would start an identifier. */
function startsIdent(css: string, at: number): boolean {
  const c = css[at];
  if (c === '-')
    return (
      isNameStart(css[at + 1]) ||
      css[at + 1] === '-' ||
      validEscape(css, at + 1)
    );
  if (isNameStart(c)) return true;
  return validEscape(css, at);
}

/** Whether the three code points at `at` would start a number. */
function startsNumber(css: string, at: number): boolean {
  const c = css[at];
  if (c === '+' || c === '-') {
    return (
      isDigit(css[at + 1]) || (css[at + 1] === '.' && isDigit(css[at + 2]))
    );
  }
  if (c === '.') return isDigit(css[at + 1]);
  return isDigit(c);
}

export function tokenize(css: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  /** Consumes an escape after its `\`, returning the code point. */
  const escape = (): string => {
    let hex = '';
    while (hex.length < 6 && isHex(css[at])) hex += css[at++];
    if (hex) {
      if (css[at] === '\r' && css[at + 1] === '\n') at += 2;
      else if (isWhitespace(css[at])) at += 1;
      const code = Number.parseInt(hex, 16);
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff
        ? '�'
        : String.fromCodePoint(code);
    }
    if (at >= css.length) return '�';
    const char = String.fromCodePoint(css.codePointAt(at)!);
    at += char.length;
    return char;
  };

  const name = (): string => {
    let result = '';
    for (;;) {
      if (isName(css[at])) result += css[at++];
      else if (validEscape(css, at)) {
        at += 1;
        result += escape();
      } else return result;
    }
  };

  const numeric = (start: number) => {
    if (css[at] === '+' || css[at] === '-') at += 1;
    while (isDigit(css[at])) at += 1;
    if (css[at] === '.' && isDigit(css[at + 1])) {
      at += 1;
      while (isDigit(css[at])) at += 1;
    }
    if (
      (css[at] === 'e' || css[at] === 'E') &&
      (isDigit(css[at + 1]) ||
        ((css[at + 1] === '+' || css[at + 1] === '-') && isDigit(css[at + 2])))
    ) {
      at += 2;
      while (isDigit(css[at])) at += 1;
    }
    const number = css.slice(start, at);
    if (startsIdent(css, at)) {
      const unit = name();
      tokens.push({ type: 'dimension', start, end: at, value: number + unit });
    } else if (css[at] === '%') {
      at += 1;
      tokens.push({ type: 'percentage', start, end: at, value: number });
    } else tokens.push({ type: 'number', start, end: at, value: number });
  };

  const string = (start: number, quote: string) => {
    let value = '';
    for (;;) {
      const c = css[at];
      if (c === undefined) break;
      if (c === quote) {
        at += 1;
        break;
      }
      if (isNewline(c)) {
        tokens.push({ type: 'bad-string', start, end: at, value });
        return;
      }
      if (c === '\\') {
        if (at + 1 >= css.length) {
          at += 1;
          continue;
        }
        if (isNewline(css[at + 1])) {
          at += css[at + 1] === '\r' && css[at + 2] === '\n' ? 3 : 2;
          continue;
        }
        at += 1;
        value += escape();
        continue;
      }
      value += c;
      at += 1;
    }
    tokens.push({ type: 'string', start, end: at, value });
  };

  const badUrlRemnant = () => {
    while (at < css.length) {
      if (css[at] === ')') {
        at += 1;
        return;
      }
      if (validEscape(css, at)) {
        at += 1;
        escape();
      } else at += 1;
    }
  };

  const url = (start: number) => {
    while (isWhitespace(css[at])) at += 1;
    let value = '';
    for (;;) {
      const c = css[at];
      if (c === undefined) break;
      if (c === ')') {
        at += 1;
        break;
      }
      if (isWhitespace(c)) {
        while (isWhitespace(css[at])) at += 1;
        if (css[at] === ')' || css[at] === undefined) {
          if (css[at] === ')') at += 1;
          break;
        }
        badUrlRemnant();
        tokens.push({ type: 'bad-url', start, end: at, value });
        return;
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        badUrlRemnant();
        tokens.push({ type: 'bad-url', start, end: at, value });
        return;
      }
      if (c === '\\') {
        if (validEscape(css, at)) {
          at += 1;
          value += escape();
          continue;
        }
        badUrlRemnant();
        tokens.push({ type: 'bad-url', start, end: at, value });
        return;
      }
      value += c;
      at += 1;
    }
    tokens.push({ type: 'url', start, end: at, value });
  };

  const identLike = (start: number) => {
    const value = name();
    if (value.toLowerCase() === 'url' && css[at] === '(') {
      at += 1;
      let peek = at;
      while (isWhitespace(css[peek]) && isWhitespace(css[peek + 1])) peek += 1;
      const next = isWhitespace(css[peek]) ? css[peek + 1] : css[peek];
      if (next === '"' || next === "'") {
        tokens.push({ type: 'function', start, end: at, value });
        return;
      }
      url(start);
      return;
    }
    if (css[at] === '(') {
      at += 1;
      tokens.push({ type: 'function', start, end: at, value });
      return;
    }
    tokens.push({ type: 'ident', start, end: at, value });
  };

  // A byte-order mark the decoder left in is no content.
  if (css.charCodeAt(0) === 0xfeff) {
    at = 1;
    tokens.push({ type: 'whitespace', start: 0, end: 1, value: '' });
  }
  while (at < css.length) {
    const start = at;
    const c = css[at]!;
    if (c === '/' && css[at + 1] === '*') {
      const close = css.indexOf('*/', at + 2);
      at = close === -1 ? css.length : close + 2;
      tokens.push({ type: 'comment', start, end: at, value: '' });
    } else if (isWhitespace(c)) {
      while (isWhitespace(css[at])) at += 1;
      tokens.push({ type: 'whitespace', start, end: at, value: '' });
    } else if (c === '"' || c === "'") {
      at += 1;
      string(start, c);
    } else if (c === '#') {
      if (isName(css[at + 1]) || validEscape(css, at + 1)) {
        at += 1;
        const value = name();
        tokens.push({ type: 'hash', start, end: at, value });
      } else {
        at += 1;
        tokens.push({ type: 'delim', start, end: at, value: c });
      }
    } else if (
      c === '(' ||
      c === ')' ||
      c === '[' ||
      c === ']' ||
      c === '{' ||
      c === '}' ||
      c === ',' ||
      c === ':' ||
      c === ';'
    ) {
      at += 1;
      tokens.push({ type: c, start, end: at, value: '' });
    } else if (c === '+' || c === '.') {
      if (startsNumber(css, at)) numeric(start);
      else {
        at += 1;
        tokens.push({ type: 'delim', start, end: at, value: c });
      }
    } else if (c === '-') {
      if (startsNumber(css, at)) numeric(start);
      else if (css[at + 1] === '-' && css[at + 2] === '>') {
        at += 3;
        tokens.push({ type: 'cdc', start, end: at, value: '' });
      } else if (startsIdent(css, at)) identLike(start);
      else {
        at += 1;
        tokens.push({ type: 'delim', start, end: at, value: c });
      }
    } else if (c === '<' && css.startsWith('!--', at + 1)) {
      at += 4;
      tokens.push({ type: 'cdo', start, end: at, value: '' });
    } else if (c === '@') {
      at += 1;
      if (startsIdent(css, at)) {
        const value = name();
        tokens.push({ type: 'at-keyword', start, end: at, value });
      } else tokens.push({ type: 'delim', start, end: at, value: c });
    } else if (c === '\\') {
      if (validEscape(css, at)) identLike(start);
      else {
        at += 1;
        tokens.push({ type: 'delim', start, end: at, value: c });
      }
    } else if (isDigit(c)) {
      numeric(start);
    } else if (isNameStart(c)) {
      identLike(start);
    } else {
      const char = String.fromCodePoint(css.codePointAt(at)!);
      at += char.length;
      tokens.push({ type: 'delim', start, end: at, value: char });
    }
  }
  return tokens;
}
