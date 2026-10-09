/**
 * Writes the extractor's `property_table.json` from the property table in
 * `@animus-ui/properties`: the unitless property names and the vendor
 * prefixes of style keys, so the crate never keeps its own copy.
 *
 * Usage: node packages/extract/scripts/property-table.ts --write
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  UNITLESS_PROPERTIES,
  VENDOR_PREFIXES,
} from '../../properties/src/unitless.ts';

const ROOT = join(import.meta.dirname, '../../..');

const PROPERTY_TABLE_FILE = join(
  ROOT,
  'packages/extract/crates/extract-v2/src/property_table.json'
);

if (process.argv.includes('--write')) {
  const table = {
    unitless: [...UNITLESS_PROPERTIES].sort(),
    vendorPrefixes: VENDOR_PREFIXES,
  };
  writeFileSync(PROPERTY_TABLE_FILE, `${JSON.stringify(table, null, 2)}\n`);
  // The committed bytes are the repository formatter's layout.
  const formatted = spawnSync(
    join(ROOT, 'node_modules/.bin/vp'),
    ['fmt', PROPERTY_TABLE_FILE],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (formatted.error || formatted.status !== 0) {
    const ended = formatted.error?.message ?? `status ${formatted.status}`;
    throw new Error(
      `property-table: vp fmt failed (${ended})\n${formatted.stdout ?? ''}${formatted.stderr ?? ''}`
    );
  }
}
