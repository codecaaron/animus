import {
  AnimusConfigError,
  createExcludeMatcher,
  RETIRED_ENGINE_MESSAGE,
} from '@animus-ui/extract/pipeline';
import {
  CLI_LOCK_HEARTBEAT_INTERVAL_MS,
  collectSessionAssets,
  getSessionArtifactDir,
  verifyCommitRecord,
} from '@animus-ui/extract/session';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import {
  createCliSession,
  EnvironmentFailure,
  ExtractionFailure,
  runBuild,
  UsageFailure,
} from '../src/build';
import {
  inferredRootNotice,
  projectResolvedConfig,
  resolveCliConfig,
} from '../src/config';
import {
  exitCodeFor,
  EXIT_ENVIRONMENT,
  EXIT_EXTRACTION,
  EXIT_INSTALL,
  EXIT_USAGE,
  main,
} from '../src/index';
import {
  EXIT_SIGINT,
  EXIT_SIGTERM,
  installShutdownSignals,
} from '../src/signals';
import {
  collectDegradedRoots,
  formatCyclePublishFailure,
  formatDegradedRootLine,
} from '../src/watch';
import {
  acquireLock,
  publishArtifacts,
  PublishSwapIncompleteError,
} from '../src/writer';

import type { CliLockRecord } from '@animus-ui/extract/session';

const makeRoot = (): string => mkdtempSync(join(tmpdir(), 'animus-cli-'));

const lockRecord = ({
  pid = process.pid,
  ageMs = 0,
}: { pid?: number; ageMs?: number } = {}): CliLockRecord => {
  const at = new Date(Date.now() - ageMs).toISOString();
  return { pid, startedAt: at, heartbeatAt: at };
};

