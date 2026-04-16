/**
 * Keyframes primitive — top-level factory for declaring named CSS animations
 * with full prop-config resolution parity to the structured `@keyframes`
 * selector form inside `createGlobalStyles`.
 *
 * The returned reference is:
 *  - Branded (`__brand: 'Keyframes'`) for plugin discovery via named-export scan.
 *  - Stringifiable via `toString()`/`valueOf()` so it coerces to the generated
 *    name when used as an `animationName:` value or embedded in CSS strings.
 *  - Data-only: the factory does not read theme context. Token / scale resolution
 *    happens downstream in the extraction pipeline (same pipeline as structured
 *    keyframes selectors).
 *
 * Naming: runtime `toString()` returns a content-hash name (`animus-kf-<hash>`).
 * Extraction-time substitution (emitting extracted CSS that references a
 * binding-aware name) is a future optimization — the runtime hash remains the
 * authoritative fallback and is used by both the plugin-emitted `@keyframes`
 * block and any dynamic-style path.
 */

export type KeyframeFrameValue = Record<string, unknown>;
export type KeyframesMap = Record<string, KeyframeFrameValue>;

export interface KeyframesReference {
  readonly __brand: 'Keyframes';
  readonly frames: KeyframesMap;
  readonly name: string;
  toString(): string;
  valueOf(): string;
}

// FNV-1a 32-bit — small, deterministic, sufficient for non-cryptographic identity.
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
};

const serializeFrames = (frames: KeyframesMap): string => {
  const stops = Object.keys(frames).sort();
  return stops
    .map((stop) => {
      const frame = frames[stop] ?? {};
      const props = Object.keys(frame).sort();
      return `${stop}{${props.map((p) => `${p}:${String((frame as Record<string, unknown>)[p])}`).join(';')}}`;
    })
    .join('|');
};

export function keyframes(frames: KeyframesMap): KeyframesReference {
  const hash = fnv1a(serializeFrames(frames));
  const name = `animus-kf-${hash}`;

  const ref: KeyframesReference = {
    __brand: 'Keyframes',
    frames,
    name,
    toString() {
      return name;
    },
    valueOf() {
      return name;
    },
  };

  return ref;
}
