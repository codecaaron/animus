import { AnimusConfigError } from './core-options';

export const RETIRED_ENGINE_MESSAGE =
  "animus: the 'v1' extraction engine is no longer supported, and the extractor is the " +
  'only engine. Remove the engine option from your Animus config and unset ' +
  'the ANIMUS_ENGINE environment variable.';

/**
 * The extractor is the only engine (SA2): the option and `ANIMUS_ENGINE`, a startup
 * input a worker may pass as captured, accept `v2` or nothing. Hosts call
 * this before the native module loads, so another selection never reaches
 * it; either fails as a configuration error naming its source.
 */
export function assertSupportedEngine(
  engineOption: string | undefined,
  environmentSelection: string | undefined = process.env.ANIMUS_ENGINE
): void {
  const selections: Array<[string | undefined, string]> = [
    [engineOption, 'the engine option'],
    [environmentSelection || undefined, 'ANIMUS_ENGINE'],
  ];
  for (const [selection, source] of selections) {
    if (selection === undefined || selection === 'v2') continue;
    if (selection === 'v1') {
      throw new AnimusConfigError(`${RETIRED_ENGINE_MESSAGE} (from ${source})`);
    }
    throw new AnimusConfigError(
      `animus: unknown extraction engine "${selection}" from ${source}: the ` +
        "extractor is the only engine, selected by 'v2' or by no selection."
    );
  }
}
