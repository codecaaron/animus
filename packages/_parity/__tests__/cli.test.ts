import { spawnSync } from 'child_process';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import {
  EXIT_GATE_FAILED,
  EXIT_REFUSED,
  EXIT_UNEXPECTED,
  ParityRefusal,
  baselineStaleFailureMessage,
  classifyCliFailure,
} from '../src/cli-messages';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'src/cli.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const STACK_FRAME = /\n\s+at /;

function run(...args: string[]) {
  const result = spawnSync('bun', ['run', CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return result;
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

    expect(result.status).toBe(EXIT_REFUSED);
    expect(result.stderr.trim()).toBe('--refresh-baseline requires a value');
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });

  test('an unknown option fails instead of running ordinary parity', () => {
    const result = run('--refresh-basline', 'intent-typo');

    expect(result.status).toBe(EXIT_REFUSED);
    expect(result.stderr.trim()).toBe('unknown option: --refresh-basline');
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });

  test('a thread pair outside self-check refuses on one line', () => {
    const result = run('--threads', '1,8');

    expect(result.status).toBe(EXIT_REFUSED);
    expect(result.stderr.trim()).toBe(
      '--threads is available only with --self-check'
    );
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });

  test('an engine that cannot start is unexpected: exit 3 with a stack', () => {
    const bun = spawnSync('bun', ['--eval', 'console.log(process.execPath)'], {
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    if (bun.error) throw bun.error;
    expect(bun.status).toBe(0);

    const result = spawnSync(bun.stdout.trim(), ['run', CLI, '--self-check'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, PATH: '' },
    });
    if (result.error) throw result.error;

    expect(result.status).toBe(EXIT_UNEXPECTED);
    expect(result.stderr).toContain('engine v2 run failed');
    expect(result.stderr).toMatch(STACK_FRAME);
    expect(result.stdout).not.toContain('PARITY GATE: PASS');
  });
});

describe('parity engine subprocess', () => {
  test('an unexpected failure exits 3 with a stack, as the CLI does', () => {
    const result = spawnSync(
      'bun',
      ['run', join(ROOT, 'src/engine-run.ts'), '--engine', 'bogus'],
      { cwd: ROOT, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS }
    );
    if (result.error) throw result.error;

    expect(result.status).toBe(EXIT_UNEXPECTED);
    expect(result.stderr).toContain("unknown engine 'bogus'");
    expect(result.stderr).toMatch(STACK_FRAME);
  });
});

describe('classifyCliFailure', () => {
  test('a refusal carries its message alone and the refusal exit code', () => {
    expect(
      classifyCliFailure(new ParityRefusal('unknown option: --nope'))
    ).toEqual({ exitCode: 2, stderr: 'unknown option: --nope' });
  });

  test('any other error carries its stack and a distinct exit code', () => {
    const failure = classifyCliFailure(new TypeError('engine boundary broke'));

    expect(failure.exitCode).toBe(3);
    expect(failure.stderr).toContain('TypeError: engine boundary broke');
    expect(failure.stderr).toMatch(STACK_FRAME);
  });

  test('neither failure code collides with the gate verdict code', () => {
    expect(
      new Set([EXIT_GATE_FAILED, EXIT_REFUSED, EXIT_UNEXPECTED]).size
    ).toBe(3);
  });
});
