import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { COMMIT_FILE, MANIFEST_FILE } from '../src/host/animus/loader';
import { loadSnapshot } from '../src/places';

/**
 * PLACES.md §6 — warm operation. A warm process lives while the working tree
 * and the artifacts change under it, so the cold path's one-shot honesty has
 * to hold over time: `structureOf` answers about the file as it is NOW
 * (correspondence re-checked when content changes), and `revalidate` detects
 * a rebuilt artifact set instead of letting a warm session keep answering
 * from a dead generation.
 */

const FIXTURE = join(__dirname, 'fixtures/rollup-app');
const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
const GROUP_FILE = 'src/Group.tsx';

const groupSource = readFileSync(join(SOURCE_ROOT, GROUP_FILE), 'utf8');

const scratchSourceRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'places-warm-src-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, GROUP_FILE), groupSource);
  return root;
};

const scratchArtifacts = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'places-warm-art-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
};

describe('structureOf stays correspondence-checked over time', () => {
  it('flips ok → diverged when the source drifts after load', () => {
    const root = scratchSourceRoot();
    const snapshot = loadSnapshot(FIXTURE, { sourceRoot: root });

    expect(snapshot.structureOf(GROUP_FILE).ok).toBe(true);

    // The same drift edit the cold guard catches — but applied AFTER the
    // first read, which a load-time-only cache would never see.
    writeFileSync(
      join(root, GROUP_FILE),
      groupSource.replace(
        '<div className="group" data-active="true">',
        '<div className="group" data-active="maybe">'
      )
    );
    const drifted = snapshot.structureOf(GROUP_FILE);
    expect(drifted).toMatchObject({ ok: false, reason: 'diverged' });

    // Reverting the file restores the answer — the refusal was about the
    // file's content, not about the session's history.
    writeFileSync(join(root, GROUP_FILE), groupSource);
    expect(snapshot.structureOf(GROUP_FILE).ok).toBe(true);
  });

  it('flips ok → source-missing when the file disappears', () => {
    const root = scratchSourceRoot();
    const snapshot = loadSnapshot(FIXTURE, { sourceRoot: root });

    expect(snapshot.structureOf(GROUP_FILE).ok).toBe(true);
    rmSync(join(root, GROUP_FILE));
    expect(snapshot.structureOf(GROUP_FILE)).toMatchObject({
      ok: false,
      reason: 'source-missing',
    });
  });
});

describe('revalidate detects a changed artifact set', () => {
  it('reports fresh while the artifacts are untouched', () => {
    const dir = scratchArtifacts();
    const snapshot = loadSnapshot(dir, { sourceRoot: SOURCE_ROOT });
    expect(snapshot.revalidate()).toEqual({ fresh: true });
  });

  it('names the changed artifact when the manifest is rebuilt', () => {
    const dir = scratchArtifacts();
    const snapshot = loadSnapshot(dir, { sourceRoot: SOURCE_ROOT });

    const manifestPath = join(dir, MANIFEST_FILE);
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}\n`);

    const freshness = snapshot.revalidate();
    expect(freshness.fresh).toBe(false);
    if (!freshness.fresh) {
      expect(freshness.changed).toContain(MANIFEST_FILE);
    }
  });

  it('treats a vanished commit record as a change, not an equivalence', () => {
    const dir = scratchArtifacts();
    const snapshot = loadSnapshot(dir, { sourceRoot: SOURCE_ROOT });

    rmSync(join(dir, COMMIT_FILE));
    const freshness = snapshot.revalidate();
    expect(freshness.fresh).toBe(false);
    if (!freshness.fresh) {
      expect(freshness.changed).toContain(COMMIT_FILE);
    }
  });
});
