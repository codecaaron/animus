import { ZERO_LENGTH_PROPERTIES } from '@animus-ui/properties';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const TABLE = join(
  import.meta.dirname,
  '../crates/extract-v2/src/property_table.json'
);

// The extractor's copy of the single-length properties, which the strict
// types and the runtime resolver import directly.
test('property_table.json holds the single-length properties of @animus-ui/properties', () => {
  const table = JSON.parse(readFileSync(TABLE, 'utf8'));
  expect(table.zeroLengths).toEqual([...ZERO_LENGTH_PROPERTIES].sort());
});
