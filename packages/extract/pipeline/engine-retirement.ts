export const RETIRED_ENGINE_MESSAGE =
  "animus: the 'v1' extraction engine is no longer supported, and v2 is the " +
  'only engine. Remove the engine option from your Animus config and unset ' +
  'the ANIMUS_ENGINE environment variable.';

export function assertNoRetiredEngineSelection(
  engineOption: string | undefined
): void {
  if (engineOption === 'v1' || process.env.ANIMUS_ENGINE === 'v1') {
    throw new Error(RETIRED_ENGINE_MESSAGE);
  }
}