describe('config resolution', () => {
  test('flags override the config file; provenance is reported', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './file-ds.ts', strict: false })
    );
    const config = await resolveCliConfig(
      { root, system: './flag-ds.ts', strict: true },
      root
    );
    expect(config.options.system).toBe('./flag-ds.ts');
    expect(config.options.strict).toBe(true);
    expect(config.configFile).toBe(join(root, 'animus.config.json'));
    const projected = projectResolvedConfig(config);
    expect(projected.provenance).toMatchObject({
      system: 'explicit',
      mode: 'driver-default',
    });
  });

  test('wrongly-typed config values are config errors, not extraction failures', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', strict: 'false' })
    );
    await expect(resolveCliConfig({}, root)).rejects.toThrow(AnimusConfigError);
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', cli: { outDir: 5 } })
    );
    await expect(resolveCliConfig({}, root)).rejects.toThrow(/cli\.outDir/);
  });

  test('the CLI mode default is production — never NODE_ENV', async () => {
    const root = makeRoot();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const config = await resolveCliConfig({ root, system: './ds.ts' }, root);
      expect(config.mode).toBe('production');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('unknown config keys fail loud naming the key', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', exclide: [] })
    );
    await expect(resolveCliConfig({ root }, root)).rejects.toThrow(
      /Unknown option "exclide"/
    );
  });

  test('missing system is a config error naming the remedy', async () => {
    const root = makeRoot();
    await expect(resolveCliConfig({ root }, root)).rejects.toThrow(
      /Missing required option `system`/
    );
  });

  test('the cli namespace outDir resolves against the root', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', cli: { outDir: 'out/animus' } })
    );
    const config = await resolveCliConfig({ root }, root);
    expect(config.outDir).toBe(join(root, 'out', 'animus'));
  });

  test('an outDir inside the root joins the STRUCTURAL exclusions, keeping the replaceable defaults', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const config = await resolveCliConfig({ root, outDir: 'out/animus' }, root);
    const session = createCliSession(config);
    const patterns = [...session.getExcludeStats().keys()];
    expect(session.structuralExclude).toEqual(['out/animus/**']);
    expect(patterns).toContain('out/animus/**');
    expect(patterns).toContain('dist');
    expect(patterns).toContain('.test.');
  });

  test('the outDir exclusion actually matches the artifacts published under it', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const config = await resolveCliConfig({ root, outDir: 'out' }, root);
    const session = createCliSession(config);
    const matcher = createExcludeMatcher(
      config.options.exclude,
      session.structuralExclude
    );
    expect(
      matcher.matches(
        join(root, 'out', 'system-props.js'),
        'out/system-props.js'
      )
    ).toBe(true);
  });

  test('an outDir equal to the root is refused instead of ingesting its own output', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const config = await resolveCliConfig({ root, outDir: '.' }, root);
    expect(config.outDir).toBe(root);
    expect(() => createCliSession(config)).toThrow(UsageFailure);
    expect(() => createCliSession(config)).toThrow(/--out-dir/);
  });

  test('a retired v1 engine selection is rejected at the CLI ingress', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', engine: 'v1' })
    );
    await expect(resolveCliConfig({ root }, root)).rejects.toThrow(
      RETIRED_ENGINE_MESSAGE
    );
  });

  test('the ANIMUS_ENGINE=v1 override is rejected at the CLI ingress too', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const prev = process.env.ANIMUS_ENGINE;
    process.env.ANIMUS_ENGINE = 'v1';
    try {
      await expect(resolveCliConfig({ root }, root)).rejects.toThrow(
        RETIRED_ENGINE_MESSAGE
      );
    } finally {
      if (prev === undefined) delete process.env.ANIMUS_ENGINE;
      else process.env.ANIMUS_ENGINE = prev;
    }
  });

  test('exclude flags merge with file patterns and the defaults', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', exclude: ['fixtures'] })
    );
    const config = await resolveCliConfig(
      { root, exclude: ['**/*.stories.tsx'] },
      root
    );
    expect(config.excludePatterns).toContain('node_modules');
    expect(config.excludePatterns).toContain('fixtures');
    expect(config.excludePatterns).toContain('**/*.stories.tsx');
  });

  test('an explicit empty exclude list means no user exclusions, not the defaults', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', exclude: [] })
    );
    const config = await resolveCliConfig({ root }, root);
    // An empty list that decays to `undefined` reads as "no user list" to
    // `createExcludeMatcher`, which answers with the replaceable defaults.
    expect(config.options.exclude).toEqual([]);
    expect(config.excludePatterns).not.toContain('dist');
    expect(config.excludePatterns).not.toContain('.test.');
    expect(config.excludePatterns).toContain('node_modules');
    expect(projectResolvedConfig(config).provenance.exclude).toBe('explicit');
  });

  test('an absent exclude list still restores the replaceable defaults', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const config = await resolveCliConfig({ root }, root);
    expect(config.options.exclude).toBeUndefined();
    expect(config.excludePatterns).toContain('dist');
    expect(projectResolvedConfig(config).provenance.exclude).toBe('default');
  });

  test('print-config emits extensions and staticCss with their provenance', async () => {
    const root = makeRoot();
    const staticCss = { components: { Button: { states: ['hover'] } } };
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({
        system: './ds.ts',
        extensions: ['.ts', '.tsx'],
        staticCss,
      })
    );
    const projected = projectResolvedConfig(
      await resolveCliConfig({ root }, root)
    );
    expect(projected.extensions).toEqual(['.ts', '.tsx']);
    expect(projected.staticCss).toEqual(staticCss);
    expect(projected.provenance.extensions).toBe('explicit');
    expect(projected.provenance.staticCss).toBe('explicit');
  });

  test('unset extensions and staticCss project as null, like every other unset key', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    const projected = projectResolvedConfig(
      await resolveCliConfig({ root }, root)
    );
    expect(projected.extensions).toBeNull();
    expect(projected.staticCss).toBeNull();
    expect(projected.provenance.extensions).toBe('default');
  });
});

