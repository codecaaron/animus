/** Declaration maps that follow a packet: segments move with the text a
 *  rewrite shifts, and source paths are re-relativized from the compiler's
 *  output directory to the packet's. */

import { dirname, relative, resolve } from 'node:path';

import { toPosix } from './types-resolve';

export interface TextEdit {
  start: number;
  end: number;
  /** Length of the replacement text. */
  length: number;
}

/** The fields a relocation rewrites; the rest round-trip untouched. */
interface RawSourceMap {
  sourceRoot?: string;
  sources: string[];
  mappings: string;
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map([...BASE64].map((char, index) => [char, index]));

function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined)
      throw new Error(`invalid mapping character ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function encodeValue(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (
    let index = text.indexOf('\n');
    index !== -1;
    index = text.indexOf('\n', index + 1)
  ) {
    starts.push(index + 1);
  }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Where `offset` in the original text lands after `edits`, or null when an
 *  edit replaced it. An edit's first character keeps its place. */
function shiftOffset(
  edits: readonly TextEdit[],
  offset: number
): number | null {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.start) break;
    if (offset === edit.start) return offset + delta;
    if (offset < edit.end) return null;
    delta += edit.length - (edit.end - edit.start);
  }
  return offset + delta;
}

/** The map for a declaration rewritten by `edits` (sorted, disjoint) and
 *  moved from `fromFile` to `toFile`, as JSON text. */
export function relocateDeclarationMap(
  mapText: string,
  original: string,
  rewritten: string,
  edits: readonly TextEdit[],
  fromFile: string,
  toFile: string
): string {
  // SAFETY: a declaration map is compiler output; the fields read below are
  // the v3 ones, and a malformed map throws during decoding.
  const map = JSON.parse(mapText) as RawSourceMap;
  const fromDir = dirname(fromFile);
  const toDir = dirname(toFile);
  map.sources = map.sources.map((source) =>
    toPosix(relative(toDir, resolve(fromDir, map.sourceRoot ?? '', source)))
  );
  delete map.sourceRoot;
  if (edits.length === 0) return JSON.stringify(map);

  const before = lineStarts(original);
  const after = lineStarts(rewritten);
  const moved: number[][][] = after.map(() => []);
  const state = [0, 0, 0, 0];
  map.mappings.split(';').forEach((line, lineIndex) => {
    let column = 0;
    for (const segment of line.split(',')) {
      if (segment === '') continue;
      const fields = decodeSegment(segment);
      column += fields[0];
      const rest: number[] = [];
      for (let index = 1; index < fields.length; index += 1) {
        state[index - 1] += fields[index];
        rest.push(state[index - 1]);
      }
      const offset = shiftOffset(edits, before[lineIndex] + column);
      if (offset === null) continue;
      const target = lineOf(after, offset);
      moved[target].push([offset - after[target], ...rest]);
    }
  });

  const previous = [0, 0, 0, 0];
  map.mappings = moved
    .map((segments) => {
      let lastColumn = 0;
      return segments
        .sort((a, b) => a[0] - b[0])
        .map(([column, ...rest]) => {
          let out = encodeValue(column - lastColumn);
          lastColumn = column;
          rest.forEach((value, index) => {
            out += encodeValue(value - previous[index]);
            previous[index] = value;
          });
          return out;
        })
        .join(',');
    })
    .join(';');
  return JSON.stringify(map);
}
