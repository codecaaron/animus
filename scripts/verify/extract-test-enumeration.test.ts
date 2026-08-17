import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';
import { type TaskGraphConfig } from './manifest-model';

/**
 * `packages/extract/tests/` is deliberately NOT globbed wholesale by
 * `verify:unit:ts` — two of its files need a fresh NAPI binary and run under
 * `verify:canary` instead. That makes the enumeration in vite.config.ts a
 * hand-maintained list, and a hand-maintained list silently drops whatever
 * nobody remembers to add: `error-diagnostics.test.ts` and
 * `source-identity.test.ts` each shipped into no tier at all.
 *
 * This asserts against the task's real command string rather than a
 * re-exported array, so it checks what actually runs.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const EXTRACT_TESTS_DIR = join(ROOT, 'packages/extract/tests');
const EXTRACT_TESTS_PREFIX = 'packages/extract/tests';

/**
 * The only two files allowed to be absent from `verify:unit:ts`: both load the
 * native engine, so they run in `verify:canary` (see scripts/verify/canary.sh).
 * Adding a name here is a deliberate claim that the file needs a NAPI binary.
 */
const ENGINE_BOUND = new Set([
  'canary.test.ts',
  'static-css-overrides.test.ts',
]);

function taskCommand(name: string): string {
  // SAFETY: `vite.config.ts` declares `run.tasks`; TaskGraphConfig models that
  // slice with every level optional, so the read below cannot assume presence.
  const tasks = (viteConfig as TaskGraphConfig).run?.tasks;
  const command = tasks?.[name]?.command;
  if (!command) throw new Error(`vite.config.ts declares no '${name}' command`);
  return command;
}

function extractTestFiles(): string[] {
  return readdirSync(EXTRACT_TESTS_DIR)
    .filter((entry) => entry.endsWith('.test.ts'))
    .sort();
}

describe('extract test enumeration', () => {
  it('discovers extract test files (non-vacuity)', () => {
    // Without this, a bad path would make every assertion below pass on an
    // empty set — the exact failure mode this suite exists to catch.
    expect(extractTestFiles().length).toBeGreaterThan(10);
  });

  it('runs every engine-free extract test in verify:unit:ts', () => {
    const command = taskCommand('verify:unit:ts');
    const missing = extractTestFiles()
      .filter((file) => !ENGINE_BOUND.has(file))
      .filter((file) => !command.includes(`${EXTRACT_TESTS_PREFIX}/${file}`));

    expect(
      missing,
      `These extract tests run in NO verification tier. Add them to ` +
        `typescriptTestTargets in vite.config.ts, or to ENGINE_BOUND here if ` +
        `they genuinely require a NAPI binary:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('covers the same extract tests in verify:coverage:ts', () => {
    // The coverage tier derives from the same target list; if the two ever
    // diverge, coverage silently under-reports rather than failing.
    const unit = taskCommand('verify:unit:ts');
    const coverage = taskCommand('verify:coverage:ts');
    const drift = extractTestFiles()
      .filter((file) => unit.includes(`${EXTRACT_TESTS_PREFIX}/${file}`))
      .filter((file) => !coverage.includes(`${EXTRACT_TESTS_PREFIX}/${file}`));

    expect(drift).toEqual([]);
  });

  it('does not enumerate engine-bound tests in verify:unit:ts', () => {
    // The inverse guard: an engine-bound test smuggled into the engine-free
    // tier fails loud there with a missing/stale .node instead of a clear
    // PREPARE: line from verify:canary.
    const command = taskCommand('verify:unit:ts');
    const smuggled = [...ENGINE_BOUND].filter((file) =>
      command.includes(`${EXTRACT_TESTS_PREFIX}/${file}`)
    );

    expect(smuggled).toEqual([]);
  });

  it('keeps ENGINE_BOUND free of names that no longer exist', () => {
    const present = new Set(extractTestFiles());
    const stale = [...ENGINE_BOUND].filter((file) => !present.has(file));

    expect(stale).toEqual([]);
  });
});
