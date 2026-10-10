import { expect, test } from 'vitest';

import { config } from '../fixtures/setup';
import { analyzeProject } from './run-pipeline';

test('a registered global keeps a nested condition, under its own selector', () => {
  const manifest = JSON.parse(
    analyzeProject('[]', {
      globalStyleBlocksJson: JSON.stringify({
        base: {
          html: {
            scrollBehavior: 'auto',
            _motionSafe: { scrollBehavior: 'smooth' },
          },
        },
      }),
      conditionAliasesJson: config.conditionAliases,
    })
  );

  expect(manifest.sheets.global).toContain(
    '@media (prefers-reduced-motion: no-preference) {\n  html {\n    scroll-behavior: smooth;\n  }\n}'
  );
});

test('a global emits its selector and condition keys in authored order, like a component', () => {
  const manifest = JSON.parse(
    analyzeProject('[]', {
      globalStyleBlocksJson: JSON.stringify({
        base: {
          a: {
            cursor: 'default',
            _print: { cursor: 'help' },
            '&:hover': { cursor: 'pointer' },
            _motionReduce: { cursor: 'wait' },
            '&:focus': { cursor: 'move' },
            '&:active': { cursor: 'grab', '&': { cursor: 'grabbing' } },
          },
        },
      }),
      conditionAliasesJson: config.conditionAliases,
    })
  );
  const cursors = [...manifest.sheets.global.matchAll(/cursor: (\w+);/g)].map(
    ([, cursor]) => cursor
  );
  // A block nested on its parent's own selector follows the parent's rule.
  expect(cursors).toEqual([
    'default',
    'help',
    'pointer',
    'wait',
    'move',
    'grabbing',
  ]);
});
