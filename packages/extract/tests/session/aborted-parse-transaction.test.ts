import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';
import { parserStoppingAt } from '../source-ingestion-fixtures';

// Injection through the singleton's globalThis seam reaches every copy of
// the module (source or dist); a module mock does not.
setEngineApiOverride(() => ({
  extractFacts: parserStoppingAt('(('),
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  ANALYSIS_COMMIT_ARTIFACT,
  ANALYSIS_STATUS_ARTIFACT,
} from '../../session/session-paths';
import { getManifestJson } from '../../session/singleton';
import {
  BUTTON_STYLE_EDIT,
  buildManifest,
  createProject,
  disposeTempRoots,
  makeSession,
  resetAnimusGlobals,
  startSession,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';
import type { ExtractionSession } from '../../session/extraction-session';
import type { AnalysisStatus } from '../../session/session-paths';

const BROKEN_BUTTON =
  "export const Button = animus.styles(({ margin: 24 }).asElement('button');\n";

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject
    .mockReset()
    .mockImplementation(() => buildManifest({}, '.btn{margin:8px;}'));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

function readStatus(session: ExtractionSession): AnalysisStatus {
  return JSON.parse(
    readFileSync(join(session.sessionDir, ANALYSIS_STATUS_ARTIFACT), 'utf-8')
  );
}

function publishedSet(session: ExtractionSession) {
  return {
    commit: readFileSync(
      join(session.sessionDir, ANALYSIS_COMMIT_ARTIFACT),
      'utf-8'
    ),
    styles: readFileSync(join(session.sessionDir, 'styles.css'), 'utf-8'),
    systemProps: readFileSync(
      join(session.sessionDir, 'system-props.js'),
      'utf-8'
    ),
    manifest: getManifestJson(),
  };
}

const card = (margin: number) =>
  `export const Card = animus.styles({ margin: ${margin} }).asElement('section');\n`;

function batch(root: string, edits: Record<string, string>) {
  const modifiedFiles = new Set<string>();
  for (const [file, source] of Object.entries(edits)) {
    const path = join(root, 'src', file);
    writeFileSync(path, source);
    modifiedFiles.add(path);
  }
  return { modifiedFiles, removedFiles: new Set<string>() };
}

async function startWithCard(prefix: string) {
  const root = createProject(prefix);
  writeFileSync(join(root, 'src', 'Card.tsx'), card(12));
  const session = await startSession(root);
  return { root, session, before: publishedSet(session) };
}

const publishedSource = (session: ExtractionSession, path: string) =>
  session.corpus.published.analysisEntries.get(path)?.source;

const REJECTED =
  /analysis not published: .*src\/Button\.tsx \(Unexpected token\)/;

describe('an aborted parse in a watch batch holds publication', () => {
  test('a valid edit in the same batch is kept and published with the repair', async () => {
    const { root, session, before } = await startWithCard('animus-held-batch-');
    const analyses = mocks.analyzeProject.mock.calls.length;

    await expect(
      session.handleWatchUpdate(
        batch(root, { 'Card.tsx': card(20), 'Button.tsx': BROKEN_BUTTON })
      )
    ).rejects.toThrow(REJECTED);
    expect(readStatus(session).state).toBe('failed');
    expect(mocks.analyzeProject.mock.calls.length).toBe(analyses);
    expect(publishedSet(session)).toEqual(before);

    await session.handleWatchUpdate(
      batch(root, { 'Button.tsx': BUTTON_STYLE_EDIT })
    );
    expect(mocks.analyzeProject.mock.calls.length).toBe(analyses + 1);
    expect(publishedSource(session, 'src/Card.tsx')).toBe(card(20));
    expect(publishedSource(session, 'src/Button.tsx')).toBe(BUTTON_STYLE_EDIT);
    expect(readStatus(session).state).toBe('idle');
  });

  test('later edits publish nothing and the status stays failed until the repair', async () => {
    const { root, session, before } = await startWithCard('animus-held-later-');
    const analyses = mocks.analyzeProject.mock.calls.length;

    const broken = batch(root, { 'Button.tsx': BROKEN_BUTTON });
    await expect(session.handleWatchUpdate(broken)).rejects.toThrow(REJECTED);
    for (const source of [card(20), card(28)]) {
      await expect(
        session.handleWatchUpdate(batch(root, { 'Card.tsx': source }))
      ).rejects.toThrow(REJECTED);
      expect(readStatus(session).state).toBe('failed');
    }

    // Re-observing the unchanged broken bytes closes the attempt as failed.
    session.noteDebouncedWatchEvents(broken.modifiedFiles);
    await session.handleWatchUpdate(broken);
    const status = readStatus(session);
    expect(status.state).toBe('failed');
    expect(status.diagnostic).toContain('src/Button.tsx');
    expect(mocks.analyzeProject.mock.calls.length).toBe(analyses);
    expect(publishedSet(session)).toEqual(before);

    await session.handleWatchUpdate(
      batch(root, { 'Button.tsx': BUTTON_STYLE_EDIT })
    );
    expect(mocks.analyzeProject.mock.calls.length).toBe(analyses + 1);
    expect(publishedSource(session, 'src/Card.tsx')).toBe(card(28));
    expect(publishedSource(session, 'src/Button.tsx')).toBe(BUTTON_STYLE_EDIT);
    expect(readStatus(session).state).toBe('idle');
  });
});

const HELD_SYSTEM = {
  ...SYSTEM_CONFIG,
  variableCss: ':root{--anm-space-1: 8px}',
  groupRegistry: '{"groups":{"flex":["flexDirection"]}}',
};

/** The group registry `analyzeProject` received in its latest call. */
const analyzedGroupRegistry = () => mocks.analyzeProject.mock.calls.at(-1)?.[5];

describe('a system edit while a parse is aborted', () => {
  test('is held with the component edits and published with the repair', async () => {
    const { root, session, before } = await startWithCard(
      'animus-held-system-'
    );
    const analyses = mocks.analyzeProject.mock.calls.length;

    await expect(
      session.handleWatchUpdate(batch(root, { 'Button.tsx': BROKEN_BUTTON }))
    ).rejects.toThrow(REJECTED);
    await expect(
      session.handleWatchUpdate(batch(root, { 'Card.tsx': card(20) }))
    ).rejects.toThrow(REJECTED);

    mocks.loadSystemModule.mockReturnValue({ ...HELD_SYSTEM });
    await expect(
      session.handleWatchUpdate(
        batch(root, {
          'system.ts': 'export const system = { space: [0, 8] };\n',
        })
      )
    ).rejects.toThrow(REJECTED);
    expect(readStatus(session).state).toBe('failed');
    expect(mocks.analyzeProject.mock.calls.length).toBe(analyses);
    expect(publishedSet(session)).toEqual(before);

    await session.handleWatchUpdate(
      batch(root, { 'Button.tsx': BUTTON_STYLE_EDIT })
    );
    expect(analyzedGroupRegistry()).toBe(HELD_SYSTEM.groupRegistry);
    expect(publishedSource(session, 'src/Card.tsx')).toBe(card(20));
    const recovered = publishedSet(session);
    expect(recovered.styles).toContain('--anm-space-1: 8px');
    expect(recovered.systemProps).toContain('flexDirection');
    expect(readStatus(session).state).toBe('idle');

    // A later ordinary edit keeps analyzing the published system.
    await session.handleWatchUpdate(batch(root, { 'Card.tsx': card(28) }));
    expect(analyzedGroupRegistry()).toBe(HELD_SYSTEM.groupRegistry);
    expect(publishedSource(session, 'src/Card.tsx')).toBe(card(28));
    expect(publishedSet(session).styles).toContain('--anm-space-1: 8px');
  });
});

describe('an aborted parse in the first pipeline', () => {
  test('publishes no generation and reports the file', async () => {
    const root = createProject('animus-aborted-cold-');
    writeFileSync(join(root, 'src', 'Button.tsx'), BROKEN_BUTTON);
    const session = makeSession(root);

    await expect(session.runFullPipeline()).rejects.toThrow(
      /analysis not published: .*src\/Button\.tsx/
    );
    expect(mocks.analyzeProject).not.toHaveBeenCalled();
    expect(readStatus(session).state).toBe('failed');
    expect(existsSync(join(session.sessionDir, ANALYSIS_COMMIT_ARTIFACT))).toBe(
      false
    );
    expect(getManifestJson() ?? null).toBeNull();
  });
});
