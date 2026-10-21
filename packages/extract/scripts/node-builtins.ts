/**
 * Writes the extractor's `node_builtins.json` from Node 24's
 * `module.builtinModules`: the specifiers that name a module built into
 * Node, which imports nothing the analysis holds.
 *
 * Usage: node packages/extract/scripts/node-builtins.ts --write
 *        node packages/extract/scripts/node-builtins.ts --check
 *
 * Both run under Node 24 only, the pinned list's version. `--check` writes
 * nothing: it exits non-zero, naming each difference, when
 * `node_builtins.json` holds another list.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

import { checkFormatterRun } from './css-keywords.ts';

const ROOT = join(import.meta.dirname, '../../..');

const BUILTINS_FILE = join(
  ROOT,
  'packages/extract/crates/extractor/src/node_builtins.json'
);

const NODE_MAJOR = 24;

const major = Number(process.versions.node.split('.')[0]);
if (major !== NODE_MAJOR) {
  process.stderr.write(
    `node-builtins: the list is Node ${NODE_MAJOR}'s; this is Node ${process.versions.node}\n`
  );
  process.exit(1);
}

const expected = [...builtinModules].sort();

if (process.argv.includes('--write')) {
  writeFileSync(BUILTINS_FILE, `${JSON.stringify(expected, null, 2)}\n`);
  // The committed bytes are the repository formatter's layout.
  checkFormatterRun(
    spawnSync(join(ROOT, 'node_modules/.bin/vp'), ['fmt', BUILTINS_FILE], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  );
}

if (process.argv.includes('--check')) {
  const generated: string[] = JSON.parse(readFileSync(BUILTINS_FILE, 'utf8'));
  const missing = expected.filter((name) => !generated.includes(name));
  const extra = generated.filter((name) => !expected.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    for (const name of missing) {
      process.stderr.write(`node_builtins.json lacks ${name}\n`);
    }
    for (const name of extra) {
      process.stderr.write(
        `node_builtins.json has ${name}, which Node ${NODE_MAJOR} lacks\n`
      );
    }
    process.stderr.write(
      'Regenerate it: node packages/extract/scripts/node-builtins.ts --write\n'
    );
    process.exit(1);
  }
}
