/**
 * Loud rejection of the retired v1 extraction engine (openspec:
 * retire-extract-v1).
 *
 * v2 is the only engine. Selecting v1 — via a plugin `engine: 'v1'` option or
 * the `ANIMUS_ENGINE=v1` fixture env override — is a build-stopping error, never
 * a silent upgrade to v2 (design D1: a silent flip would let a pinned consumer's
 * build change engines without notice). Both extraction plugins call this before
 * any engine selection so the rejection is uniform and the message is defined
 * once.
 */

/** The one canonical retirement message, shared verbatim by both plugins and
 *  the env path (tasks.md cross-cutting: define once, reuse). */
export const RETIRED_ENGINE_MESSAGE =
  "animus: extraction engine 'v1' was retired (openspec: retire-extract-v1) — " +
  'v2 is the only engine; remove the engine option / ANIMUS_ENGINE override';

/**
 * Throw the canonical retirement error when v1 is selected through either
 * surface. Accepts the raw engine option as a string because the option type no
 * longer admits `'v1'` — callers cast it so a stale `'v1'` config still fails
 * loud at runtime instead of being silently coerced.
 */
export function assertNoRetiredEngineSelection(
  engineOption: string | undefined
): void {
  if (engineOption === 'v1' || process.env.ANIMUS_ENGINE === 'v1') {
    throw new Error(RETIRED_ENGINE_MESSAGE);
  }
}
