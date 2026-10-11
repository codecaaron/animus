import { RETIRED_ENGINE_MESSAGE } from '@animus-ui/extract/pipeline';
import { afterEach, describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { AnimusExtractOptions } from '../src/index';

describe('retired v1 engine selection', () => {
  const saved = process.env.ANIMUS_ENGINE;

  afterEach(() => {
    if (saved === undefined) delete process.env.ANIMUS_ENGINE;
    else process.env.ANIMUS_ENGINE = saved;
  });

  test('engine:v1 throws the canonical retirement message', () => {
    const retiredEngineOptions = { system: 'x', engine: 'v1' };
    expect(
      // SAFETY: Crosses the typed option boundary to prove a stale JavaScript
      // config naming the retired engine is rejected.
      () => animusExtract(retiredEngineOptions as AnimusExtractOptions)
    ).toThrow(RETIRED_ENGINE_MESSAGE);
  });

  test('ANIMUS_ENGINE=v1 throws even without an engine option', () => {
    process.env.ANIMUS_ENGINE = 'v1';
    expect(() => animusExtract({ system: 'x' })).toThrow(
      RETIRED_ENGINE_MESSAGE
    );
  });

  /** Contract: v2 is the only engine (SA2). Any other selection, from the
   *  option or the environment, fails before the native module loads. */
  test('an engine other than v2 fails, from the option or ANIMUS_ENGINE', () => {
    const unknownEngineOptions = { system: 'x', engine: 'v3' };
    expect(
      // SAFETY: Crosses the typed option boundary as a JavaScript config may.
      () => animusExtract(unknownEngineOptions as AnimusExtractOptions)
    ).toThrow(/"v3".*v2 is the only engine/);
    process.env.ANIMUS_ENGINE = 'v3';
    expect(() => animusExtract({ system: 'x' })).toThrow(
      /"v3".*v2 is the only engine/
    );
    process.env.ANIMUS_ENGINE = 'v2';
    expect(() => animusExtract({ system: 'x' })).not.toThrow();
  });
});
