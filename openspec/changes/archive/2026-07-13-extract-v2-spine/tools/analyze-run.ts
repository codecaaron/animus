/**
 * Increment 01 determinism runner for the analyzeProject + transformFile
 * path. Prints the consumer-visible surface (manifest CSS + per-file
 * transformed code) as canonical JSON; manifest byte size and wall time go
 * to stderr (baseline data — the raw manifest is excluded from the byte
 * surface by design: HashMap-ordered internal fields + timing).
 * Fresh process per invocation; driven by determinism-check-analyze.sh.
 * Usage: bun run analyze-run.ts [--dev]
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const {
  analyzeProject,
  transformFile,
  clearAnalysisCache,
} = require('../../../../packages/extract/index.js');

import {
  serializedConfig,
  serializedGroupRegistry,
} from '../../../../packages/extract/tests/fixtures/serialize-config';
import {
  contextualVarsJson,
  themeJson,
  variableMapJson,
} from '../../../../packages/extract/tests/fixtures/theme-fixture';

const FIXTURES = join(
  import.meta.dirname,
  '../../../../packages/extract/tests/fixtures'
);
const devMode = process.argv.includes('--dev');

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.tsx'))
  .sort();
const fileEntries = files.map((f) => ({
  path: f,
  source: readFileSync(join(FIXTURES, f), 'utf-8'),
}));

clearAnalysisCache();
const t0 = performance.now();
// Mirrors _integration/__tests__/run-pipeline.ts's production 14-arg call.
const manifestJson = analyzeProject(
  JSON.stringify(fileEntries),
  themeJson,
  variableMapJson,
  contextualVarsJson || null,
  serializedConfig,
  serializedGroupRegistry,
  '{}',
  devMode,
  null,
  null,
  null,
  null,
  null,
  null
);
const analyzeMs = performance.now() - t0;

const manifest = JSON.parse(manifestJson);
const out: Record<string, unknown> = {
  __css__: manifest.css || '',
  // Consumer-reaching manifest-derived bytes (virtual system-props module):
  // stringified verbatim, mirroring the vite-plugin composition point.
  __systemPropMap__: JSON.stringify(manifest.system_prop_map ?? {}),
  __dynamicProps__: JSON.stringify(manifest.dynamic_props ?? {}),
};

const t1 = performance.now();
for (const entry of fileEntries) {
  const r = transformFile(entry.source, entry.path, manifestJson);
  out[entry.path] = { code: r.code, hasComponents: r.hasComponents };
}
const transformMs = performance.now() - t1;

process.stderr.write(
  `baseline devMode=${devMode} files=${files.length} manifestBytes=${manifestJson.length} analyzeMs=${analyzeMs.toFixed(1)} transformMs=${transformMs.toFixed(1)}\n`
);
process.stdout.write(JSON.stringify(out, null, 2));
