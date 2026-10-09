/**
 * Runtime prop configs reach the browser in generated modules, where an
 * asset() placeholder loads nothing. Extraction lifts each one into a root
 * variable of the global sheet; the session resolves that sheet like every
 * other and reports any placeholder a generated module still carries.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import {
  getSharedCss,
  getSharedSystemProps,
  setEngineApiOverride,
} from '../../session/singleton';

setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import { ExtractionSession } from '../../session/extraction-session';
import {
  BUTTON_SOURCE,
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.analyzeProject.mockReset();
  mocks.clearAnalysisCache.mockReset();
  mocks.loadSystemModule.mockReturnValue(SYSTEM_CONFIG);
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

function sessionWithRock(scaleValue: (placeholder: string) => string) {
  const root = makeTempRoot('animus-asset-modules-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"consumer"}');
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  const rock = join(root, 'rock.jpg');
  writeFileSync(rock, 'jpeg-bytes');
  const placeholder = `url("animus-asset:${rock}")`;
  mocks.analyzeProject.mockImplementation(() => {
    const manifest = makeManifest({
      dynamic_props: {
        bgImage: {
          varName: '--animus-bg-image',
          slotClass: 'animus-dyn-bg-image',
          property: 'backgroundImage',
          scaleValues: { rock: scaleValue(placeholder) },
        },
      },
    });
    manifest.sheets.global = `@layer anm-global{:root{--animus-asset-1a2b3c4d: ${placeholder}}}`;
    return JSON.stringify(manifest);
  });
  const session = new ExtractionSession({
    system: './src/system.ts',
    strict: false,
  });
  session.rootDir = root;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { session, warn };
}

test('a lifted runtime asset resolves in the global sheet and reports nothing', async () => {
  const { session, warn } = sessionWithRock(
    () => 'var(--animus-asset-1a2b3c4d)'
  );
  await session.runFullPipeline();

  expect(getSharedCss()).toMatch(
    /--animus-asset-1a2b3c4d: ?url\("?\.\/assets\/rock\.[0-9a-f]{8}\.jpg"?\)/
  );
  expect(getSharedSystemProps()).toContain('var(--animus-asset-1a2b3c4d)');
  expect(warn).not.toHaveBeenCalledWith(
    expect.stringContaining('unsubstituted')
  );
});

test('a placeholder left in a runtime config is reported', async () => {
  const { session, warn } = sessionWithRock((placeholder) => placeholder);
  await session.runFullPipeline();

  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining(
      'asset() placeholders reached generated runtime modules unsubstituted'
    )
  );
});
