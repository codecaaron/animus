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
