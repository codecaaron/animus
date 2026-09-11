/**
 * The engine keys the keyframes registry by export name and resolves
 * `binding.key` against whatever local name binds that collection.
 */
import { describe, expect, test } from 'vitest';

import { analyzeProject, clearAnalysisCache } from './run-pipeline';

import type { KeyframesBlocks } from './run-pipeline';

const frameMap = {
  '0%': { opacity: 0 },
  '100%': { opacity: 1 },
};

interface FileEntry {
  path: string;
  source: string;
}

const runWithKeyframes = (
  fileEntries: FileEntry[],
  keyframesBlocks: KeyframesBlocks
) => {
  clearAnalysisCache();
  const manifestJson = analyzeProject(JSON.stringify(fileEntries), {
    keyframesJson: JSON.stringify(keyframesBlocks),
  });
  return JSON.parse(manifestJson);
};

describe('keyframes binding substitution (animationName: motion.ember)', () => {
  test('cross-file import: animationName: motion.ember substitutes to resolved name', () => {
    const dsFile: FileEntry = {
      // A `keyframes()` call is not a static value, so the registry is the
      // only path that can resolve `motion.ember`.
      path: 'fixtures/ds.ts',
      source: `import { keyframes } from '@animus-ui/system';\nexport const motion = keyframes({ ember: { '0%': { opacity: 0 }, '100%': { opacity: 1 } } });\n`,
    };

    const componentFile: FileEntry = {
      path: 'fixtures/component.tsx',
      source: `import { ds } from './setup';\nimport { motion } from './ds';\nexport const Glow = ds.styles({ animationName: motion.ember, animationDuration: '5s' }).asElement('div');\nexport const App = () => <Glow />;\n`,
    };

    // `./setup` stays out of the entries: chain recognition is local to the
    // file, and cross-file binding resolution only matters for `.extend()`.

    const manifest = runWithKeyframes([dsFile, componentFile], {
      motion: {
        ember: { name: 'animus-kf-cross-file', frames: frameMap },
      },
    });

    const componentId = `${componentFile.path}::Glow`;
    const fragment = manifest.component_fragments?.[componentId] ?? {};
    const baseCss: string = fragment.base ?? '';

    expect(baseCss).toContain('animation-name: animus-kf-cross-file');
    expect(baseCss).toContain('animation-duration: 5s');
    expect(manifest.css).toContain('animus-kf-cross-file');
    expect(manifest.css).not.toContain('__TRANSFORM__');
  });

  test('same-file keyframes binding resolves via local export', () => {
    const file: FileEntry = {
      path: 'fixtures/solo.tsx',
      source: `import { ds } from './setup';\nimport { keyframes } from '@animus-ui/system';\nexport const motion = keyframes({ flow: { '0%': { opacity: 0 }, '100%': { opacity: 1 } } });\nexport const Flower = ds.styles({ animationName: motion.flow }).asElement('div');\nexport const App = () => <Flower />;\n`,
    };

    const manifest = runWithKeyframes([file], {
      motion: {
        flow: { name: 'animus-kf-same-file', frames: frameMap },
      },
    });

    const componentId = `${file.path}::Flower`;
    const fragment = manifest.component_fragments?.[componentId] ?? {};
    const baseCss: string = fragment.base ?? '';
    expect(baseCss).toContain('animation-name: animus-kf-same-file');
  });

  test('unknown member key falls through to skip (no substitution, no crash)', () => {
    const file: FileEntry = {
      path: 'fixtures/unknown.tsx',
      source: `import { ds } from './setup';\nimport { motion } from './ds';\nexport const Missing = ds.styles({ animationName: motion.doesNotExist, color: 'primary' }).asElement('div');\nexport const App = () => <Missing />;\n`,
    };

    const dsFile: FileEntry = {
      path: 'fixtures/ds.ts',
      source: `import { keyframes } from '@animus-ui/system';\nexport const motion = keyframes({ ember: { '0%': { opacity: 0 } } });\n`,
    };

    const manifest = runWithKeyframes([dsFile, file], {
      motion: {
        ember: { name: 'animus-kf-known', frames: frameMap },
      },
    });

    const componentId = `${file.path}::Missing`;
    const fragment = manifest.component_fragments?.[componentId] ?? {};
    const baseCss: string = fragment.base ?? '';
    expect(baseCss).toContain('color:');
    expect(baseCss).not.toContain('animation-name:');
  });
});
