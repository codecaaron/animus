/**
 * The Session's publication record and its per-attempt outcome: what a host
 * serving from memory reads, and what it redelivers.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';
import { parserStoppingAt } from '../source-ingestion-fixtures';

setEngineApiOverride(() => ({
  extractFacts: parserStoppingAt('(('),
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  BUTTON_STYLE_EDIT,
  buildManifest,
  createProject,
  disposeTempRoots,
  makeSession,
  PLAN_A,
  PLAN_B,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';
import type { SessionOutcome } from '../../session/extraction-session';

const BROKEN_BUTTON =
  "export const Button = animus.styles(({ margin: 24 }).asElement('button');\n";

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset();
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** A started session whose outcomes are collected in order. */
async function observedSession() {
  const root = createProject('animus-publication-');
  const session = makeSession(root);
  session.development = true;
  const outcomes: SessionOutcome[] = [];
  session.onOutcome = (outcome) => outcomes.push(outcome);
  await session.runFullPipeline();
  const button = join(root, 'src', 'Button.tsx');
  const edit = (source: string) => {
    writeFileSync(button, source);
    return session.handleWatchUpdate({ modifiedFiles: new Set([button]) });
  };
  return { session, outcomes, edit };
}

describe('a publication reports itself', () => {
  test('full at startup, then incremental with the plans that changed', async () => {
    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_A));
    const { session, outcomes, edit } = await observedSession();

    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_B));
    await edit(BUTTON_STYLE_EDIT);

    expect(
      outcomes.map((outcome) =>
        outcome.kind === 'published'
          ? [outcome.pass, outcome.planChanged]
          : outcome.kind
      )
    ).toEqual([
      ['full', ['src/Button.tsx']],
      ['incremental', ['src/Button.tsx']],
    ]);
    expect(session.publication?.manifest.components).toEqual(PLAN_B);
    expect(session.publication?.componentCss).toContain('.btn');
    session.close();
  });
});

describe('a held attempt reports itself', () => {
  test('with its aborted originals, and its repair with what to redeliver', async () => {
    mocks.analyzeProject.mockImplementation(() => buildManifest(PLAN_A));
    const { session, outcomes, edit } = await observedSession();

    await expect(edit(BROKEN_BUTTON)).rejects.toThrow('analysis not published');
    await edit(BUTTON_STYLE_EDIT);

    const [, held, repaired] = outcomes;
    expect(held.kind === 'held' && [...held.abortedOriginals.keys()]).toEqual([
      'src/Button.tsx',
    ]);
    expect(
      repaired.kind === 'published' && [repaired.endedHold, repaired.redeliver]
    ).toEqual([true, ['src/Button.tsx']]);
    session.close();
  });
});
