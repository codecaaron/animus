import { spawnSync } from 'child_process';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { baselineStaleFailureMessage } from '../src/cli-messages';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'src/cli.ts');

function run(...args: string[]) {
  return spawnSync('bun', ['run', CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

describe('parity CLI argument safety', () => {
  test('stale baseline failure names the guarded refresh command', () => {
    expect(baselineStaleFailureMessage()).toContain(
      'scripts/verify/refresh-parity-baseline.sh <checked-intent-id>'
    );
    expect(baselineStaleFailureMessage()).toContain(
      'exact register entries and a checked baseline intent'
    );
  });

  test('a refresh flag without an intent fails instead of running ordinary parity', () => {
    const result = run('--refresh-baseline');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--refresh-baseline requires a value');
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });

  test('an unknown option fails instead of running ordinary parity', () => {
    const result = run('--refresh-basline', 'intent-typo');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option: --refresh-basline');
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });
});
