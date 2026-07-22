import { spawnSync } from 'node:child_process';
import {
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

import {
  UnsupportedHostError,
  resolveHostV2BinaryPath,
  resolveNapiTarget,
  resolveV2BinaryFilename,
} from './napi-target';

const ROOT = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

// Controlled mtimes for -newer freshness probes (mirrors preconditions.test.ts):
// OLD < MID < NEW so `find -newer` decisions never hinge on timestamp
// granularity.
const OLD = new Date(1_000_000);
const NEW = new Date(2_000_000);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveNapiTarget (pure host → target map)', () => {
  it('maps darwin-arm64', () => {
    expect(resolveNapiTarget({ platform: 'darwin', arch: 'arm64' })).toBe(
      'darwin-arm64'
    );
  });

  it('maps linux x64 gnu', () => {
    expect(
      resolveNapiTarget({ platform: 'linux', arch: 'x64', libc: 'gnu' })
    ).toBe('linux-x64-gnu');
  });

  it('maps linux arm64 gnu', () => {
    expect(
      resolveNapiTarget({ platform: 'linux', arch: 'arm64', libc: 'gnu' })
    ).toBe('linux-arm64-gnu');
  });

  it('fails loud for an unsupported platform/arch', () => {
    expect(() =>
      resolveNapiTarget({ platform: 'win32', arch: 'x64', libc: 'gnu' })
    ).toThrow(UnsupportedHostError);
  });

  it('fails loud for Linux musl (never released)', () => {
    expect(() =>
      resolveNapiTarget({ platform: 'linux', arch: 'x64', libc: 'musl' })
    ).toThrow(UnsupportedHostError);
  });

  it('composes the v2 binary filename from the resolved target', () => {
    expect(resolveV2BinaryFilename({ platform: 'darwin', arch: 'arm64' })).toBe(
      'animus-extract-v2.darwin-arm64.node'
    );
  });
});

// Behavioral guard: a fresh FOREIGN-target binary must not mask a stale
// host-native binary. The retired `ls *.node | head -n1` selection would pick
// the lexically-first artifact (`aaaa-foreign` sorts before every real target
// token) and pass falsely; host-native selection fails and names the host
// binary.
describe('require_fresh_napi_v2 host-native selection', () => {
  function scaffold(): string {
    const root = mkdtempSync(resolve(tmpdir(), 'animus-napi-target-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'scripts/verify'), { recursive: true });
    for (const file of ['_preconditions.sh', 'napi-target.ts']) {
      copyFileSync(
        join(ROOT, 'scripts/verify', file),
        join(root, 'scripts/verify', file)
      );
    }
    return root;
  }

  function writeAt(root: string, relativePath: string, mtime: Date): void {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'binary\n');
    utimesSync(absolute, mtime, mtime);
  }

  it('fails and names the stale host binary when a foreign binary is fresh', () => {
    const root = scaffold();
    const crate = 'packages/extract/crates/extract-v2';
    const hostBinary = resolveHostV2BinaryPath();

    // Host-native binary is OLD; a foreign-target binary and a Rust source are
    // both NEW. Only host-native selection catches the staleness.
    writeAt(root, hostBinary, OLD);
    writeAt(root, `${crate}/animus-extract-v2.aaaa-foreign-target.node`, NEW);
    writeAt(root, `${crate}/src/lib.rs`, NEW);

    const result = spawnSync(
      'bash',
      [
        '-c',
        'set -euo pipefail; source scripts/verify/_preconditions.sh; require_fresh_napi_v2',
      ],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('host v2 NAPI binary stale');
    expect(result.stderr).toContain(hostBinary);
    expect(result.stderr).toContain(`${crate}/src/lib.rs`);
  });
});
