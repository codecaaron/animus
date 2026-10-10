/**
 * Writes the extractor's `property_table.json` from the property tables in
 * `@animus-ui/properties`: the unitless property names, the vendor prefixes
 * of style keys and the properties whose value is a single length, so the
 * crate never keeps its own copy.
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
import { ZERO_LENGTH_PROPERTIES } from '../../properties/src/zero-lengths.ts';

const ROOT = join(import.meta.dirname, '../../..');

const PROPERTY_TABLE_FILE = join(
  ROOT,
  'packages/extract/crates/extract-v2/src/property_table.json'
);

/** The table as `property_table.json` holds it. */
function propertyTable() {
  return {
    unitless: [...UNITLESS_PROPERTIES].sort(),
    vendorPrefixes: VENDOR_PREFIXES,
    zeroLengths: [...ZERO_LENGTH_PROPERTIES].sort(),
  };
}

if (process.argv.includes('--write')) {
  const table = propertyTable();
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