describe('inferred root reporting', () => {
  const writeConfig = (dir: string): string => {
    const path = join(dir, 'animus.config.json');
    writeFileSync(path, JSON.stringify({ system: './ds.ts' }));
    return path;
  };

  test('a --config outside the cwd relocates the root and says so', async () => {
    const configDir = makeRoot();
    const cwd = makeRoot();
    const config = await resolveCliConfig(
      { config: writeConfig(configDir) },
      cwd
    );
    expect(config.root).toBe(configDir);
    expect(config.rootSource).toBe('config-dir');
    const notice = inferredRootNotice(config, cwd);
    expect(notice).toContain(configDir);
    expect(notice).toContain('--root');
  });

  test('a config file in the cwd relocates nothing and says nothing', async () => {
    const cwd = makeRoot();
    const config = await resolveCliConfig({ config: writeConfig(cwd) }, cwd);
    expect(config.root).toBe(cwd);
    expect(inferredRootNotice(config, cwd)).toBeNull();
  });

  test('an explicit --root is the user own choice — never announced', async () => {
    const configDir = makeRoot();
    const root = makeRoot();
    const cwd = makeRoot();
    const config = await resolveCliConfig(
      { config: writeConfig(configDir), root },
      cwd
    );
    expect(config.root).toBe(root);
    expect(config.rootSource).toBe('flag');
    expect(inferredRootNotice(config, cwd)).toBeNull();
  });

  test('a config file that names its own root is explicit too', async () => {
    const configDir = makeRoot();
    const cwd = makeRoot();
    mkdirSync(join(configDir, 'app'), { recursive: true });
    writeFileSync(
      join(configDir, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', root: './app' })
    );
    const config = await resolveCliConfig(
      { config: join(configDir, 'animus.config.json') },
      cwd
    );
    expect(config.root).toBe(join(configDir, 'app'));
    expect(config.rootSource).toBe('config-file');
    expect(inferredRootNotice(config, cwd)).toBeNull();
  });
});

describe('artifact writer', () => {
  const payloads = {
    stylesCss: ':root{--a:1}\n@layer anm-base{.x{}}',
    systemPropsJs: 'export const p = {};',
    manifestJson: '{"components":{"X":{}}}',
  };

  test('publishes payloads then a commit record that verifies', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    expect(verifyCommitRecord(outDir)).toEqual([]);
    const record = JSON.parse(
      readFileSync(join(outDir, 'commit.json'), 'utf-8')
    );
    expect(record.schema).toBe(1);
    expect(Object.keys(record.payloads).sort()).toEqual([
      'manifest.json',
      'styles.css',
      'system-props.js',
    ]);
  });

  test('double publication is byte-identical (no identity in bytes)', () => {
    const dirA = join(makeRoot(), '.animus');
    const dirB = join(makeRoot(), '.animus');
    publishArtifacts(dirA, payloads);
    publishArtifacts(dirB, payloads);
    for (const name of [
      'styles.css',
      'system-props.js',
      'manifest.json',
      'commit.json',
    ]) {
      expect(readFileSync(join(dirA, name), 'utf-8')).toBe(
        readFileSync(join(dirB, name), 'utf-8')
      );
    }
  });

  test('a tampered payload fails the consistency check naming the file', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(join(outDir, 'styles.css'), '/* tampered */');
    expect(verifyCommitRecord(outDir).join('\n')).toContain('styles.css');
  });

  test('a record whose payloads is an ARRAY is not a schema-1 record', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(
      join(outDir, 'commit.json'),
      JSON.stringify({ schema: 1, payloads: [] })
    );
    expect(verifyCommitRecord(outDir).length).toBeGreaterThan(0);
  });

  test('a record whose entry hash is not a string is not a schema-1 record', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(
      join(outDir, 'commit.json'),
      JSON.stringify({ schema: 1, payloads: { 'styles.css': { hash: 7 } } })
    );
    expect(verifyCommitRecord(outDir).length).toBeGreaterThan(0);
  });

  test('a record of bare `null` fails the check instead of throwing', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(join(outDir, 'commit.json'), 'null');
    expect(verifyCommitRecord(outDir).length).toBeGreaterThan(0);
  });

  test('session assets are published beside styles.css, recorded, and verified', () => {
    const root = makeRoot();
    const sessionDir = join(root, 'session');
    mkdirSync(join(sessionDir, 'assets'), { recursive: true });
    // Not valid UTF-8: the verify read must survive binary assets unmangled.
    const fontBytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0xfe]);
    writeFileSync(join(sessionDir, 'assets', 'font.abc123.woff2'), fontBytes);
    const outDir = join(root, '.animus');
    publishArtifacts(outDir, {
      ...payloads,
      assets: collectSessionAssets(sessionDir),
    });

    expect(
      readFileSync(join(outDir, 'assets', 'font.abc123.woff2')).equals(
        fontBytes
      )
    ).toBe(true);
    const record = JSON.parse(
      readFileSync(join(outDir, 'commit.json'), 'utf-8')
    );
    expect(record.payloads['assets/font.abc123.woff2']?.hash).toBeTruthy();
    expect(verifyCommitRecord(outDir)).toEqual([]);
    expect(
      readdirSync(outDir).filter((name) => name.startsWith('.staging'))
    ).toEqual([]);
  });

  test('a republication prunes published assets the new generation no longer records', () => {
    const root = makeRoot();
    const sessionDir = join(root, 'session');
    const sessionAssets = join(sessionDir, 'assets');
    mkdirSync(sessionAssets, { recursive: true });
    writeFileSync(join(sessionAssets, 'font.old00000.woff2'), 'old');
    const outDir = join(root, '.animus');
    publishArtifacts(outDir, {
      ...payloads,
      assets: collectSessionAssets(sessionDir),
    });

    rmSync(join(sessionAssets, 'font.old00000.woff2'));
    writeFileSync(join(sessionAssets, 'font.new11111.woff2'), 'new');
    publishArtifacts(outDir, {
      ...payloads,
      assets: collectSessionAssets(sessionDir),
    });

    expect(existsSync(join(outDir, 'assets', 'font.new11111.woff2'))).toBe(
      true
    );
    expect(existsSync(join(outDir, 'assets', 'font.old00000.woff2'))).toBe(
      false
    );
    expect(verifyCommitRecord(outDir)).toEqual([]);
  });

  test('publication never deletes assets it did not publish — outDir is not animus-exclusive', () => {
    const root = makeRoot();
    const outDir = join(root, 'public');
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    writeFileSync(join(outDir, 'assets', 'logo.svg'), '<svg/>');
    publishArtifacts(outDir, payloads);
    expect(existsSync(join(outDir, 'assets', 'logo.svg'))).toBe(true);

    const sessionDir = join(root, 'session');
    mkdirSync(join(sessionDir, 'assets'), { recursive: true });
    writeFileSync(join(sessionDir, 'assets', 'font.aaa11111.woff2'), 'a');
    publishArtifacts(outDir, {
      ...payloads,
      assets: collectSessionAssets(sessionDir),
    });
    rmSync(join(sessionDir, 'assets', 'font.aaa11111.woff2'));
    publishArtifacts(outDir, {
      ...payloads,
      assets: collectSessionAssets(sessionDir),
    });
    expect(existsSync(join(outDir, 'assets', 'font.aaa11111.woff2'))).toBe(
      false
    );
    expect(existsSync(join(outDir, 'assets', 'logo.svg'))).toBe(true);
    expect(verifyCommitRecord(outDir)).toEqual([]);
  });

  test('a live lock holder fails loud; a stale lock is stolen', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'lock.json'), JSON.stringify(lockRecord()));
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify(lockRecord({ pid: 2 ** 30 }))
    );
    const release = acquireLock(outDir);
    release();
    expect(verifyCommitRecord(outDir).length).toBeGreaterThan(0);
  });

  test('a lock that exists but does not decode is never stolen', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'lock.json'), '{"pid":');
    expect(() => acquireLock(outDir)).toThrow(/lock\.json/);
    expect(existsSync(join(outDir, 'lock.json'))).toBe(true);
  });

  test('a holder this process may not signal is live, not stale', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify(lockRecord({ pid: 1 }))
    );
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
  });
});

