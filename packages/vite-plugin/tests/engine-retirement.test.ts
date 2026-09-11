import { RETIRED_ENGINE_MESSAGE } from '@animus-ui/extract/pipeline';
import { afterEach, describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { AnimusExtractOptions } from '../src/index';

describe('engine retirement (retire-extract-v1)', () => {
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
});
