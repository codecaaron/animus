/**
 * The two questions the runtime asks of a dynamic value, answered as the
 * properties tokenizer answers them but without it: the runtime entry must
 * not carry a full CSS tokenizer for checks most values skip. Values are
 * read as CSS tokenization reads them: comments are trivia; strings,
 * `<!--` and unquoted `url()` bodies are opaque; escapes decode; and a name
 * right after a number, `#` or `@` is a unit, hash or at-keyword, never a
 * function. A shared case table pins both answers to the tokenizer's.
 */
export interface TrailingPriority {
  spelling: 'shorthand' | 'important';
  /** Where the value before the priority ends. */
  end: number;
}

const ESCAPE = String.raw`\\(?:[\da-fA-F]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\n\r\f\da-fA-F])`;
const NAME_CHAR = String.raw`(?:[\w\u0080-￿-]|${ESCAPE})`;
/** One unit per match: a comment (1), whitespace (2), an opaque string or
 *  `<!--` (3), a name (4), a `!` (5), or any other character. */
const UNIT = new RegExp(
  String.raw`(\/\*[\s\S]*?(?:\*\/|$))|([ \t\n\r\f]+)|("(?:\\[\s\S]|[^"\\\n\r\f])*"?|'(?:\\[\s\S]|[^'\\\n\r\f])*'?|<!--)|((?:-?(?:[a-zA-Z_\u0080-￿]|${ESCAPE})|--)${NAME_CHAR}*)|(!)|[\s\S]`,
  'gy'
);
/** An unquoted `url(` body, through its `)`. */
const URL_BODY = /(?:\\[\s\S]|[^)\\])*\)?/y;

const decode = (name: string) =>
  name.replace(
    /\\([\da-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([\s\S])/g,
    (_, hex: string | undefined, char: string | undefined) => {
      if (hex === undefined) return char ?? '';
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '�';
    }
  );

/** Kind (0 space, 1 bang, 2 name, 3 other, 4 function), start, end, and a
 *  name's or function's decoded name. */
type Unit = [kind: number, start: number, end: number, name?: string];

function units(css: string): Unit[] {
  const out: Unit[] = [];
  UNIT.lastIndex = 0;
  for (let match; (match = UNIT.exec(css)) !== null;) {
    const start = match.index;
    let end = UNIT.lastIndex;
    if (match[1] !== undefined) continue;
    if (match[2] !== undefined) {
      out.push([0, start, end]);
    } else if (match[5] !== undefined) {
      out.push([1, start, end]);
    } else if (match[4] !== undefined) {
      const name = decode(match[4]);
      const previous = out.at(-1);
      // After a number, `#` or `@`, a name is a unit, hash or at-keyword.
      const bound =
        previous !== undefined &&
        previous[0] === 3 &&
        previous[2] === start &&
        /[\d#@]/.test(css[start - 1]);
      if (!bound && css[end] === '(') {
        let body = end + 1;
        while (/[ \t\n\r\f]/.test(css[body] ?? '')) body += 1;
        if (
          name.toLowerCase() === 'url' &&
          css[body] !== '"' &&
          css[body] !== "'"
        ) {
          URL_BODY.lastIndex = end + 1;
          URL_BODY.exec(css);
          end = UNIT.lastIndex = URL_BODY.lastIndex;
          out.push([3, start, end]);
        } else {
          UNIT.lastIndex = end + 1;
          out.push([4, start, end + 1, name]);
        }
        continue;
      }
      out.push([2, start, end, name]);
    } else {
      out.push([3, start, end]);
    }
  }
  return out;
}

/** A value's trailing priority, as the tokenizer's `importantPriority` reads
 *  it: exactly one `!`; `value!` with nothing between is the shorthand, and
 *  `value !important`, the keyword in any case or escaped, the full form. */
export function trailingPriority(css: string): TrailingPriority | undefined {
  const trimmed = css.trimEnd();
  const endsImportant =
    trimmed.length >= 9 && /^important$/i.test(trimmed.slice(-9));
  if (!css.endsWith('!') && !endsImportant) return undefined;
  const all = units(css);
  const bangs = all.filter((unit) => unit[0] === 1);
  if (bangs.length !== 1) return undefined;
  const at = all.indexOf(bangs[0]);
  if (at === all.length - 1) {
    const previous = all[at - 1];
    return previous !== undefined &&
      previous[0] !== 0 &&
      previous[2] === bangs[0][1]
      ? { spelling: 'shorthand', end: previous[2] }
      : undefined;
  }
  const after = all.slice(at + 1).filter((unit) => unit[0] !== 0);
  if (
    after.length !== 1 ||
    after[0][0] !== 2 ||
    !/^important$/i.test(after[0][3] ?? '')
  ) {
    return undefined;
  }
  const value = all.slice(0, at).findLast((unit) => unit[0] !== 0);
  return value && { spelling: 'important', end: value[2] };
}

/** Whether `css` reads `variable` through a `var()` at any depth, its
 *  fallbacks included: a `var` function, in any case or escaped, whose first
 *  argument is the variable's decoded name. */
export function readsVariable(css: string, variable: string): boolean {
  if (!css.includes('(')) return false;
  const target = decode(variable);
  const all = units(css);
  return all.some((unit, index) => {
    if (unit[0] !== 4 || unit[3]?.toLowerCase() !== 'var') return false;
    const first = all.slice(index + 1).find((next) => next[0] !== 0);
    return first !== undefined && first[0] === 2 && first[3] === target;
  });
}
