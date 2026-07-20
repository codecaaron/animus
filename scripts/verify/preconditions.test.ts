import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

// Controlled mtimes for -newer freshness probes: OLDER precedes NEWER by
// 1000s so `find -newer` decisions never depend on filesystem timestamp
// granularity.
const OLDER = new Date(1_000_000);
const NEWER = new Date(2_000_000);

// Copy the sourced library into a throwaway worktree so each case exercises
// the real helper against a fixture tree it fully owns (mirrors the
// owner-graph.test.ts require_fresh_package_dist precedent).
function scaffold(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'scripts/verify'), { recursive: true });
  copyFileSync(
    join(ROOT, 'scripts/verify/_preconditions.sh'),
    join(root, 'scripts/verify/_preconditions.sh')
  );
  return root;
}

function run(root: string, script: string) {
  return spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail; source scripts/verify/_preconditions.sh; ${script}`,
    ],
    { cwd: root, encoding: 'utf8' }
  );
}

function writeAt(
  root: string,
  relativePath: string,
  contents: string,
  mtime?: Date
): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  if (mtime) {
    utimesSync(absolute, mtime, mtime);
  }
}

function writeManifest(
  root: string,
  directory: string,
  manifest: Record<string, unknown>
): void {
  writeAt(
    root,
    join(directory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('require_dir', () => {
  it('passes when the target directory exists', () => {
    const root = scaffold('animus-preconditions-dir-ok-');
    mkdirSync(join(root, 'artifacts'), { recursive: true });

    const result = run(root, "require_dir artifacts 'vp run build:ts'");

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERROR');
  });

  it('fails with the exact remediation when the directory is missing', () => {
    const root = scaffold('animus-preconditions-dir-missing-');

    const result = run(root, "require_dir artifacts 'vp run build:ts'");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: artifacts missing. Run: vp run build:ts'
    );
  });
});

describe('require_fresh_napi_v2', () => {
  const crate = 'packages/extract/crates/extract-v2';

  it('fails with the build:extract-v2 remediation when the binary is missing', () => {
    const root = scaffold('animus-preconditions-napi2-missing-');
    mkdirSync(join(root, crate), { recursive: true });

    const result = run(root, 'require_fresh_napi_v2');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: v2 NAPI binary missing. Run: vp run build:extract-v2'
    );
  });

  it('fails as stale when a Rust source is newer than the binary', () => {
    const root = scaffold('animus-preconditions-napi2-stale-');
    writeAt(root, `${crate}/extract-v2.node`, 'binary\n', OLDER);
    writeAt(root, `${crate}/src/lib.rs`, 'fn main() {}\n', NEWER);

    const result = run(root, 'require_fresh_napi_v2');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: v2 NAPI binary stale (Rust input newer:'
    );
    expect(result.stderr).toContain(`${crate}/src/lib.rs`);
    expect(result.stderr).toContain('Run: vp run build:extract-v2');
  });

  it('passes when the binary is newer than every Rust source', () => {
    const root = scaffold('animus-preconditions-napi2-fresh-');
    writeAt(root, `${crate}/src/lib.rs`, 'fn main() {}\n', OLDER);
    writeAt(root, `${crate}/extract-v2.node`, 'binary\n', NEWER);

    const result = run(root, 'require_fresh_napi_v2');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERROR');
  });
});

describe('require_dist_fresh_for_workspaces', () => {
  it('fix mode passes when dist is newer than src', () => {
    const root = scaffold('animus-preconditions-dist-fresh-');
    writeManifest(root, 'packages/foo', {
      name: '@animus-ui/foo',
      main: './dist/index.js',
    });
    writeAt(root, 'packages/foo/src/index.ts', 'export {};\n', OLDER);
    writeAt(root, 'packages/foo/dist/index.js', 'export {};\n', NEWER);

    const result = run(
      root,
      'require_dist_fresh_for_workspaces fix packages/foo'
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERROR');
    expect(result.stderr).not.toContain('WARN');
  });

  it('fix mode fails when the dist entry is missing', () => {
    const root = scaffold('animus-preconditions-dist-missing-');
    writeManifest(root, 'packages/foo', {
      name: '@animus-ui/foo',
      main: './dist/index.js',
    });

    const result = run(
      root,
      'require_dist_fresh_for_workspaces fix packages/foo'
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: packages/foo/dist missing. Run: vp run build:ts'
    );
  });

  it('fix mode fails when src is newer than the dist entry', () => {
    const root = scaffold('animus-preconditions-dist-stale-');
    writeManifest(root, 'packages/foo', {
      name: '@animus-ui/foo',
      main: './dist/index.js',
    });
    writeAt(root, 'packages/foo/dist/index.js', 'export {};\n', OLDER);
    writeAt(root, 'packages/foo/src/index.ts', 'export {};\n', NEWER);

    const result = run(
      root,
      'require_dist_fresh_for_workspaces fix packages/foo'
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: packages/foo/dist stale vs src. Run: vp run build:ts'
    );
  });

  it('scan mode warns and stays green on a stale dist', () => {
    const root = scaffold('animus-preconditions-dist-scan-stale-');
    writeManifest(root, 'packages/foo', {
      name: '@animus-ui/foo',
      main: './dist/index.js',
    });
    writeAt(root, 'packages/foo/dist/index.js', 'export {};\n', OLDER);
    writeAt(root, 'packages/foo/src/index.ts', 'export {};\n', NEWER);

    const result = run(
      root,
      'require_dist_fresh_for_workspaces scan packages/foo'
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'WARN: packages/foo/dist stale vs src (would block fix mode)'
    );
    expect(result.stderr).not.toContain('ERROR');
  });

  it('scan mode warns and stays green when the dist entry is missing', () => {
    const root = scaffold('animus-preconditions-dist-scan-missing-');
    writeManifest(root, 'packages/foo', {
      name: '@animus-ui/foo',
      main: './dist/index.js',
    });

    const result = run(
      root,
      'require_dist_fresh_for_workspaces scan packages/foo'
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'WARN: packages/foo/dist missing (would block fix mode)'
    );
    expect(result.stderr).not.toContain('ERROR');
  });
});

describe('require_cargo_machete', () => {
  it('fails with the install remediation when the binary is off PATH', () => {
    const root = scaffold('animus-preconditions-machete-missing-');
    const emptyBin = join(root, 'emptybin');
    mkdirSync(emptyBin, { recursive: true });

    const result = run(
      root,
      `export PATH='${emptyBin}'; require_cargo_machete`
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: cargo-machete missing. Run: cargo install cargo-machete'
    );
  });

  it('passes when a cargo-machete executable is resolvable on PATH', () => {
    const root = scaffold('animus-preconditions-machete-present-');
    const fakeBin = join(root, 'fakebin');
    mkdirSync(fakeBin, { recursive: true });
    const stub = join(fakeBin, 'cargo-machete');
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);

    const result = run(root, `export PATH='${fakeBin}'; require_cargo_machete`);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ERROR');
  });
});