describe('lock liveness', () => {
  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
  const ancient = (): string =>
    new Date(Date.now() - TWO_DAYS_MS).toISOString();

  test('a live pid whose heartbeat stopped long ago no longer owns the tree', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    const stopped = lockRecord({ ageMs: TWO_DAYS_MS });
    writeFileSync(join(outDir, 'lock.json'), JSON.stringify(stopped));

    const release = acquireLock(outDir);
    const held = JSON.parse(readFileSync(join(outDir, 'lock.json'), 'utf-8'));
    expect(held.startedAt).not.toBe(stopped.startedAt);
    expect(held.heartbeatAt).not.toBe(stopped.heartbeatAt);
    release();
  });

  test('a live pid with a fresh heartbeat still owns the tree', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify({
        pid: process.pid,
        startedAt: ancient(),
        heartbeatAt: new Date().toISOString(),
      })
    );
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
  });

  test('the holder refreshes its heartbeat, and release stops it', () => {
    const outDir = join(makeRoot(), '.animus');
    const readLock = (): { pid: number; heartbeatAt?: string } =>
      JSON.parse(readFileSync(join(outDir, 'lock.json'), 'utf-8'));
    vi.useFakeTimers();
    try {
      const release = acquireLock(outDir);
      const first = readLock();
      expect(first.pid).toBe(process.pid);
      expect(first.heartbeatAt).toBeTruthy();

      vi.advanceTimersByTime(CLI_LOCK_HEARTBEAT_INTERVAL_MS + 1);
      const refreshed = readLock();
      expect(refreshed.pid).toBe(process.pid);
      expect(refreshed.heartbeatAt! > first.heartbeatAt!).toBe(true);
      expect(
        readdirSync(outDir).filter((name) => name.startsWith('.lock-heartbeat'))
      ).toEqual([]);

      release();
      expect(existsSync(join(outDir, 'lock.json'))).toBe(false);
      vi.advanceTimersByTime(CLI_LOCK_HEARTBEAT_INTERVAL_MS * 3);
      expect(existsSync(join(outDir, 'lock.json'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a lock record carrying no heartbeat is judged by its pid alone', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify({ pid: process.pid, startedAt: ancient() })
    );
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
  });
});

/** Read the captured lines before the finally block: `mockRestore` also
 *  clears the recorded calls. */
async function withCapturedStderr(
  fn: () => void | Promise<void>
): Promise<string[]> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await fn();
    return spy.mock.calls.map((parts) => parts.map(String).join(' '));
  } finally {
    spy.mockRestore();
  }
}

