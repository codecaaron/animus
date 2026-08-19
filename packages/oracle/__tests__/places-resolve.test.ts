import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPlaceAnalysis, loadSnapshot } from '../src/places';
import { resolveComponentTag } from '../src/places/resolve';

import type { ComponentRecord } from '../src/providers/identity';

/**
 * Attributing a JSX tag to an extracted component (PLACES.md §1, seam S4).
 * A bare binding that matches two components must never resolve to an
 * arbitrary winner — but a relative import specifier names one file, so the
 * path can decide what the binding cannot. What remains ambiguous is
 * surfaced through `PlaceAnalysis.unresolved`, never silently dropped.
 */

const record = (
  id: string,
  file: string,
  binding: string
): ComponentRecord => ({
  id,
  file,
  binding,
  className: `animus-${binding}-${id.length.toString(16)}`,
  terminal: 'asElement',
});

const LOCAL_BUTTON = record(
  'src/Button.tsx::Button',
  'src/Button.tsx',
  'Button'
);
const KIT_BUTTON = record(
  '../../packages/test-ds/src/components/Button.tsx::Button',
  '../../packages/test-ds/src/components/Button.tsx',
  'Button'
);
const COMPONENTS = [LOCAL_BUTTON, KIT_BUTTON];

describe('resolveComponentTag', () => {
  it('resolves a colliding binding through its relative import path', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      [{ local: 'Button', imported: 'Button', source: './Button' }],
      'src/entry.tsx',
      'Button'
    );
    expect(resolution).toEqual({ kind: 'resolved', component: LOCAL_BUTTON });
  });

  it('resolves ../ specifiers against the importing file, not the root', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      [{ local: 'Button', imported: 'Button', source: '../Button' }],
      'src/nested/entry.tsx',
      'Button'
    );
    expect(resolution).toEqual({ kind: 'resolved', component: LOCAL_BUTTON });
  });

  it('completes an index file behind a directory specifier', () => {
    const indexed = record(
      'src/Button/index.tsx::Button',
      'src/Button/index.tsx',
      'Button'
    );
    const resolution = resolveComponentTag(
      [indexed, KIT_BUTTON],
      [{ local: 'Button', imported: 'Button', source: './Button' }],
      'src/entry.tsx',
      'Button'
    );
    expect(resolution).toEqual({ kind: 'resolved', component: indexed });
  });

  it('surfaces a package-specifier collision as ambiguous, never a winner', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      [{ local: 'Button', imported: 'Button', source: '@animus-ui/test-ds' }],
      'src/entry.tsx',
      'Button'
    );
    expect(resolution).toMatchObject({
      kind: 'ambiguous',
      specifier: '@animus-ui/test-ds',
    });
    if (resolution.kind === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2);
    }
  });

  it('surfaces a bare colliding binding with no import fact as ambiguous', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      undefined,
      'src/entry.tsx',
      'Button'
    );
    expect(resolution).toMatchObject({ kind: 'ambiguous' });
  });

  it('reports a tag outside the universe as unknown, not ambiguous', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      [{ local: 'Frame', imported: 'Frame', source: './Frame' }],
      'src/entry.tsx',
      'Frame'
    );
    expect(resolution).toEqual({ kind: 'unknown' });
  });

  it('lets a same-file binding win before any import is consulted', () => {
    const resolution = resolveComponentTag(
      COMPONENTS,
      [{ local: 'Button', imported: 'Button', source: '@animus-ui/test-ds' }],
      'src/Button.tsx',
      'Button'
    );
    expect(resolution).toEqual({ kind: 'resolved', component: LOCAL_BUTTON });
  });
});

describe('unresolved invocations surface on the analysis', () => {
  const FIXTURE = join(__dirname, 'fixtures/rollup-app');
  const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
  const snapshot = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
  const analysis = createPlaceAnalysis(snapshot);

  it('reports nothing for a file whose tags all attribute cleanly', () => {
    expect(analysis.unresolved('src/Group.tsx')).toEqual([]);
    expect(analysis.invocationsOf('GroupItem')).toHaveLength(4);
  });

  it('reports nothing for a file outside the snapshot', () => {
    expect(analysis.unresolved('src/App.tsx')).toEqual([]);
  });
});
