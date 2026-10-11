import { AnimusConfigError } from './core-options';

export const RETIRED_ENGINE_MESSAGE =
  "animus: the 'v1' extraction engine is no longer supported, and v2 is the " +
  'only engine. Remove the engine option from your Animus config and unset ' +
  'the ANIMUS_ENGINE environment variable.';

/**
 * v2 is the only engine (SA2): the option and `ANIMUS_ENGINE`, a startup
 * input, accept `v2` or nothing. Hosts call this before the native module
 * loads, so another selection never reaches it.
 */
export function assertSupportedEngine(engineOption: string | undefined): void {
  const selections: Array<[string | undefined, string]> = [
    [engineOption, 'the engine option'],
    [process.env.ANIMUS_ENGINE || undefined, 'ANIMUS_ENGINE'],
  ];
  for (const [selection, source] of selections) {
    if (selection === undefined || selection === 'v2') continue;
    if (selection === 'v1') throw new Error(RETIRED_ENGINE_MESSAGE);
    throw new AnimusConfigError(
      `animus: unknown extraction engine "${selection}" from ${source}: v2 ` +
        'is the only engine.'
    );
  }
}
