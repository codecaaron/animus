import { readFileSync, writeFileSync, existsSync } from 'fs';
/**
 * G-SEAM battery (row 07 Task 07.1; transform-evaluation-contract):
 * characterizes the transform-evaluation seam with RECORDED expectations
 * from v1's production (QuickJS) path. Cases cover: number/string
 * coercion + formatting, exponent thresholds, negatives (negation
 * helper), scale-key stringification, inline + named transforms,
 * cross-file name collisions (last-registration-wins), throwing
 * transforms, and exotic (\r) strings.
 *
 * Modes:
 *   bun run seam-battery.ts --record      # (re)write seam-baseline.json from v1
 *   bun run seam-battery.ts               # assert v1 against the baseline
 *   bun run seam-battery.ts --engine v2   # assert v2 against the baseline
 *
 * Promoted from openspec/changes/extract-v2-spine/tools/ at row 07 close:
 * the battery is standing harness infrastructure (verify:parity tier).
 */
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require_ = createRequire(import.meta.url);
const v1 = require_(join(ROOT, 'packages/extract/index.js'));

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

function runV1(c: Case): { css: string; diagnostics: unknown } {
  v1.clearAnalysisCache();
  const m = JSON.parse(
    v1.analyzeProject(
      JSON.stringify(c.files),
      theme.scalesJson,
      theme.variableMapJson,
      theme.contextualVarsJson || null,
      config.propConfig,
      config.groupRegistry,
      '{}',
      false,
      null,
      config.selectorAliases ?? null,
      config.selectorOrder ?? null,
      null,
      null,
      null
    )
  );
  return { css: m.css ?? '', diagnostics: m.diagnostics ?? [] };
}

function runV2(c: Case): { css: string; diagnostics: unknown } {
  const v2 = require_(join(ROOT, 'packages/extract/index-v2.js'));
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
const engineArg = process.argv.indexOf('--engine');
const engineName = engineArg !== -1 ? process.argv[engineArg + 1] : 'v1';

if (record && engineName !== 'v1') {
  // The baseline is a RECORDING OF V1 — recording from any other engine
  // would make the battery a tautology (review F5, gate-integrity pass).
  console.log('seam-battery: --record only records from v1');
  process.exit(1);
}

const results: Record<string, { css: string; diagnostics: unknown }> = {};
for (const c of CASES) {
  results[c.id] = engineName === 'v2' ? runV2(c) : runV1(c);
}

if (record) {
  writeFileSync(BASELINE, JSON.stringify(results, null, 2));
  console.log(
    `seam-battery: recorded ${CASES.length} cases to seam-baseline.json`
  );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('seam-battery: no baseline — run with --record first');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
let failures = 0;
for (const c of CASES) {
  const want = JSON.stringify(baseline[c.id]);
  const got = JSON.stringify(results[c.id]);
  if (want !== got) {
    console.log(`FAIL ${c.id}`);
    failures++;
  }
}
console.log(
  `seam-battery[${engineName}]: ${CASES.length - failures}/${CASES.length} match baseline`
);
process.exit(failures ? 1 : 0);
