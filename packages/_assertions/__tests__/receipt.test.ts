import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { type LaneReceipt, writeLaneReceipt } from '../src/receipt';

const dirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-receipt-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeLaneReceipt', () => {
  it('round-trips all eight fields through JSON.parse', () => {
    const receipt: LaneReceipt = {
      lane: 'verify:assert:vite',
      host: 'vite',
      hostVersion: '7.1.2',
      mode: 'production',
      engineLoaded: 'v2',
      engineDefault: 'v2',
      engineOverride: false,
      packageForm: 'workspace',
    };
    const path = join(scratchDir(), 'verify-assert-vite.json');

    writeLaneReceipt(path, receipt);

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LaneReceipt;
    expect(parsed).toEqual(receipt);
    // Explicitly prove every one of the eight fields survived.
    for (const key of [
      'lane',
      'host',
      'hostVersion',
      'mode',
      'engineLoaded',
      'engineDefault',
      'engineOverride',
      'packageForm',
    ] as const) {
      expect(parsed).toHaveProperty(key);
    }
  });

  it('creates missing parent directories and appends a trailing newline', () => {
    const receipt: LaneReceipt = {
      lane: 'verify:assert:next',
      host: 'next',
      hostVersion: '15.5.0',
      mode: 'production',
      engineLoaded: 'v1',
      engineDefault: 'v2',
      engineOverride: true,
      packageForm: 'workspace',
    };
    // Nested, not-yet-existing path proves mkdirSync recursive.
    const path = join(
      scratchDir(),
      'nested',
      '.receipts',
      'verify-assert-next.json'
    );

    writeLaneReceipt(path, receipt);

    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(receipt);
  });
});
