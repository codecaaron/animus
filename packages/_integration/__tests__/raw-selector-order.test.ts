import { expect, test } from 'vitest';

import { config } from '../fixtures/setup';
import { analyzeProject } from './run-pipeline';

/**
 * Raw selector and at-rule keys keep their authored order, so the last
 * authored of two equal-specificity rules wins; selector and condition
 * aliases keep their established ranking, in the slots aliases take. A raw
 * key and an alias that name one selector split by the key that wrote each
 * declaration.
 */
const source = `import { ds } from './setup';
export const Row = ds.styles({
  cursor: 'default',
  '&[data-accent="danger"]': { cursor: 'help' },
  _disabled: { opacity: 0.5 },
  '&:hover': { cursor: 'pointer' },
  '@media print': { cursor: 'auto' },
  _hover: { outline: 'none' },
  '&[data-disabled]': { cursor: 'not-allowed' },
}).asElement('div');
export const Chip = ds.styles({
  _disabled: { opacity: 0.5 },
  _hover: { opacity: 1 },
}).asElement('span');
export const App = () => <><Row /><Chip /></>;`;
const manifest = JSON.parse(
  analyzeProject(JSON.stringify([{ path: 'fixtures/raw-order.tsx', source }]), {
    selectorAliasesJson: config.selectorAliases,
  })
);
const baseSheet: string = manifest.sheets.base.replace(/\s+/g, ' ');

/** Each rule a component's base emits, in order: its media query, its first
 *  selector branch after the class, and its declarations. */
const rulesOf = (binding: string) => {
  const className = `.${manifest.components[`fixtures/raw-order.tsx::${binding}`].class_name}`;
  return [
    ...baseSheet.matchAll(/(@media [^{]+)?\{? ?([^{}@]+) \{ ([^{}]*) \}/g),
  ]
    .filter(([, , selector]) => selector.trim().startsWith(className))
    .map(([, media, selector, body]) =>
      [
        media?.trim(),
        selector.trim().split(',')[0].slice(className.length),
        body.trim(),
      ]
        .filter(Boolean)
        .join(' ')
    );
};

test('raw keys keep their authored order, and aliases their ranking', () => {
  expect(rulesOf('Row')).toEqual([
    'cursor: default;',
    '[data-accent="danger"] cursor: help;',
    ':hover outline: none;',
    ':hover cursor: pointer;',
    '@media print cursor: auto;',
    ':disabled opacity: 0.5;',
    '[data-disabled] cursor: not-allowed;',
  ]);
});

test('aliases alone keep their ranking whatever their authored order', () => {
  expect(rulesOf('Chip')).toEqual([
    ':hover opacity: 1;',
    ':disabled opacity: 0.5;',
  ]);
});
