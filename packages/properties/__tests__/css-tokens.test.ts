import { describe, expect, test } from 'vitest';

import { blockEnd, componentValues, segmentEnd, tokenize } from '../src';

import type { ComponentValue } from '../src';

// The custom-property check skips a sheet when no transition value or
// keyframes block can name a declared variable, and these bounds decide
// that: one that ends a value early hides a finding the check owes.
const SHEETS = [
  '.a { transition: --x 1s; color: red } .b{}',
  '.a { background: url(x;{y}) --x; } .c { t: url( "a;b" ) --y }',
  `.a { content: "}{;"; v: 'x\\'y' }`,
  '.a { f: g(a;b{c}d) [e;f] ) stray; h: (] ; i }',
  '@keyframes k { from { --x: 1 } to { --x: 2 } } .z{',
  '.a { /* ; } */ t: --x 1s } .b { u: \\7b; w: u\\72l(a;b) }',
  '.a { b: c',
  // An unclosed block ends after its last token, not at a trailing comment.
  '.a { b: c /* tail */',
  '{/*x*/',
  '} stray; .a { b: c }',
];

/** Each segment's first offset and where `componentValues` ends it: at a
 *  `;` or `{` block of its list, a stray `}`, or its block's end. */
function segments(css: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const visit = (items: readonly ComponentValue[], end: number) => {
    let start: number | undefined;
    for (const item of items) {
      const ends =
        (item.kind === 'token' &&
          (item.token.type === ';' || item.token.type === '}')) ||
        (item.kind === 'block' && item.open.type === '{');
      if (ends) {
        if (start !== undefined) out.push([start, item.start]);
        start = undefined;
      } else {
        start ??= item.start;
      }
      if (item.kind === 'block' && item.open.type === '{') {
        visit(item.children, item.close?.start ?? css.length);
      }
    }
    if (start !== undefined) out.push([start, end]);
  };
  visit(componentValues(tokenize(css)), css.length);
  return out;
}

function blocks(items: readonly ComponentValue[]): ComponentValue[] {
  return items.flatMap((item) =>
    item.kind === 'block' ? [item, ...blocks(item.children)] : []
  );
}

describe('segmentEnd and blockEnd', () => {
  test('bound a segment and a block where componentValues does', () => {
    for (const css of SHEETS) {
      for (const [start, end] of segments(css)) {
        expect([css, start, segmentEnd(css, start)]).toEqual([css, start, end]);
      }
      for (const block of blocks(componentValues(tokenize(css)))) {
        expect([css, block.start, blockEnd(css, block.start)]).toEqual([
          css,
          block.start,
          block.end,
        ]);
      }
    }
  });
});
