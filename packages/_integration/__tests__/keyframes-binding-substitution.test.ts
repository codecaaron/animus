/**
 * Keyframes binding substitution: `animationName: motion.ember` in component
 * styles must be resolved to the static keyframe name at extraction time.
 *
 * Registry shape from `system_loader::extract_keyframes_blocks`:
 *   { exportName: { keyName: { name, frames } } }
 *
 * The Rust `analyze()` parses this into a binding registry and injects each
 * collection into the per-file `resolved_static_values` map under whatever
 * local name binds to the collection (either via cross-file import resolution
 * or an in-file local export). `eval_expression_with_statics` resolves
 * `Identifier.property` member expressions against that map.
 */
import { describe, expect, test } from 'vitest';

import { config, theme } from '../fixtures/setup';
import { analyzeProject, clearAnalysisCache } from './run-pipeline';

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
  keyframesBlocks: Record<string, any>
) => {
  clearAnalysisCache();
  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme.scalesJson,
    theme.variableMapJson,
    theme.contextualVarsJson || null,
    config.propConfig,
    config.groupRegistry,
    '{}',
    false,
    null,
    null,
    null,
    null,
    null,
    JSON.stringify(keyframesBlocks)
  );
  return JSON.parse(manifestJson);
};

describe('keyframes binding substitution (animationName: motion.ember)', () => {
  test('cross-file import: animationName: motion.ember substitutes to resolved name', () => {
    const dsFile: FileEntry = {
      // This file "exports" motion — the local const is a non-static keyframes()
      // call so `collect_static_values` does NOT pick it up. The registry path
      // is the ONLY way the resolution can succeed.
      path: 'fixtures/ds.ts',
      source: `import { keyframes } from '@animus-ui/system';\nexport const motion = keyframes({ ember: { '0%': { opacity: 0 }, '100%': { opacity: 1 } } });\n`,
    };

    const componentFile: FileEntry = {
      path: 'fixtures/component.tsx',
      source: `import { ds } from './setup';\nimport { motion } from './ds';\nexport const Glow = ds.styles({ animationName: motion.ember, animationDuration: '5s' }).asElement('div');\nexport const App = () => <Glow />;\n`,
    };

    // Note: fixtures/setup imports ds from test-system — but we only need the
    // import line to satisfy the chain walker; the `ds` binding itself comes
    // from a builder chain that is externally provided via the test system.
    // For this test we simplify by pointing the builder chain at the local
    // setup-style fixture: extraction still works because the test fixture
    // setup re-exports `ds` (a builder with extractable chains).
    // We DO NOT need setup.ts in the file entries — builder detection walks
    // the AST locally and the binding resolution is not required for chain
    // recognition, only for parent `.extend()` chains.

    const manifest = runWithKeyframes([dsFile, componentFile], {
      motion: {
        ember: { name: 'animus-kf-cross-file', frames: frameMap },
      },
    });

    const componentId = `${componentFile.path}::Glow`;
    const fragment = manifest.component_fragments?.[componentId] ?? {};
    const baseCss: string = fragment.base ?? '';

    // The resolved keyframe NAME must appear as a static animation-name value
    // on the component's base class.
    expect(baseCss).toContain('animation-name: animus-kf-cross-file');
    // And the animation-duration should still be present (the other static
    // property is unaffected by the substitution path).
    expect(baseCss).toContain('animation-duration: 5s');
    // The manifest CSS also contains the substituted value (double-check
    // that the per-component fragment and the concatenated CSS agree).
    expect(manifest.css).toContain('animus-kf-cross-file');
    // No __TRANSFORM__ placeholders or skipped-property fallback markers.
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
    // The other static property (color) still extracts normally.
    expect(baseCss).toContain('color:');
    // The non-resolving member expression MUST NOT leak a placeholder value
    // into the emitted CSS — it should simply be absent from the rule body.
    expect(baseCss).not.toContain('animation-name:');
  });
});
