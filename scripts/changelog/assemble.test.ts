import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FRAGMENT_DIRECTORY, assembleChangelog, main } from './assemble';

const ROOT = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

const CHANGELOG = [
  '# Change Log',
  '',
  '## Unreleased',
  '',
  '**Old.** Entry.',
  '',
  '## 0.1.0 (2026-05-11)',
  '',
  'First release.',
  '',
].join('\n');

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-changelog-'));
  temporaryDirectories.push(root);
  writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
  mkdirSync(join(root, FRAGMENT_DIRECTORY), { recursive: true });
  return root;
}

function runQuietly(root: string): number {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    return main(root, []);
  } finally {
    log.mockRestore();
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('changelog assembly', () => {
  it('leaves the changelog alone when the directory is empty', () => {
    const root = temporaryRoot();

    expect(runQuietly(root)).toBe(0);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
  });

  it('orders entries by file name, whatever order they arrive in', () => {
    const fragments = ['b-second.md', 'c-third.md', 'a-first.md'].map(
      (name) => ({ name, text: `**${name}** entry.\n` })
    );

    expect(assembleChangelog(CHANGELOG, fragments)).toBe(
      CHANGELOG.replace(
        '**Old.**',
        '**a-first.md** entry.\n\n**b-second.md** entry.\n\n**c-third.md** entry.\n\n**Old.**'
      )
    );
  });

  it('puts entries above the existing Unreleased paragraphs and keeps those byte for byte', () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const heading = '## Unreleased\n\n';
    const split = changelog.indexOf(heading) + heading.length;
    const entry = [
      '**Packaging fixes** (caught by the packed lane):',
      '',
      '- `next-plugin` is CJS-only',
      '- `vite-plugin` declares an `exports` map',
    ].join('\n');

    expect(
      assembleChangelog(changelog, [{ name: 'packaging.md', text: entry }])
    ).toBe(`${changelog.slice(0, split)}${entry}\n\n${changelog.slice(split)}`);
  });
});
