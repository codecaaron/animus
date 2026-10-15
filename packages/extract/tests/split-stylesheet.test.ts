import { describe, expect, test } from 'vitest';

import { stylesheetSliceFiles } from '../pipeline/split-stylesheet';

// A sheet in emission order, with a comment and a string that spell a layer
// block, which must not open a slice.
const SHEET = [
  '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;',
  ':root{--color-ink:#111}',
  '@property --animus-gap_{syntax:"*";inherits:false}',
  '/* @layer anm-base{ */',
  '@layer anm-global{body{margin:0}.q::after{content:"@layer anm-system{"}}',
  '@layer anm-base{.a{color:red}}',
  '@layer anm-states{.a:hover{color:blue}}',
  '@layer anm-system{.u{gap:4px}}',
  '@layer anm-custom{.c{order:1}}',
  '',
].join('\n');

describe('stylesheetSliceFiles', () => {
  // Contract: the files a host publishes for `stylesheets: 'split'`,
  // linked in order, are the single sheet byte for byte, cut where the
  // components' and the utilities' first layers open.
  test('cuts the sheet into slices whose bytes in order are the sheet', () => {
    const files = stylesheetSliceFiles(SHEET, 'styles');
    expect(files.map(({ css }) => css).join('')).toBe(SHEET);
    expect(files.map(({ name }) => name.split('.')[1])).toEqual([
      'foundation',
      'components',
      'utilities',
    ]);
    expect(files[1]!.css).toBe(
      '@layer anm-base{.a{color:red}}\n@layer anm-states{.a:hover{color:blue}}\n'
    );
    expect(files[2]!.css).toBe(
      '@layer anm-system{.u{gap:4px}}\n@layer anm-custom{.c{order:1}}\n'
    );
  });
});
