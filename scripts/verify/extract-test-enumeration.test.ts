import { readdirSync, readFileSync } from 'node:fs';
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
/** The driver-shared session-engine suites: targeted as one directory, so
 *  the flat enumeration above never has to grow for them. */
const SESSION_TESTS_DIR = join(EXTRACT_TESTS_DIR, 'session');
const SESSION_TESTS_TARGET = 'packages/extract/tests/session';

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

/** The test files directly inside one directory. Non-recursive on purpose:
 *  the flat files are the enumerated ones, and the session subdirectory is
 *  covered by its own directory-target assertions below. */
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

/** Whether a file or directory target is one whole argument of the command,
 *  never a substring of a longer path (the directory target must not be
 *  satisfied by an enumerated file inside it, nor a file by a look-alike). */
function hasTarget(command: string, target: string): boolean {
  return command.split(/\s+/).includes(target);
}

/** The two ways an extract test reaches the native engine: the package's own
 *  loader module, or the package root export that re-exports it. A session
 *  test that mentions either belongs flat in tests/ and in ENGINE_BOUND. */
function loadsNativeEngine(source: string): boolean {
  return source.includes('index-v2') || source.includes("'@animus-ui/extract'");
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
      .filter((file) => !hasTarget(command, `${EXTRACT_TESTS_PREFIX}/${file}`));

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
      .filter((file) => hasTarget(unit, `${EXTRACT_TESTS_PREFIX}/${file}`))
      .filter(
        (file) => !hasTarget(coverage, `${EXTRACT_TESTS_PREFIX}/${file}`)
      );

    expect(drift).toEqual([]);
  });

  it('does not enumerate engine-bound tests in verify:unit:ts', () => {
    // The inverse guard: an engine-bound test smuggled into the engine-free
    // tier fails loud there with a missing/stale .node instead of a clear
    // PREPARE: line from verify:canary.
    const command = taskCommand('verify:unit:ts');
    const smuggled = [...ENGINE_BOUND].filter((file) =>
      hasTarget(command, `${EXTRACT_TESTS_PREFIX}/${file}`)
    );

    expect(smuggled).toEqual([]);
  });

  it('declares as ENGINE_BOUND exactly the flat tests that load the native engine', () => {
    // ENGINE_BOUND is a hand-written list; the detector below is what decides
    // engine-boundness for the session directory. Holding the two equal keeps
    // one authority: a flat test that starts loading the engine must be
    // declared, and a declared name must still load it.
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
    // `extractTestFiles()` is a non-recursive read, so a session test dropped
    // into the subdirectory is invisible to the flat guard; the directory
    // target is what puts every file there in a tier.
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
    // The directory runs under the bun-install-only tier. A test that loads
    // the native module belongs flat in tests/ and in ENGINE_BOUND instead.
    const loadsNative = sessionTestFiles().filter((file) =>
      loadsNativeEngine(readFileSync(join(SESSION_TESTS_DIR, file), 'utf8'))
    );
    expect(loadsNative).toEqual([]);
  });
});
