/**
 * The one map from a managed property's declared name to its final name.
 * Names carry no `--`. Lookups go by identity: a declared contextual
 * variable, the exact final spelling of one, which still resolves as a
 * compatibility alias, or another name the theme defines. A declared name
 * wins over another name's final spelling, and an alias over a theme name,
 * as the extractor's index rules, so nothing is renamed twice and both
 * sides resolve every spelling alike.
 */
export interface PropertyNames {
  /** The declared name a spelling refers to; `undefined` when unmanaged. */
  identity(spelling: string): string | undefined;
  /** The final name of a declared name; `undefined` when unmanaged. */
  finalName(declared: string): string | undefined;
  /** Theme names that are also a contextual variable's final spelling. */
  ambiguous(): Array<{ name: string; contextual: string }>;
}

export function createPropertyNames(
  declared: Iterable<string>,
  prefix: string,
  themeNames: Iterable<string> = []
): PropertyNames {
  const finals = new Map<string, string>();
  for (const name of [...new Set(declared)].sort()) {
    finals.set(name, `${prefix}-${name}`);
  }
  const aliases = new Map<string, string>();
  for (const [name, final] of finals) {
    if (!finals.has(final)) aliases.set(final, name);
  }
  const others = new Map<string, string>();
  for (const name of [...new Set(themeNames)].sort()) {
    if (!finals.has(name)) others.set(name, `${prefix}-${name}`);
  }
  return {
    identity: (spelling) =>
      finals.has(spelling)
        ? spelling
        : (aliases.get(spelling) ??
          (others.has(spelling) ? spelling : undefined)),
    finalName: (name) => finals.get(name) ?? others.get(name),
    ambiguous: () =>
      [...others.keys()]
        .filter((name) => aliases.has(name))
        .map((name) => ({ name, contextual: aliases.get(name) ?? name })),
  };
}

const NAME_CHAR = /[\w-]/;

/** A name read from CSS: the index after it, and the name with its escapes
 *  decoded. */
export interface ReadName {
  end: number;
  name: string;
}

/**
 * The name starting at `from`, read as CSS tokenizes an identifier: ASCII
 * letters, digits, `-` and `_`, every non-ASCII code point, and escapes.
 */
export function readCustomPropertyName(css: string, from: number): ReadName {
  let end = from;
  let name = '';
  while (end < css.length) {
    if (isNameChar(css[end])) {
      name += css[end];
      end += 1;
      continue;
    }
    const escape = escapeAt(css, end);
    if (escape === null) break;
    name += escape.codePoint;
    end += escape.length;
  }
  return { end, name };
}

/** The code point an escape stands for, and the escape's length. */
interface Escape {
  codePoint: string;
  length: number;
}

/** A valid escape at `at`: up to six hex digits and one following
 *  whitespace, or any other code point but a newline. */
function escapeAt(css: string, at: number): Escape | null {
  if (css[at] !== '\\') return null;
  const next = css.codePointAt(at + 1);
  if (next === undefined || next === 0x0a || next === 0x0d || next === 0x0c) {
    return null;
  }
  const digits = /^[0-9a-fA-F]{1,6}/.exec(css.slice(at + 1, at + 7))?.[0];
  if (digits === undefined) {
    return {
      codePoint: String.fromCodePoint(next),
      length: 1 + String.fromCodePoint(next).length,
    };
  }
  const after = css.slice(at + 1 + digits.length);
  const space = after.startsWith('\r\n')
    ? 2
    : /^[ \t\n\r\f]/.test(after)
      ? 1
      : 0;
  const value = parseInt(digits, 16);
  const valid =
    value !== 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff);
  return {
    codePoint: String.fromCodePoint(valid ? value : 0xfffd),
    length: 1 + digits.length + space,
  };
}

/**
 * Gives every custom-property token that names a managed property its final
 * name, in one pass: declaration keys, `var()` reads at any depth (fallbacks
 * included), `@property` names, transition-property lists and style queries.
 * A name is read whole, escapes decoded, so an undeclared name that starts
 * with a managed one is never renamed in part. Quoted strings, `url()` and
 * comments are copied unchanged.
 */
export function renameCustomProperties(
  css: string,
  names: PropertyNames
): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = closingQuote(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i + 2);
      const end = close === -1 ? css.length : close + 2;
      out += css.slice(i, end);
      i = end;
    } else if (/^url\(/i.test(css.slice(i, i + 4)) && !isNameChar(css[i - 1])) {
      const end = closingUrl(css, i + 4);
      out += css.slice(i, end);
      i = end;
    } else if (css.startsWith('--', i) && !isNameChar(css[i - 1])) {
      const { end, name } = readCustomPropertyName(css, i + 2);
      const identity = names.identity(name);
      const final =
        identity === undefined ? undefined : names.finalName(identity);
      out += final === undefined ? css.slice(i, end) : `--${final}`;
      i = end;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** A name code point, or a UTF-16 unit of a non-ASCII one. */
function isNameChar(c: string | undefined): boolean {
  return c !== undefined && (NAME_CHAR.test(c) || c.charCodeAt(0) >= 0x80);
}

function closingQuote(css: string, open: number): number {
  const quote = css[open];
  let i = open + 1;
  while (i < css.length && css[i] !== quote) {
    i += css[i] === '\\' ? 2 : 1;
  }
  return Math.min(i + 1, css.length);
}

/** The index after the `)` that closes an unquoted or quoted `url(`. */
function closingUrl(css: string, from: number): number {
  let i = from;
  while (i < css.length && css[i] !== ')') {
    i = css[i] === '"' || css[i] === "'" ? closingQuote(css, i) : i + 1;
  }
  return Math.min(i + 1, css.length);
}
