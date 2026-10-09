/**
 * Writes the extractor's `layer_order.json` from `ANIMUS_LAYERS`, the one
 * cascade layer order, so the engine emits the order the assembler and the
 * structural self-check read.
 *
 * Usage: node packages/extract/scripts/layer-order.ts --write
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANIMUS_LAYERS } from '../pipeline/assemble-stylesheet.ts';
import { checkFormatterRun } from './css-keywords.ts';

const ROOT = join(import.meta.dirname, '../../..');

const LAYER_FILE = join(
  ROOT,
  'packages/extract/crates/extract-v2/src/layer_order.json'
);

if (process.argv.includes('--write')) {
  writeFileSync(LAYER_FILE, `${JSON.stringify(ANIMUS_LAYERS, null, 2)}\n`);
  // The committed bytes are the repository formatter's layout.
  checkFormatterRun(
    spawnSync(join(ROOT, 'node_modules/.bin/vp'), ['fmt', LAYER_FILE], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  );
}
