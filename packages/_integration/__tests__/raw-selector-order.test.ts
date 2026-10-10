import { expect, test } from 'vitest';

import { config } from '../fixtures/setup';
import { analyzeProject } from './run-pipeline';

/**
 * Selector and at-rule keys keep their authored order, raw keys and selector
 * and condition aliases alike, so the last authored of two equal-specificity
 * rules wins. A raw key and an alias that name one selector split by the key
 * that wrote each declaration.
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
export const Badge = ds.styles({
  _print: { opacity: 1 },
  _hover: { opacity: 0.8 },
  _motionReduce: { opacity: 0.9 },
}).asElement('em');
export const App = () => <><Row /><Chip /><Badge /></>;`;
const manifest = JSON.parse(
  analyzeProject(JSON.stringify([{ path: 'fixtures/raw-order.tsx', source }]), {
    selectorAliasesJson: config.selectorAliases,
    conditionAliasesJson: config.conditionAliases,
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

test('raw keys and aliases keep their authored order together', () => {
  expect(rulesOf('Row')).toEqual([
    'cursor: default;',
    '[data-accent="danger"] cursor: help;',
    ':disabled opacity: 0.5;',
    ':hover cursor: pointer;',
    '@media print cursor: auto;',
    ':hover outline: none;',
    '[data-disabled] cursor: not-allowed;',
  ]);
});

test('selector and condition aliases alone keep their authored order, not a registered rank', () => {
  expect(rulesOf('Chip')).toEqual([
    ':disabled opacity: 0.5;',
    ':hover opacity: 1;',
  ]);
  expect(rulesOf('Badge')).toEqual([
    '@media print opacity: 1;',
    ':hover opacity: 0.8;',
    '@media (prefers-reduced-motion: reduce) opacity: 0.9;',
  ]);
});
