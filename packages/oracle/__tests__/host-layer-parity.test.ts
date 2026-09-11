/**
 * The layer list is copied, not imported, to keep the emitter's build off the
 * runtime path; a sheet in an unknown or unordered layer is dropped silently.
 */

import { ANIMUS_LAYERS } from '@animus-ui/extract/pipeline';
import { describe, expect, it } from 'vitest';

import { ANIMUS_LAYER_ORDER } from '../src/providers/style-universe';

describe('layer-order parity with the emitter', () => {
  it('matches @animus-ui/extract ANIMUS_LAYERS exactly, in order', () => {
    expect([...ANIMUS_LAYER_ORDER]).toEqual([...ANIMUS_LAYERS]);
  });
});
