import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { toWatchKeys } from '../pipeline/watch-keys';

const scratch = mkdtempSync(join(tmpdir(), 'animus-watch-keys-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('toWatchKeys', () => {
  it('returns a single key for an existing canonical path', () => {
    const dir = join(scratch, 'real');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'export {};\n');

    const canonicalFile = join(realpathSync(dir), 'a.ts');
    expect(toWatchKeys(canonicalFile)).toEqual([canonicalFile]);
  });

  it('adds the canonical key when the event path traverses a symlink', () => {
    const target = join(scratch, 'pkg-target');
    mkdirSync(join(target, 'src'), { recursive: true });
    const file = join(target, 'src', 'theme.ts');
    writeFileSync(file, 'export {};\n');
    const link = join(scratch, 'pkg-link');
    symlinkSync(target, link);

    const keys = toWatchKeys(join(link, 'src', 'theme.ts'));
    expect(keys).toContain(join(link, 'src', 'theme.ts'));
    expect(keys).toContain(join(realpathSync(target), 'src', 'theme.ts'));
  });

  it('canonicalizes a deleted file through its nearest existing ancestor', () => {
    const target = join(scratch, 'del-target');
    mkdirSync(join(target, 'src'), { recursive: true });
    const link = join(scratch, 'del-link');
    symlinkSync(target, link);

    // The file never exists — a post-unlink event path via the symlink.
    const keys = toWatchKeys(join(link, 'src', 'gone.ts'));
    expect(keys).toContain(join(realpathSync(target), 'src', 'gone.ts'));
  });

  it('reconstructs through multiple missing segments', () => {
    const target = join(scratch, 'deep-target');
    mkdirSync(target, { recursive: true });
    const link = join(scratch, 'deep-link');
    symlinkSync(target, link);

    const keys = toWatchKeys(join(link, 'missing', 'nested', 'gone.ts'));
    expect(keys).toContain(
      join(realpathSync(target), 'missing', 'nested', 'gone.ts')
    );
  });

  it('normalizes redundant lexical segments', () => {
    const dir = join(scratch, 'norm');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'b.ts');
    writeFileSync(file, 'export {};\n');

    const messy = join(dir, '..', 'norm', 'b.ts');
    const keys = toWatchKeys(messy);
    // Lexical key has the `..` collapsed; canonical key resolves symlinks
    // (on macOS tmpdir itself is a /var → /private/var symlink).
    expect(keys[0]).toBe(join(dir, 'b.ts'));
    expect(keys).toContain(join(realpathSync(dir), 'b.ts'));
  });

  it('falls back to the input when nothing on the path exists', () => {
    const keys = toWatchKeys('/definitely/not/a/real/path.ts');
    expect(keys).toContain('/definitely/not/a/real/path.ts');
  });
});
