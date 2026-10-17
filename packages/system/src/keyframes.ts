/**
 * Frame values take raw CSS or `{scale.key}` token references; a bare scale
 * key is not resolved. The extractor substitutes refs with the hashed name.
 */

export type KeyframeFrameMap = Record<string, Record<string, unknown>>;

/** Prints, and serializes, as the generated name: a registered block the
 *  loader reads holds the name a style references. */
export interface KeyframeRef<Name extends string> {
  readonly __brand: 'KeyframeRef';
  readonly __name: Name;
  toString(): string;
  valueOf(): string;
  toJSON(): string;
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

/** The 32-bit FNV-1a hash of `input`, in base 36. */
export const fnv1a = (input: string): string => {
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

/** One block's declarations, by property name, as a stable string. */
export const serializeBlock = (block: Record<string, unknown>): string =>
  Object.keys(block)
    .sort()
    .map((p) => `${p}:${String(block[p])}`)
    .join(';');

const serializeFrames = (frames: KeyframeFrameMap): string => {
  const stops = Object.keys(frames).sort();
  return stops
    .map((stop) => `${stop}{${serializeBlock(frames[stop] ?? {})}}`)
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
  toJSON() {
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
