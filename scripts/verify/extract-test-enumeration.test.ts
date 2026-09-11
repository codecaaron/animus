import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';
import { type TaskGraphConfig } from './manifest-model';

const ROOT = resolve(import.meta.dirname, '../..');
const EXTRACT_TESTS_DIR = join(ROOT, 'packages/extract/tests');
const EXTRACT_TESTS_PREFIX = 'packages/extract/tests';
const SESSION_TESTS_DIR = join(EXTRACT_TESTS_DIR, 'session');
const SESSION_TESTS_TARGET = 'packages/extract/tests/session';

/**
 * Absent from `verify:unit:ts` because they load the native engine and run
 * in `verify:canary`. A name here claims the file needs a NAPI binary.
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

/** Non-recursive on purpose: the flat files are the enumerated ones, and
 *  the session subdirectory is covered by its own directory target. */
function testFilesIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.test.ts'))
    .sort();
}

function extractTestFiles(): string[] {
  return testFilesIn(EXTRACT_TESTS_DIR);
}

function sessionTestFiles(): string[] {
  return testFilesIn(SESSION_TESTS_DIR);
}

/** One whole argument of the command, never a substring: a directory target
 *  must not be satisfied by an enumerated file inside it. */
function hasTarget(command: string, target: string): boolean {
  return command.split(/\s+/).includes(target);
}

/** `index-v2` is the package's own engine loader and the root export
 *  re-exports it; a test mentioning either is engine-bound. */
function loadsNativeEngine(source: string): boolean {
  return source.includes('index-v2') || source.includes("'@animus-ui/extract'");
}

describe('extract test enumeration', () => {
  it('discovers extract test files (non-vacuity)', () => {
    expect(extractTestFiles().length).toBeGreaterThan(10);
  });

  it('runs every engine-free extract test in verify:unit:ts', () => {
    const command = taskCommand('verify:unit:ts');
    const missing = extractTestFiles()
      .filter((file) => !ENGINE_BOUND.has(file))
      .filter((file) => !hasTarget(command, `${EXTRACT_TESTS_PREFIX}/${file}`));

    expect(
      missing,
      `These extract tests run in NO verification tier. Add them to ` +
        `typescriptTestTargets in vite.config.ts, or to ENGINE_BOUND here if ` +
        `they genuinely require a NAPI binary:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('covers the same extract tests in verify:coverage:ts', () => {
    const unit = taskCommand('verify:unit:ts');
    const coverage = taskCommand('verify:coverage:ts');
    const drift = extractTestFiles()
      .filter((file) => hasTarget(unit, `${EXTRACT_TESTS_PREFIX}/${file}`))
      .filter(
        (file) => !hasTarget(coverage, `${EXTRACT_TESTS_PREFIX}/${file}`)
      );

    expect(drift).toEqual([]);
  });

  it('does not enumerate engine-bound tests in verify:unit:ts', () => {
    // An engine-bound test in the engine-free tier fails there on a missing
    // or stale .node instead of verify:canary's PREPARE: line.
    const command = taskCommand('verify:unit:ts');
    const smuggled = [...ENGINE_BOUND].filter((file) =>
      hasTarget(command, `${EXTRACT_TESTS_PREFIX}/${file}`)
    );

    expect(smuggled).toEqual([]);
  });

  it('declares as ENGINE_BOUND exactly the flat tests that load the native engine', () => {
    const detected = extractTestFiles().filter((file) =>
      loadsNativeEngine(readFileSync(join(EXTRACT_TESTS_DIR, file), 'utf8'))
    );
    expect(detected).toEqual([...ENGINE_BOUND].sort());
  });

  it('keeps ENGINE_BOUND free of names that no longer exist', () => {
    const present = new Set(extractTestFiles());
    const stale = [...ENGINE_BOUND].filter((file) => !present.has(file));

    expect(stale).toEqual([]);
  });
});

describe('extract session test directory', () => {
  it('discovers session test files (non-vacuity)', () => {
    expect(sessionTestFiles().length).toBeGreaterThan(5);
  });

  it('runs the session directory as one target in verify:unit:ts', () => {
    expect(hasTarget(taskCommand('verify:unit:ts'), SESSION_TESTS_TARGET)).toBe(
      true
    );
  });

  it('covers the session directory in verify:coverage:ts', () => {
    expect(
      hasTarget(taskCommand('verify:coverage:ts'), SESSION_TESTS_TARGET)
    ).toBe(true);
  });

  it('keeps every session test engine-free', () => {
    // The directory runs under the install-only tier; a test that loads the
    // native module belongs flat in tests/ and in ENGINE_BOUND.
    const loadsNative = sessionTestFiles().filter((file) =>
      loadsNativeEngine(readFileSync(join(SESSION_TESTS_DIR, file), 'utf8'))
    );
    expect(loadsNative).toEqual([]);
  });
});
