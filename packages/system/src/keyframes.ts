/**
 * Keyframes primitive — top-level factory for declaring named CSS animations
 * as a branded collection of typed per-key references.
 *
 * The returned collection is:
 *  - Branded (`__brand: 'Keyframes'`) for plugin discovery via named-export scan.
 *  - Carries raw frame data on `__frames` as `{ [key]: { name, frames } }`,
 *    where `name` is the resolved keyframes identifier emitted into CSS.
 *  - Exposes one `KeyframeRef<Name>` per named key — each ref coerces to its
 *    resolved name via `toString()`/`valueOf()` for runtime-fallback paths.
 *
 * Naming: each keyframe's name is generated at authoring time via a
 * deterministic FNV-1a content hash over its frame body (`animus-kf-<hash>`).
 * Identical frame bodies dedupe into a single `@keyframes` emission naturally.
 * The Rust extractor substitutes `motion.ember`-style member-expression
 * references in component styles to the static name at emit time.
 *
 * Frame body vocabulary (narrower than component styles — factory is not
 * system-bound, so prop-config resolution is not available):
 *  - CSS property names (camelCase → kebab-case at emission)
 *  - Raw CSS values
 *  - `{scale.key}` token references (resolved via theme_resolver at emission)
 *  - Bare scale keys (e.g. `textShadow: 'glow-text'`) are NOT resolved —
 *    consumers must use `{scale.key}` form for theme-resolved values.
 */

export type KeyframeFrameMap = Record<string, Record<string, unknown>>;

export interface KeyframeRef<Name extends string> {
  readonly __brand: 'KeyframeRef';
  readonly __name: Name;
  toString(): string;
  valueOf(): string;
}

export type Keyframes<Map extends Record<string, KeyframeFrameMap>> = {
  readonly __brand: 'Keyframes';
  readonly __frames: {
    readonly [K in keyof Map & string]: {
      readonly name: string;
      readonly frames: Map[K];
    };
  };
} & {
  readonly [K in keyof Map & string]: KeyframeRef<K>;
};

// FNV-1a 32-bit — small, deterministic, sufficient for non-cryptographic identity.
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash.toString(36);
};

const serializeFrames = (frames: KeyframeFrameMap): string => {
  const stops = Object.keys(frames).sort();
  return stops
    .map((stop) => {
      const frame = frames[stop] ?? {};
      const props = Object.keys(frame).sort();
      return `${stop}{${props.map((p) => `${p}:${String(frame[p])}`).join(';')}}`;
    })
    .join('|');
};

const generateName = (frames: KeyframeFrameMap): string =>
  `animus-kf-${fnv1a(serializeFrames(frames))}`;

const createRef = <Name extends string>(
  name: Name,
  resolvedName: string
): KeyframeRef<Name> => ({
  __brand: 'KeyframeRef',
  __name: name,
  toString() {
    return resolvedName;
  },
  valueOf() {
    return resolvedName;
  },
});

export function keyframes<Map extends Record<string, KeyframeFrameMap>>(
  map: Map
): Keyframes<Map> {
  const frameData: Record<string, { name: string; frames: KeyframeFrameMap }> =
    {};
  const refs: Record<string, KeyframeRef<string>> = {};

  for (const key of Object.keys(map)) {
    const frames = map[key];
    const resolvedName = generateName(frames);
    frameData[key] = { name: resolvedName, frames };
    refs[key] = createRef(key, resolvedName);
  }

  return {
    __brand: 'Keyframes' as const,
    __frames: frameData,
    ...refs,
  } as Keyframes<Map>;
}
