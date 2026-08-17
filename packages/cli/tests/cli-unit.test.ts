import {
  AnimusConfigError,
  RETIRED_ENGINE_MESSAGE,
} from '@animus-ui/extract/pipeline';
import {
  collectSessionAssets,
  getSessionArtifactDir,
} from '@animus-ui/extract/session';
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
import { describe, expect, test } from 'vitest';

import {
  createCliSession,
  EnvironmentFailure,
  ExtractionFailure,
  runBuild,
  UsageFailure,
} from '../src/build';
import { projectResolvedConfig, resolveCliConfig } from '../src/config';
import {
  exitCodeFor,
  EXIT_ENVIRONMENT,
  EXIT_EXTRACTION,
  EXIT_USAGE,
} from '../src/index';
import { collectDegradedRoots, formatDegradedRootLine } from '../src/watch';
import {
  acquireLock,
  publishArtifacts,
  verifyPublishedSet,
} from '../src/writer';

const makeRoot = (): string => mkdtempSync(join(tmpdir(), 'animus-cli-'));

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
    // The regression this pins: appending the guard to the USER list made
    // its presence replace the replaceable defaults — a custom outDir
    // silently re-admitted dist/.test./.spec. paths to discovery.
    const patterns = [...session.getExcludeStats().keys()];
    expect(session.structuralExclude).toEqual(['out/animus/**']);
    expect(patterns).toContain('out/animus/**');
    expect(patterns).toContain('dist');
    expect(patterns).toContain('.test.');
  });

  test('a retired v1 engine selection is rejected at the CLI ingress', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts', engine: 'v1' })
    );
    // `engine` is a CORE key, so the shared key validator vouches for it and
    // the CLI then drops the value on the floor: the one driver that never
    // applied the retirement gate silently ran v2 instead (flow row A).
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
    expect(verifyPublishedSet(outDir)).toEqual([]);
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
    expect(verifyPublishedSet(outDir).join('\n')).toContain('styles.css');
  });

  test('a record whose payloads is an ARRAY is not a schema-1 record', () => {
    // The hole this pins: a `typeof record.payloads !== 'object'` gate admits
    // an array, whose zero entries then verify vacuously — a record naming no
    // payload at all would certify any tree it sits in.
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(
      join(outDir, 'commit.json'),
      JSON.stringify({ schema: 1, payloads: [] })
    );
    expect(verifyPublishedSet(outDir).length).toBeGreaterThan(0);
  });

  test('a record whose entry hash is not a string is not a schema-1 record', () => {
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(
      join(outDir, 'commit.json'),
      JSON.stringify({ schema: 1, payloads: { 'styles.css': { hash: 7 } } })
    );
    expect(verifyPublishedSet(outDir).length).toBeGreaterThan(0);
  });

  test('a record of bare `null` fails the check instead of throwing', () => {
    // `JSON.parse('null')` is a successful parse, so a field read off the
    // result throws out of a function whose contract is to RETURN failures —
    // the session's hygiene gate calls this and does not catch.
    const outDir = join(makeRoot(), '.animus');
    publishArtifacts(outDir, payloads);
    writeFileSync(join(outDir, 'commit.json'), 'null');
    expect(verifyPublishedSet(outDir).length).toBeGreaterThan(0);
  });

  test('session assets are published beside styles.css, recorded, and verified', () => {
    const root = makeRoot();
    const sessionDir = join(root, 'session');
    mkdirSync(join(sessionDir, 'assets'), { recursive: true });
    // Binary bytes (not valid UTF-8) — the woff2 case the verify read must
    // survive without mangling.
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
    expect(verifyPublishedSet(outDir)).toEqual([]);
    // No staging residue survives the publish.
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
    expect(verifyPublishedSet(outDir)).toEqual([]);
  });

  test('publication never deletes assets it did not publish — outDir is not animus-exclusive', () => {
    const root = makeRoot();
    // The lock-conflict remediation advertises --out-dir, so a shared,
    // user-owned target (public/ with its own assets/) is a supported
    // shape — a zero-asset publish must not clear it.
    const outDir = join(root, 'public');
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    writeFileSync(join(outDir, 'assets', 'logo.svg'), '<svg/>');
    publishArtifacts(outDir, payloads);
    expect(existsSync(join(outDir, 'assets', 'logo.svg'))).toBe(true);

    // A generation that publishes its own asset, then drops it: the prune
    // removes exactly the previously-published name, never the user file.
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
    expect(verifyPublishedSet(outDir)).toEqual([]);
  });

  test('a live lock holder fails loud; a stale lock is stolen', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    // Live holder: this very process.
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify({ pid: process.pid, startedAt: 'now' })
    );
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
    // Stale holder: a pid that cannot exist.
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify({ pid: 2 ** 30, startedAt: 'then' })
    );
    const release = acquireLock(outDir);
    release();
    expect(verifyPublishedSet(outDir).length).toBeGreaterThan(0); // no commit yet — check runs
  });

  test('a lock that exists but does not decode is never stolen', () => {
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    // A torn or hand-edited lock names no pid, so its holder cannot be
    // proven dead. Stealing it is the unsafe direction — two writers over
    // one tree — so the conflict is loud and names the file to remove.
    writeFileSync(join(outDir, 'lock.json'), '{"pid":');
    expect(() => acquireLock(outDir)).toThrow(/lock\.json/);
    expect(existsSync(join(outDir, 'lock.json'))).toBe(true);
  });

  test('a holder this process may not signal is live, not stale', () => {
    // pid 1 (launchd/init) exists and is root-owned, so `process.kill(1, 0)`
    // from an unprivileged runner throws EPERM — "the process is there, you
    // may not signal it". Reading that as DEAD is how a second writer steals
    // a live holder's tree. Under a root runner the probe simply succeeds and
    // the verdict is the same, so the assertion holds either way.
    const outDir = join(makeRoot(), '.animus');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'lock.json'),
      JSON.stringify({ pid: 1, startedAt: 'boot' })
    );
    expect(() => acquireLock(outDir)).toThrow(/owns .*--out-dir/s);
  });
});

