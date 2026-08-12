import { AnimusConfigError } from '@animus-ui/extract/pipeline';
import { collectSessionAssets } from '@animus-ui/extract/session';
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
    projectWatchActive: true,
    externalWatchRoots: ['/kits/ds'],
    stickyDiagnostics: new Map<string, string>(),
  };

  test('healthy roots produce an empty degradation list', () => {
    expect(collectDegradedRoots(healthy)).toEqual([]);
  });

  test('an inactive project watcher names the project root and the consequence', () => {
    const degraded = collectDegradedRoots({
      ...healthy,
      projectWatchActive: false,
    });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].root).toBe('/proj');
    expect(degraded[0].reason).toMatch(/NO source edits will be observed/);
    const line = formatDegradedRootLine(degraded[0]);
    expect(line).toContain('watch degraded root=/proj');
    expect(line).toContain('restart');
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
