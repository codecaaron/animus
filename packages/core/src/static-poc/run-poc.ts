/* eslint-disable no-console */
/**
 * Simple POC test runner
 * Run with: yarn ts-node packages/core/src/static-poc/run-poc.ts
 */

import { animus } from '../index';
import { AnimusStatic, getStyleSheet } from './static-mode';

// ANSI color codes for output
const _green = '\x1b[32m';
const _red = '\x1b[31m';
const _reset = '\x1b[0m';

function assert(condition: boolean, message: string) {
  if (condition) {
  } else {
    process.exit(1);
  }
}
AnimusStatic.enable();

const Button = animus
  .styles({
    padding: '1rem',
    backgroundColor: 'blue',
    color: 'white',
  })
  .asElement('button');

// Create a mock component to test
const mockProps = {};
const result = (Button as any).__emotion_styles(mockProps);

assert(result.className.includes('_p-1rem'), 'Should include padding class');
assert(
  result.className.includes('_bg-blue'),
  'Should include background color class'
);
assert(result.className.includes('_col-white'), 'Should include color class');

const css = getStyleSheet();
assert(
  css.includes('._p-1rem { padding: 1rem; }'),
  'Should generate padding CSS'
);
assert(
  css.includes('._bg-blue { background-color: blue; }'),
  'Should generate background CSS'
);
assert(
  css.includes('._col-white { color: white; }'),
  'Should generate color CSS'
);

AnimusStatic.disable();
AnimusStatic.enable();

const VariantButton = animus
  .styles({
    padding: '1rem',
    backgroundColor: 'gray',
  })
  .variant({
    prop: 'size',
    variants: {
      small: { padding: '0.5rem' },
      large: { padding: '1.5rem' },
    },
  })
  .asElement('button');

const smallResult = (VariantButton as any).__emotion_styles({ size: 'small' });
assert(
  smallResult.className.includes('_p-0_5rem'),
  'Small variant should override padding'
);
assert(
  !smallResult.className.includes('_p-1rem'),
  'Small variant should not include base padding'
);

const largeResult = (VariantButton as any).__emotion_styles({ size: 'large' });
assert(
  largeResult.className.includes('_p-1_5rem'),
  'Large variant should override padding'
);

AnimusStatic.disable();
