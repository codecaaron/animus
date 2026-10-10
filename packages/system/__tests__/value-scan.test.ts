import {
  componentValues,
  decodedIdentifier,
  importantPriority,
  tokenize,
  variableReads,
} from '@animus-ui/properties';
import { describe, expect, it } from 'vitest';

import { readsVariable, trailingPriority } from '../src/runtime/value-scan';

/** The runtime reads a dynamic value's priority and current-variable reads
 *  without the tokenizer; each case must read exactly as the tokenizer's
 *  `importantPriority` and `variableReads` read it. */
const CASES = [
  // No priority.
  'red',
  '',
  'important',
  'red important',
  // The shorthand.
  'red!',
  '12px!',
  'var(--x)!',
  'red !',
  'red/**/!',
  '!',
  'red!!',
  // The full form, in any case, spaced, commented or escaped.
  'red !important',
  'red!important',
  'red ! important',
  'red !IMPORTANT',
  'red !important  ',
  'red /* c */ !important',
  'red !/* c */important',
  'red !\\69mportant',
  'red !\\69 mportant',
  'red !important foo',
  'red !important;',
  'red !imp',
  '!important',
  // A `!` that is not trailing, or not a delimiter.
  'a ! b !important',
  'calc(1px!) !important',
  'calc(1px !important)',
  '"a!" !important',
  '"a!"!',
  "'red!'",
  'url(a!b) !important',
  'url(a!b)!',
  'url( "a!" )!',
  'red\\!',
  'red\\!important',
  '#a\\! !important',
  'a<!--!important',
  'red /* ! */ !important',
  'u\\72l(a!b)!',
  '"unterminated !important\n" !important',
  // A backslash before CRLF continues the string past one newline.
  '"a\\\r\n!" !important',
  '"a\\\r\nred!"!',
  'fooUrl(a!)!',
  // After a number, `url` is its unit, so its `(` opens no url token.
  '2url(a!b)!',
  '.5url(!) !important',
];

const CURRENT = '--current-bg';
const READS = [
  // Reads, in any case, escaped, spaced, commented, nested or in a fallback.
  'var(--current-bg)',
  'VAR(--current-bg)',
  'Var(--current-bg)',
  'v\\61r(--current-bg)',
  'var(--current-\\62 g)',
  'var( --current-bg )',
  'var(/* c */ --current-bg)',
  'var(--current-bg /* c */)',
  'var(--current-bg, red)',
  'var(--current-bg,red)',
  'var(--other, var(--current-bg))',
  'var(--a, var(--b, var(--current-bg, red)))',
  'color-mix(in srgb, var(--current-bg) 85%, transparent)',
  'calc(1px + var(--current-bg))',
  'var(--current-bg',
  'linear-gradient(red, var(--current-bg)), url(a.png)',
  // No read: another name, a string, a comment, a url(), or no var function.
  'red',
  'var(--current-bg-x)',
  'var(--current-bgx)',
  'var(--other)',
  'var(red, var(--current-bg-2))',
  '"var(--current-bg)"',
  "'var(--current-bg)'",
  '/* var(--current-bg) */ red',
  'url(var(--current-bg))',
  'url( var(--current-bg) )',
  'url("var(--current-bg)")',
  '"a\\\r\nvar(--current-bg)"',
  'url("a\\\r\nvar(--current-bg)")',
  'variable(--current-bg)',
  '-var(--current-bg)',
  '2var(--current-bg)',
  '#var(--current-bg)',
  '@var(--current-bg)',
  'var((--current-bg))',
  'var(\ufeff--current-bg)',
  'var(\\--current-bg)',
  '--current-bg',
];

describe('readsVariable', () => {
  it.each(READS)('reads %j as variableReads does', (value) => {
    const reference = variableReads(componentValues(tokenize(value))).some(
      (read) => read.name === decodedIdentifier(CURRENT)
    );
    expect(readsVariable(value, CURRENT)).toBe(reference);
  });
});

describe('trailingPriority', () => {
  it.each(CASES)('reads %j as importantPriority does', (value) => {
    expect(trailingPriority(value)).toEqual(importantPriority(value));
  });
});
