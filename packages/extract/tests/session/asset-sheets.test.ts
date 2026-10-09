/**
 * An asset() call in a theme scale value reaches the variable CSS, and one in
 * a component's styles reaches the component CSS; both must resolve to the
 * URL the same call in global styles gets.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { getSharedCss, setEngineApiOverride } from '../../session/singleton';

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
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

test('asset() in a theme scale value and in component CSS resolves like global styles', async () => {
  const root = makeTempRoot('animus-asset-sheets-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"consumer"}');
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  const rock = join(root, 'dither-rock-1.jpg');
  writeFileSync(rock, 'jpeg-bytes');
  const placeholder = `url("animus-asset:${rock}")`;

  mocks.loadSystemModule.mockReturnValue({
    ...SYSTEM_CONFIG,
    variableCss: `:root{--images-rock: ${placeholder}}`,
  });
  mocks.analyzeProject.mockImplementation(() => {
    const manifest = makeManifest({
      css: `.hero{background-image:${placeholder}}`,
    });
    manifest.sheets.global = `@layer anm-global{:root{--control: ${placeholder}}}`;
    return JSON.stringify(manifest);
  });

  const session = new ExtractionSession({
    system: './src/system.ts',
    strict: true,
  });
  session.rootDir = root;
  await session.runFullPipeline();

  const css = getSharedCss();
  expect(css).not.toContain('animus-asset:');
  const urls = [...css.matchAll(/url\("?([^")]*dither-rock-1[^")]*)"?\)/g)].map(
    (match) => match[1]
  );
  expect(urls).toHaveLength(3);
  expect(new Set(urls).size).toBe(1);
  expect(urls[0]).toMatch(/^\.\/assets\/dither-rock-1\.[0-9a-f]{8}\.jpg$/);
  expect(session.assetDependencyPaths.has(realpathSync(rock))).toBe(true);
});