describe('session-tree cleanup ownership', () => {
  /** A resolved config for a minimal project the CLI can preflight. */
  async function projectConfig(root: string) {
    writeFileSync(join(root, 'ds.ts'), 'export const notASystem = 1;\n');
    writeFileSync(
      join(root, 'animus.config.json'),
      JSON.stringify({ system: './ds.ts' })
    );
    return resolveCliConfig({ root }, root);
  }

  test('a run that never constructed a session deletes no session tree', async () => {
    // Run 1 reaches pipeline start (which publishes its session dir into
    // the process-global slot) and then fails — the slot now names THIS
    // root's tree for the rest of the process.
    const rootA = makeRoot();
    await expect(runBuild(await projectConfig(rootA))).rejects.toThrow();
    const slotDir = getSessionArtifactDir();
    expect(slotDir?.startsWith(rootA)).toBe(true);
    mkdirSync(slotDir!, { recursive: true });
    writeFileSync(join(slotDir!, 'manifest.json'), '{}');

    // Run 2 is a DIFFERENT root whose session construction fails:
    // `excludePatterns` is read only by createCliSession (preflight never
    // touches it), so a throwing accessor reproduces the one reachable path
    // to the cleanup fallback.
    const configB = await projectConfig(makeRoot());
    Object.defineProperty(configB, 'excludePatterns', {
      get(): string[] {
        throw new Error('session construction failed');
      },
    });
    await expect(runBuild(configB)).rejects.toThrow(
      'session construction failed'
    );

    // The data loss this pins: the `?? getSessionArtifactDir()` fallback
    // fires exactly when this run owns nothing, and recursively removed a
    // tree belonging to a different session (flow #5).
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

// Automated equivalent of the platform-degraded watch negative (increment
// 06 task 06.2 step 2): forcing a real recursive-fs.watch failure is not
// portably simulable, so the degradation LIST derivation and its loud
// per-root formatting are pinned here; the e2e lane covers the healthy
// watch loop end to end.
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
    // The misreport this pins: the orchestrator returned the same `null` for
    // a duplicate claim and a platform failure, so the CLI blamed the
    // platform and prescribed a restart that collides identically (S9).
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
