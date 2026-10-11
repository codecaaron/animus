/**
 * Writes the system loader's `extension_policy.json` from `EXTENSION_POLICY`,
 * the one extension policy, so the system loader and the extractor probe the
 * files source ingestion probes, in the same order.
 *
 * Usage: node packages/extract/scripts/extension-policy.ts --write
 *        node packages/extract/scripts/extension-policy.ts --check
 *
 * `--check` writes nothing: it exits non-zero, naming each difference, when
 * `extension_policy.json` holds another policy than `EXTENSION_POLICY`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXTENSION_POLICY } from '../pipeline/extension-policy.ts';
import { checkFormatterRun } from './css-keywords.ts';

const ROOT = join(import.meta.dirname, '../../..');

const POLICY_FILE = join(
  ROOT,
  'packages/extract/crates/system-loader/src/extension_policy.json'
);

if (process.argv.includes('--write')) {
  writeFileSync(POLICY_FILE, `${JSON.stringify(EXTENSION_POLICY, null, 2)}\n`);
  // The committed bytes are the repository formatter's layout.
  checkFormatterRun(
    spawnSync(join(ROOT, 'node_modules/.bin/vp'), ['fmt', POLICY_FILE], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  );
}

if (process.argv.includes('--check')) {
  const expected = JSON.parse(JSON.stringify(EXTENSION_POLICY));
  const generated = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
  const differences = (['appended', 'nodeNext'] as const).filter(
    (key) => JSON.stringify(generated[key]) !== JSON.stringify(expected[key])
  );
  const unknown = Object.keys(generated).filter((key) => !(key in expected));
  if (differences.length > 0 || unknown.length > 0) {
    for (const key of differences) {
      process.stderr.write(
        `extension_policy.json ${key} is ${JSON.stringify(generated[key])}; ` +
          `EXTENSION_POLICY ${key} is ${JSON.stringify(expected[key])}\n`
      );
    }
    for (const key of unknown) {
      process.stderr.write(
        `extension_policy.json has ${key}, which EXTENSION_POLICY lacks\n`
      );
    }
    process.stderr.write(
      'Regenerate it: node packages/extract/scripts/extension-policy.ts --write\n'
    );
    process.exit(1);
  }
}
