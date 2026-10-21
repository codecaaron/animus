import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { COMMIT_FILE, MANIFEST_FILE } from '../src/host/animus/loader';
import { loadSnapshot } from '../src/places';

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

    writeFileSync(
      join(root, GROUP_FILE),
      groupSource.replace(
        '<div className="group" data-active="true">',
        '<div className="group" data-active="maybe">'
      )
    );
    const drifted = snapshot.structureOf(GROUP_FILE);
    expect(drifted).toMatchObject({ ok: false, reason: 'diverged' });

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

/** Contract: Oracle accepts unchanged source against the manifest the
 *  current engine writes. The manifest's `usage` stays the raw syntax Oracle
 *  checks source against (a `const` read as written), and what the analysis
 *  proves of it travels beside it as `proven`. */
describe("the engine's own manifest", () => {
  it('corresponds to the unchanged source it was built from', () => {
    const extractor = createRequire(import.meta.url)('@animus-ui/extract');
    const source =
      'const GAP = 24;\nexport const App = () => <Box p={GAP} />;\n';
    const root = mkdtempSync(join(tmpdir(), 'places-engine-src-'));
    writeFileSync(join(root, 'app.tsx'), source);
    const engine = new extractor.ExtractEngine({});
    engine.prepare(JSON.stringify([{ path: 'app.tsx', source }]));
    engine.analyzePrepared();
    const built = JSON.parse(engine.fullManifestJson());

    const dir = scratchArtifacts();
    const manifestPath = join(dir, MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.fileFacts['app.tsx'] = built.fileFacts['app.tsx'];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const structure = loadSnapshot(dir, { sourceRoot: root }).structureOf(
      'app.tsx'
    );
    expect(structure).toMatchObject({ ok: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
});
