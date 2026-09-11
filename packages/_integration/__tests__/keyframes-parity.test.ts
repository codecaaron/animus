import { describe, expect, test } from 'vitest';

import { analyzeProject } from './run-pipeline';

import type { KeyframesBlocks } from './run-pipeline';
import type { KeyframeFrameMap } from '@animus-ui/system';

/**
 * The `globalStyleBlocksJson` payload narrowed to the one selector form these
 * fixtures use: a structured `@keyframes <name>` block.
 */
type StructuredKeyframeBlocks = {
  [exportName: string]: { [keyframesSelector: string]: KeyframeFrameMap };
};

const frameMap = {
  '0%': { opacity: 0, transform: 'scale(0.95)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
};

const extractFrames = (css: string): string | null => {
  const match = css.match(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\}\s*(?=@|$)/);
  return match ? match[1].trim() : null;
};

const run = (
  globalBlocks: StructuredKeyframeBlocks | null,
  keyframesBlocks: KeyframesBlocks | null
) => {
  const manifestJson = analyzeProject(
    JSON.stringify([]), // no component files: this case reads the global layer
    {
      globalStyleBlocksJson: globalBlocks ? JSON.stringify(globalBlocks) : null,
      keyframesJson: keyframesBlocks ? JSON.stringify(keyframesBlocks) : null,
    }
  );
  const manifest = JSON.parse(manifestJson);
  return manifest.sheets?.global ?? manifest.css ?? '';
};

describe('keyframes parity: structured form vs. collection primitive', () => {
  test('both forms emit a @keyframes block inside @layer anm-global', () => {
    const structuredCss = run(
      { structured: { '@keyframes structuredFade': frameMap } },
      null
    );

    const primitiveCss = run(null, {
      motion: {
        fade: { name: 'animus-kf-primitive', frames: frameMap },
      },
    });

    expect(structuredCss).toContain('@keyframes');
    expect(primitiveCss).toContain('@keyframes');
    expect(structuredCss).toContain('@layer');
    expect(primitiveCss).toContain('@layer');
  });

  test('both forms resolve to identical frame body (ignoring name)', () => {
    const structuredCss = run(
      { structured: { '@keyframes nameA': frameMap } },
      null
    );
    const primitiveCss = run(null, {
      motion: {
        fade: { name: 'nameB', frames: frameMap },
      },
    });

    const structuredFrames = extractFrames(structuredCss);
    const primitiveFrames = extractFrames(primitiveCss);

    expect(structuredFrames).not.toBeNull();
    expect(primitiveFrames).not.toBeNull();
    expect(structuredFrames).toBe(primitiveFrames);
  });

  test('collection form uses the per-key name as the @keyframes identifier', () => {
    const primitiveCss = run(null, {
      motion: {
        fade: { name: 'animus-kf-customname', frames: frameMap },
      },
    });

    expect(primitiveCss).toContain('@keyframes animus-kf-customname');
  });

  test('collection with multiple keys emits one @keyframes block per key', () => {
    const frameA = { '0%': { opacity: 0 }, '100%': { opacity: 1 } };
    const frameB = {
      '0%, 100%': { transform: 'scale(1)' },
      '50%': { transform: 'scale(1.05)' },
    };
    const css = run(null, {
      motion: {
        fade: { name: 'animus-kf-fade', frames: frameA },
        pulse: { name: 'animus-kf-pulse', frames: frameB },
      },
    });

    expect(css).toContain('@keyframes animus-kf-fade');
    expect(css).toContain('@keyframes animus-kf-pulse');
  });

  test('multiple collections emit blocks from each', () => {
    const css = run(null, {
      motion: { fade: { name: 'animus-kf-fade', frames: frameMap } },
      effects: {
        glow: {
          name: 'animus-kf-glow',
          frames: {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 },
          },
        },
      },
    });

    expect(css).toContain('@keyframes animus-kf-fade');
    expect(css).toContain('@keyframes animus-kf-glow');
  });

  test('both forms can coexist in the same build — distinct @keyframes blocks', () => {
    const css = run(
      { structured: { '@keyframes structuredOnly': frameMap } },
      {
        motion: {
          primitive: { name: 'animus-kf-primonly', frames: frameMap },
        },
      }
    );

    expect(css).toContain('@keyframes structuredOnly');
    expect(css).toContain('@keyframes animus-kf-primonly');
  });

  test('empty keyframes input emits no @keyframes block', () => {
    const emptyCss = run(null, {});
    expect(emptyCss).not.toContain('@keyframes');
  });

  test('collection with no keys emits no @keyframes block', () => {
    const css = run(null, { motion: {} });
    expect(css).not.toContain('@keyframes');
  });
});
