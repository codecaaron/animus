import { existsSync, readFileSync } from 'fs';
/**
 * G-SEAM battery (row 07 Task 07.1; transform-evaluation-contract):
 * characterizes the transform-evaluation seam with RECORDED expectations
 * from the v2 production (QuickJS) path. Cases cover: number/string
 * coercion + formatting, exponent thresholds, negatives (negation
 * helper), scale-key stringification, inline + named transforms,
 * cross-file name collisions (last-registration-wins), throwing
 * transforms, and exotic (\r) strings.
 *
 * Modes:
 *   bun run seam-battery.ts --record --intent ID  # privileged v2 refresh
 *   bun run seam-battery.ts               # assert v2 against the baseline
 *
 * Promoted from openspec/changes/extract-v2-spine/tools/ at row 07 close:
 * the battery is standing harness infrastructure (verify:parity tier).
 */
import { createRequire } from 'module';
import { join } from 'path';

import { assertRefreshIntent } from '../src/baseline';
import { compareSeamResults, writeJsonFileAtomic } from '../src/seam-baseline';

const ROOT = join(import.meta.dirname, '../../..');
const require_ = createRequire(import.meta.url);
const v2 = require_(join(ROOT, 'packages/extract/index-v2.js'));

const { ds, tokens } = await import(
  join(ROOT, 'packages/extract/tests/test-system.ts')
);
const config = ds.toConfig();
const theme = tokens.serialize();

interface Case {
  id: string;
  files: Array<{ path: string; source: string }>;
}

const chain = (body: string) =>
  `import { ds } from '../test-system';\nexport const C = ds.styles({ ${body} }).asElement('div');\nexport const App = () => <C />;\n`;

const CASES: Case[] = [
  {
    id: 'number-through-rem-transform',
    files: [{ path: 'a.tsx', source: chain('fontSize: 14') }],
  },
  {
    id: 'string-passthrough',
    files: [{ path: 'a.tsx', source: chain("fontSize: '2em'") }],
  },
  {
    id: 'integer-no-transform',
    files: [{ path: 'a.tsx', source: chain('zIndex: 5') }],
  },
  {
    id: 'exponent-1e16',
    files: [{ path: 'a.tsx', source: chain('zIndex: 1e16') }],
  },
  {
    id: 'exponent-1e21',
    files: [{ path: 'a.tsx', source: chain('zIndex: 1e21') }],
  },
  {
    id: 'float-format',
    files: [{ path: 'a.tsx', source: chain('lineHeight: 1.50') }],
  },
  { id: 'negative-scale', files: [{ path: 'a.tsx', source: chain('m: -8') }] },
  { id: 'scale-key-number', files: [{ path: 'a.tsx', source: chain('p: 8') }] },
  {
    id: 'scale-key-string',
    files: [{ path: 'a.tsx', source: chain("p: '8'") }],
  },
  {
    id: 'scale-key-float-string',
    files: [{ path: 'a.tsx', source: chain("p: '8.0'") }],
  },
  {
    id: 'carriage-return-string',
    files: [{ path: 'a.tsx', source: chain("content: '\\r'") }],
  },
  {
    id: 'inline-transform-multiply',
    files: [
      {
        path: 'a.tsx',
        source:
          "import { ds } from '../test-system';\nexport const C = ds.props({ w: { property: 'width', transform: (v) => v * 4 } }).asElement('div');\nexport const App = () => <C w={4} />;\n",
      },
    ],
  },
  {
    id: 'named-transform-cross-file-collision',
    files: [
      {
        path: 'one.tsx',
        source:
          "import { createTransform } from '@animus-ui/system';\nexport const t1 = createTransform('battle', (v) => `${v}px`);\n",
      },
      {
        path: 'two.tsx',
        source:
          "import { createTransform } from '@animus-ui/system';\nexport const t2 = createTransform('battle', (v) => `${v}rem`);\n",
      },
      {
        path: 'use.tsx',
        source:
          "import { ds } from '../test-system';\nexport const C = ds.props({ q: { property: 'left', transformName: 'battle' } }).asElement('div');\nexport const App = () => <C q={3} />;\n",
      },
    ],
  },
  {
    id: 'throwing-transform',
    files: [
      {
        path: 'a.tsx',
        source:
          "import { ds } from '../test-system';\nexport const C = ds.props({ w: { property: 'width', transform: (v) => { throw new Error('boom'); } } }).asElement('div');\nexport const App = () => <C w={4} />;\n",
      },
    ],
  },
];

function runV2(c: Case): { css: string; diagnostics: unknown } {
  const engine = new v2.ExtractEngine({
    themeJson: theme.scalesJson,
    variableMapJson: theme.variableMapJson,
    contextualVarsJson: theme.contextualVarsJson || undefined,
    configJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    selectorAliasesJson: config.selectorAliases ?? undefined,
  });
  const m = JSON.parse(engine.analyze(JSON.stringify(c.files)));
  return { css: m.css ?? '', diagnostics: m.diagnostics ?? [] };
}

const BASELINE = join(import.meta.dirname, 'seam-baseline.json');
const record = process.argv.includes('--record');
const intentIndex = process.argv.indexOf('--intent');
const intent = intentIndex === -1 ? null : process.argv[intentIndex + 1];

if (record) {
  if (!intent) {
    console.log(
      'seam-battery: --record requires --intent ID from baseline-intents.md'
    );
    process.exit(1);
  }
  assertRefreshIntent(
    intent,
    readFileSync(join(ROOT, 'packages/_parity/baseline-intents.md'), 'utf8')
  );
}

const results: Record<string, { css: string; diagnostics: unknown }> = {};
for (const c of CASES) {
  results[c.id] = runV2(c);
}

if (record) {
  writeJsonFileAtomic(BASELINE, results);
  console.log(
    `seam-battery: recorded ${CASES.length} v2 cases to seam-baseline.json (${intent})`
  );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('seam-battery: no baseline — run with --record first');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
const failures = compareSeamResults(baseline, results);
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(
  failures.length
    ? `seam-battery[v2]: ${failures.length} mismatch(es)`
    : `seam-battery[v2]: ${CASES.length}/${CASES.length} match baseline`
);
process.exit(failures.length ? 1 : 0);
