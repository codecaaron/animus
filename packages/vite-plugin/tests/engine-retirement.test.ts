import { RETIRED_ENGINE_MESSAGE } from '@animus-ui/extract/pipeline';
import { afterEach, describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { AnimusExtractOptions } from '../src/index';

/**
 * The v1 engine was retired (openspec: retire-extract-v1). Selecting it through
 * either surface — the `engine` option or the `ANIMUS_ENGINE=v1` env override —
 * must fail loud with the canonical message, never silently upgrade to v2.
 */
describe('engine retirement (retire-extract-v1)', () => {
  const saved = process.env.ANIMUS_ENGINE;

  afterEach(() => {
    if (saved === undefined) delete process.env.ANIMUS_ENGINE;
    else process.env.ANIMUS_ENGINE = saved;
  });

  test('engine:v1 throws the canonical retirement message', () => {
    const retiredEngineOptions = { system: 'x', engine: 'v1' };
    expect(
      // SAFETY: This deliberately crosses the typed option boundary to prove
      // the plugin rejects a stale JavaScript config's retired engine.
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
