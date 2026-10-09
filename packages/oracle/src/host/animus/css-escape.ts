/**
 * CSS escapes (CSS Syntax §4.3.7). The engine escapes a class name that holds
 * a character CSS reads as syntax (`trackClass$1` → `trackClass\$1`) and a
 * leading digit as hex followed by one terminating space (`\31 `), so a
 * selector's identifiers must be decoded, and an escape kept whole, before
 * its text is split or compared.
 */

const HEX_DIGIT = /[0-9A-Fa-f]/;

const isNewline = (char: string | undefined): boolean =>
  char === '\n' || char === '\r' || char === '\f';

const isEscapeTerminator = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || isNewline(char);

/** Whether a valid escape starts at `at`: a backslash not followed by a
 *  newline or the end of the text. */
export const startsEscape = (text: string, at: number): boolean =>
  text[at] === '\\' && at + 1 < text.length && !isNewline(text[at + 1]);

/**
 * The escape starting at `at`, which `startsEscape` accepted: the code point
 * it stands for and the index just past it. A hex escape takes up to six
 * digits and one terminating whitespace; zero, a surrogate or a value past
 * U+10FFFF stands for U+FFFD.
 */
export const readEscape = (
  text: string,
  at: number
): { value: string; end: number } => {
  let end = at + 1;
  if (!HEX_DIGIT.test(text[end])) {
    const value = String.fromCodePoint(text.codePointAt(end) ?? 0xfffd);
    return { value, end: end + value.length };
  }
  const digits = end;
  while (end < text.length && end - digits < 6 && HEX_DIGIT.test(text[end])) {
    end += 1;
  }
  const code = Number.parseInt(text.slice(digits, end), 16);
  if (text[end] === '\r' && text[end + 1] === '\n') end += 2;
  else if (isEscapeTerminator(text[end])) end += 1;
  const valid =
    code !== 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return { value: String.fromCodePoint(valid ? code : 0xfffd), end };
};

/**
 * Collapses each whitespace run to one space and trims the ends, keeping
 * every escape as written: a hex escape's terminating space belongs to the
 * escape, so `.a\31  .b` stays a class `a1` above `.b`.
 */
export const collapseWhitespace = (text: string): string => {
  let out = '';
  let space = false;
  for (let index = 0; index < text.length;) {
    if (startsEscape(text, index)) {
      if (space) out += ' ';
      space = false;
      const { end } = readEscape(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    const char = text[index];
    index += 1;
    if (/\s/.test(char)) {
      space = out !== '';
      continue;
    }
    if (space) out += ' ';
    space = false;
    out += char;
  }
  return out;
};
