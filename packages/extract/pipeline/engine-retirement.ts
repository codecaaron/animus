export const RETIRED_ENGINE_MESSAGE =
  "animus: extraction engine 'v1' was retired (openspec: retire-extract-v1) — " +
  'v2 is the only engine; remove the engine option / ANIMUS_ENGINE override';

export function assertNoRetiredEngineSelection(
  engineOption: string | undefined
): void {
  if (engineOption === 'v1' || process.env.ANIMUS_ENGINE === 'v1') {
    throw new Error(RETIRED_ENGINE_MESSAGE);
  }
}
