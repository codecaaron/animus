/**
 * Increment 01 determinism runner: extracts every .tsx fixture via the v1
 * NAPI binding and prints a canonical JSON of consumer-visible outputs
 * (emitted CSS + transformed code). Run in a FRESH process per invocation —
 * cross-process comparison is the point (std HashMap RandomState is
 * per-process). Driven by determinism-check.sh.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Direct relative require — the documented workaround for the bun>=1.3.12
// createRequire "types"-condition bug (root CLAUDE.md § Key Rules).
const { extract } = require('../../../../packages/extract/index.js');

const FIXTURES = join(
  import.meta.dirname,
  '../../../../packages/extract/tests/fixtures'
);

import {
  serializedConfig,
  serializedGroupRegistry,
} from '../../../../packages/extract/tests/fixtures/serialize-config';
import {
  themeJson,
  variableMapJson,
} from '../../../../packages/extract/tests/fixtures/theme-fixture';

const out: Record<string, { css: string; code: string; errors: string[] }> = {};

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

for (const file of files) {
  const source = readFileSync(join(FIXTURES, file), 'utf-8');
  const result = extract(
    source,
    file,
    themeJson,
    variableMapJson,
    serializedConfig,
    serializedGroupRegistry
  );
  out[file] = { css: result.css, code: result.code, errors: result.errors };
}

process.stdout.write(JSON.stringify(out, null, 2));