async function projectConfig(root: string) {
  writeFileSync(join(root, 'ds.ts'), 'export const notASystem = 1;\n');
  writeFileSync(
    join(root, 'animus.config.json'),
    JSON.stringify({ system: './ds.ts' })
  );
  return resolveCliConfig({ root }, root);
}

describe('interrupted-writer debris', () => {
  test('acquireLock reaps staging trees left by dead writers, keeping live ones', () => {
    const outDir = join(makeRoot(), '.animus');
    const deadStaging = join(outDir, `.staging-${2 ** 30}`);
    mkdirSync(deadStaging, { recursive: true });
    writeFileSync(join(deadStaging, 'styles.css'), 'abandoned');
    const liveStaging = join(outDir, `.staging-${process.pid}`);
    mkdirSync(liveStaging, { recursive: true });
    writeFileSync(join(outDir, 'styles.css'), 'published');

    const release = acquireLock(outDir);
    try {
      expect(existsSync(deadStaging)).toBe(false);
      expect(existsSync(liveStaging)).toBe(true);
      expect(existsSync(join(outDir, 'styles.css'))).toBe(true);
    } finally {
      release();
    }
  });

  test('a build holds signal handlers while it owns the lock and drops them after', async () => {
    const baseSigint = process.listenerCount('SIGINT');
    const baseSigterm = process.listenerCount('SIGTERM');
    let heldSigint = -1;
    let heldSigterm = -1;
    const config = await projectConfig(makeRoot());
    Object.defineProperty(config, 'excludePatterns', {
      get(): string[] {
        heldSigint = process.listenerCount('SIGINT');
        heldSigterm = process.listenerCount('SIGTERM');
        throw new Error('session construction failed');
      },
    });

    await expect(runBuild(config)).rejects.toThrow(
      'session construction failed'
    );

    expect(heldSigint).toBe(baseSigint + 1);
    expect(heldSigterm).toBe(baseSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(baseSigint);
    expect(process.listenerCount('SIGTERM')).toBe(baseSigterm);
  });
});

describe('interrupted publication swap', () => {
  const payloads = {
    stylesCss: ':root{--a:1}\n@layer anm-base{.x{}}',
    systemPropsJs: 'export const p = {};',
    manifestJson: '{"components":{"X":{}}}',
  };

  function tearPublication(
    outDir: string
  ): PublishSwapIncompleteError<unknown> {
    publishArtifacts(outDir, payloads);
    rmSync(join(outDir, 'system-props.js'));
    mkdirSync(join(outDir, 'system-props.js'), { recursive: true });
    writeFileSync(join(outDir, 'system-props.js', 'blocker'), 'x');
    try {
      publishArtifacts(outDir, {
        ...payloads,
        stylesCss: ':root{--a:2}\n@layer anm-base{.x{}}',
      });
    } catch (error) {
      if (error instanceof PublishSwapIncompleteError) return error;
      throw error;
    }
    throw new Error('the publication was expected to fail mid-swap');
  }

  test('a swap that stops after a payload lands says so, naming what landed', () => {
    const outDir = join(makeRoot(), '.animus');
    const error = tearPublication(outDir);
    expect(String(error)).toContain('styles.css');
    expect(String(error)).toMatch(/mix|torn|did not (finish|complete)/i);
    expect(verifyCommitRecord(outDir).length).toBeGreaterThan(0);
  });

  test('a swap that fails before anything lands keeps the previous generation', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    const before = readFileSync(join(outDir, 'styles.css'), 'utf-8');
    rmSync(join(outDir, 'styles.css'));
    mkdirSync(join(outDir, 'styles.css'), { recursive: true });
    writeFileSync(join(outDir, 'styles.css', 'blocker'), 'x');
    expect(() =>
      publishArtifacts(outDir, {
        ...payloads,
        systemPropsJs: 'export const q=1;',
      })
    ).toThrow();
    expect(readFileSync(join(outDir, 'system-props.js'), 'utf-8')).toBe(
      payloads.systemPropsJs
    );
    expect(before).toBeTruthy();
  });

  test('the next lock acquisition reports the inconsistent set instead of adopting it', async () => {
    const outDir = join(makeRoot(), '.animus');
    tearPublication(outDir);
    const lines = await withCapturedStderr(() => {
      acquireLock(outDir)();
    });
    const said = lines.join('\n');
    expect(said).toContain(outDir);
    expect(said).toMatch(/did not finish|inconsistent/i);
    expect(said).toContain('system-props.js');
  });

  test('a consistent published set is acquired without a word about tearing', async () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    const said = await withCapturedStderr(() => {
      acquireLock(outDir)();
    });
    expect(said).toEqual([]);
  });

  test('the watch report drops the last-good claim once the swap has landed bytes', () => {
    const outDir = join(makeRoot(), '.animus');
    const torn = tearPublication(outDir);
    const tornLine = formatCyclePublishFailure(outDir, torn);
    expect(tornLine).not.toContain('last-good artifacts');
    expect(tornLine).toContain(outDir);
    expect(tornLine).toContain('styles.css');

    const rejected = formatCyclePublishFailure(
      outDir,
      new Error('Structural self-check failed')
    );
    expect(rejected).toContain('keeping last-good artifacts');
    expect(rejected).toContain('Structural self-check failed');
  });
});

