import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const HELPER = resolve(ROOT, 'scripts/cloudflare/build-extract-v2.sh');

function findCommand(name: string): string {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${name}`], {
    encoding: 'utf8',
  });
  expect(result.status, `${name} must be available to the test`).toBe(0);
  return result.stdout.trim();
}

function writeExecutable(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
}

function fixture(cargoPresent: boolean) {
  const directory = mkdtempSync(resolve(tmpdir(), 'animus-extract-v2-'));
  const commands = resolve(directory, 'commands');
  const path = resolve(directory, 'path');
  mkdirSync(commands);
  mkdirSync(path);

  for (const command of ['dirname', 'sed', 'head', 'mktemp', 'rm', 'chmod']) {
    symlinkSync(findCommand(command), resolve(path, command));
  }

  const forbiddenCurlLog = resolve(directory, 'forbidden-curl.log');
  writeExecutable(resolve(path, 'curl'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" > "${forbiddenCurlLog}"`,
    'exit 97',
  ]);

  const paths = {
    cargo: resolve(commands, 'cargo'),
    curl: resolve(commands, 'curl'),
    sh: resolve(commands, 'sh'),
    rustc: resolve(commands, 'rustc'),
    bun: resolve(commands, 'bun'),
    curlLog: resolve(directory, 'curl.log'),
    shLog: resolve(directory, 'sh.log'),
    bunLog: resolve(directory, 'bun.log'),
  };

  if (cargoPresent) {
    writeExecutable(paths.cargo, ['#!/bin/sh', 'exit 0']);
  }
  writeExecutable(paths.curl, [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" > "$TEST_CURL_LOG"',
    'output=',
    'while [ "$#" -gt 0 ]; do',
    '  if [ "${1:-}" = "--output" ]; then',
    '    output="$2"',
    '    shift 2',
    '  else',
    '    shift',
    '  fi',
    'done',
    'printf \'# fixture installer\\n\' > "$output"',
  ]);
  writeExecutable(paths.sh, [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" > "$TEST_SH_LOG"',
    'printf \'#!/bin/sh\\nexit 0\\n\' > "$CARGO_BIN"',
    'chmod +x "$CARGO_BIN"',
  ]);
  writeExecutable(paths.rustc, [
    '#!/bin/sh',
    'printf \'rustc %s (fixture)\\n\' "$TEST_RUST_RELEASE"',
  ]);
  writeExecutable(paths.bun, [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" > "$TEST_BUN_LOG"',
  ]);

  return { directory, path, forbiddenCurlLog, ...paths };
}

function runHelper(
  setup: ReturnType<typeof fixture>,
  options: { rustRelease?: string; workers?: boolean } = {}
) {
  const env = {
    ...process.env,
    PATH: setup.path,
    CARGO_BIN: setup.cargo,
    CURL_BIN: setup.curl,
    SH_BIN: setup.sh,
    RUSTC_BIN: setup.rustc,
    BUN_BIN: setup.bun,
    TEST_CURL_LOG: setup.curlLog,
    TEST_SH_LOG: setup.shLog,
    TEST_BUN_LOG: setup.bunLog,
    TEST_RUST_RELEASE: options.rustRelease ?? '1.97.0',
  };
  if (options.workers) env.WORKERS_CI = '1';
  else delete env.WORKERS_CI;

  return spawnSync('/bin/bash', [HELPER], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

describe('build-extract-v2 helper', () => {
  it('fails without network when Cargo is absent outside Workers CI', () => {
    const setup = fixture(false);
    try {
      const result = runHelper(setup);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('cargo missing');
      expect(existsSync(setup.curlLog)).toBe(false);
      expect(existsSync(setup.forbiddenCurlLog)).toBe(false);
      expect(existsSync(setup.bunLog)).toBe(false);
    } finally {
      rmSync(setup.directory, { recursive: true, force: true });
    }
  });

  it('skips bootstrap, validates the exact release, and builds with Cargo', () => {
    const setup = fixture(true);
    try {
      const result = runHelper(setup);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('rustc 1.97.0 (fixture)');
      expect(existsSync(setup.curlLog)).toBe(false);
      expect(existsSync(setup.forbiddenCurlLog)).toBe(false);
      expect(readFileSync(setup.bunLog, 'utf8')).toBe(
        'run --filter @animus-ui/extract build:v2\n'
      );
    } finally {
      rmSync(setup.directory, { recursive: true, force: true });
    }
  });

  it('rejects a Cargo-present rustc release mismatch before building', () => {
    const setup = fixture(true);
    try {
      const result = runHelper(setup, { rustRelease: '1.96.0' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Rust release mismatch');
      expect(result.stderr).toContain('expected 1.97.0');
      expect(result.stderr).toContain('resolved 1.96.0');
      expect(existsSync(setup.bunLog)).toBe(false);
    } finally {
      rmSync(setup.directory, { recursive: true, force: true });
    }
  });

  it('bootstraps the exact minimal channel in Workers and removes the installer', () => {
    const setup = fixture(false);
    try {
      const result = runHelper(setup, { workers: true });
      expect(result.status).toBe(0);
      expect(existsSync(setup.forbiddenCurlLog)).toBe(false);

      const curl = readFileSync(setup.curlLog, 'utf8');
      expect(curl).toContain('--proto =https');
      expect(curl).toContain('--tlsv1.2');
      expect(curl).toContain('https://sh.rustup.rs');

      const installer = readFileSync(setup.shLog, 'utf8').split(' ')[0];
      const installerCommand = readFileSync(setup.shLog, 'utf8');
      expect(installerCommand).toContain('--default-toolchain 1.97.0');
      expect(installerCommand).toContain('--profile minimal');
      expect(installerCommand).toContain('--no-modify-path');
      expect(existsSync(installer)).toBe(false);
      expect(readFileSync(setup.bunLog, 'utf8')).toBe(
        'run --filter @animus-ui/extract build:v2\n'
      );
    } finally {
      rmSync(setup.directory, { recursive: true, force: true });
    }
  });
});
