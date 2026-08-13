/**
 * The oracle's layer list is a copy of the emitter's, on purpose: importing
 * `@animus-ui/extract` at runtime would couple the oracle package to the
 * emitter's build. This test is the tether — if the emitter grows or reorders
 * a layer, the copy must move with it, because `buildUniverse` silently
 * ignores any sheet whose layer it does not know and `analyzeCascade`
 * excludes rules in unordered layers.
 */

import { ANIMUS_LAYERS } from '@animus-ui/extract/pipeline';
import { describe, expect, it } from 'vitest';

import { ANIMUS_LAYER_ORDER } from '../src/providers/style-universe';

describe('layer-order parity with the emitter', () => {
  it('matches @animus-ui/extract ANIMUS_LAYERS exactly, in order', () => {
    expect([...ANIMUS_LAYER_ORDER]).toEqual([...ANIMUS_LAYERS]);
  });
});