describe('shutdown signals', () => {
  type Released = [number, string, boolean];

  test('both signals reach the release once, with their exit codes', () => {
    const seen: Released[] = [];
    const remove = installShutdownSignals({
      release: ({ exitCode, signal, abandoned }) =>
        seen.push([exitCode, signal, abandoned]),
    });
    try {
      process.emit('SIGINT');
      process.emit('SIGTERM');
      expect(seen).toEqual([[EXIT_SIGINT, 'SIGINT', false]]);
    } finally {
      remove();
    }
  });

  test('SIGTERM carries its own exit code', () => {
    const seen: Released[] = [];
    const remove = installShutdownSignals({
      release: ({ exitCode, signal, abandoned }) =>
        seen.push([exitCode, signal, abandoned]),
    });
    try {
      process.emit('SIGTERM');
      expect(seen).toEqual([[EXIT_SIGTERM, 'SIGTERM', false]]);
    } finally {
      remove();
    }
  });

  test('removal unregisters both listeners', () => {
    const baseSigint = process.listenerCount('SIGINT');
    const baseSigterm = process.listenerCount('SIGTERM');
    let fired = 0;
    const remove = installShutdownSignals({
      release: () => {
        fired += 1;
      },
    });
    expect(process.listenerCount('SIGINT')).toBe(baseSigint + 1);
    expect(process.listenerCount('SIGTERM')).toBe(baseSigterm + 1);
    remove();
    expect(process.listenerCount('SIGINT')).toBe(baseSigint);
    expect(process.listenerCount('SIGTERM')).toBe(baseSigterm);
    process.emit('SIGINT');
    expect(fired).toBe(0);
  });

  test('a drain that finishes releases once, unabandoned', async () => {
    const seen: Released[] = [];
    const drains: string[] = [];
    const remove = installShutdownSignals({
      drain: async (_exitCode, signal) => {
        drains.push(signal);
      },
      release: ({ exitCode, signal, abandoned }) =>
        seen.push([exitCode, signal, abandoned]),
    });
    try {
      process.emit('SIGINT');
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(drains).toEqual(['SIGINT']);
      expect(seen).toEqual([[EXIT_SIGINT, 'SIGINT', false]]);
    } finally {
      remove();
    }
  });

  test('a signal arriving during the drain abandons it, releases, and exits', async () => {
    const seen: Released[] = [];
    const exits: Array<number | string | null | undefined> = [];
    // SAFETY: `process.exit` is declared to return `never`; this stub
    // records the code and returns so the assertions below can read it.
    const exit = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      exits.push(code);
      return undefined;
    }) as typeof process.exit);
    let finishDrain = (): void => {};
    const draining = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    const remove = installShutdownSignals({
      drain: () => draining,
      release: ({ exitCode, signal, abandoned }) =>
        seen.push([exitCode, signal, abandoned]),
    });
    try {
      process.emit('SIGINT');
      process.emit('SIGTERM');
      expect(seen).toEqual([[EXIT_SIGTERM, 'SIGTERM', true]]);
      expect(exits).toEqual([EXIT_SIGTERM]);
      process.emit('SIGINT');
      expect(seen).toHaveLength(1);
      finishDrain();
      await draining;
      await Promise.resolve();
      expect(seen).toHaveLength(1);
    } finally {
      remove();
      exit.mockRestore();
    }
  });

  test('without a drain, repeat signals stay inert', () => {
    const seen: Released[] = [];
    const remove = installShutdownSignals({
      release: ({ exitCode, signal, abandoned }) =>
        seen.push([exitCode, signal, abandoned]),
    });
    try {
      process.emit('SIGINT');
      process.emit('SIGTERM');
      expect(seen).toEqual([[EXIT_SIGINT, 'SIGINT', false]]);
    } finally {
      remove();
    }
  });
});

