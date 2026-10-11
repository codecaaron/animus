/**
 * Writes the system loader's `extension_policy.json` from `EXTENSION_POLICY`,
 * the one extension policy, so the system loader and the extractor probe the
 * files source ingestion probes, in the same order.
 *
 * Usage: node packages/extract/scripts/extension-policy.ts --write
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