describe('command-line positionals', () => {
  async function runMain(
    argv: string[]
  ): Promise<{ exitCode: number | string | null | undefined; stderr: string }> {
    const previous = process.exitCode;
    let exitCode: number | string | null | undefined;
    try {
      const lines = await withCapturedStderr(async () => {
        await main(argv);
        exitCode = process.exitCode;
      });
      return { exitCode, stderr: lines.join('\n') };
    } finally {
      process.exitCode = previous ?? undefined;
    }
  }

  test('a second positional is a usage error, not a silently ignored word', async () => {
    const { exitCode, stderr } = await runMain(['build', 'watch']);
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain("Unexpected argument 'watch'");
    expect(stderr).toContain('Usage:');
  });

  test('the first positional is still the command', async () => {
    const { exitCode, stderr } = await runMain(['nonsense']);
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain("Unknown command 'nonsense'");
  });
});

describe('bin shim', () => {
  test('a CLI that cannot load exits with the install-failure code, not the extraction code', () => {
    const shimSource = readFileSync(
      join(import.meta.dirname, '..', 'bin', 'animus.mjs'),
      'utf-8'
    );
    const shim = join(makeRoot(), 'animus.mjs');
    writeFileSync(shim, shimSource);

    const result = spawnSync(process.execPath, [shim, 'build'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(EXIT_INSTALL);
    expect(result.stderr).toMatch(/install/i);
    expect(result.stderr).toContain('[animus]');
  });
});

describe('session-tree cleanup ownership', () => {
  test('a run that never constructed a session deletes no session tree', async () => {
    const rootA = makeRoot();
    await expect(runBuild(await projectConfig(rootA))).rejects.toThrow();
    const slotDir = getSessionArtifactDir();
    expect(slotDir?.startsWith(rootA)).toBe(true);
    mkdirSync(slotDir!, { recursive: true });
    writeFileSync(join(slotDir!, 'manifest.json'), '{}');

    const configB = await projectConfig(makeRoot());
    Object.defineProperty(configB, 'excludePatterns', {
      get(): string[] {
        throw new Error('session construction failed');
      },
    });
    await expect(runBuild(configB)).rejects.toThrow(
      'session construction failed'
    );

    expect(existsSync(join(slotDir!, 'manifest.json'))).toBe(true);
  });
});

describe('exit taxonomy', () => {
  test('maps error classes to documented codes', () => {
    expect(exitCodeFor(new UsageFailure('x'))).toBe(EXIT_USAGE);
    expect(exitCodeFor(new AnimusConfigError('x'))).toBe(EXIT_USAGE);
    expect(exitCodeFor(new EnvironmentFailure('x'))).toBe(EXIT_ENVIRONMENT);
    expect(exitCodeFor(new ExtractionFailure('x'))).toBe(EXIT_EXTRACTION);
    expect(exitCodeFor(new Error('x'))).toBe(EXIT_EXTRACTION);
  });
});

describe('watch degradation reporting', () => {
  const healthy = {
    projectRoot: '/proj',
    projectWatch: 'active' as const,
    externalWatchRoots: ['/kits/ds'],
    stickyDiagnostics: new Map<string, string>(),
  };

  test('healthy roots produce an empty degradation list', () => {
    expect(collectDegradedRoots(healthy)).toEqual([]);
  });

  test('an inactive project watcher names the project root and the consequence', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      projectWatch: 'unavailable',
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].root).toBe('/proj');
    expect(degraded[0].reason).toMatch(/NO source edits will be observed/);
    const line = formatDegradedRootLine(degraded[0]);
    expect(line).toContain('watch degraded root=/proj');
    expect(line).toContain('restart');
  });

  test('a duplicate root claim is reported as a collision, not a platform loss', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      projectWatch: 'already-watched',
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].root).toBe('/proj');
    expect(degraded[0].reason).not.toMatch(/platform watcher unavailable/);
    expect(degraded[0].reason).toMatch(/already/i);
    expect(degraded[0].reason).toMatch(/NO source edits will be observed/);
    expect(formatDegradedRootLine(degraded[0])).not.toMatch(
      /restart the watch/
    );
  });

  test('node_modules-resolved external roots are documented unwatchable', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      externalWatchRoots: ['/proj/node_modules/@kit/ds/dist', '/kits/src-ds'],
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].root).toBe('/proj/node_modules/@kit/ds/dist');
    expect(degraded[0].reason).toMatch(/node_modules.*unwatchable/);
    expect(formatDegradedRootLine(degraded[0])).toContain(
      'root=/proj/node_modules/@kit/ds/dist'
    );
  });

  test('sticky external-watch diagnostics ride through with their reason', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      stickyDiagnostics: new Map([
        [
          'external-watch:/kits/ds',
          'ANIMUS_EXTERNAL_WATCH_UNAVAILABLE root=ds reason=capacity(EMFILE) effect=changes in this workspace source may require restart',
        ],
        ['cross-volume', 'unrelated sticky diagnostic — never a watch root'],
      ]),
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].root).toBe('/kits/ds');
    expect(degraded[0].reason).toContain('capacity(EMFILE)');
  });

  test('duplicate sources dedupe by root (first reason wins)', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      externalWatchRoots: ['/proj/node_modules/@kit/ds'],
      stickyDiagnostics: new Map([
        ['external-watch:/proj/node_modules/@kit/ds', 'late failure'],
      ]),
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].reason).toMatch(/documented unwatchable/);
  });
});
