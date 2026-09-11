/**
 * Frame values take raw CSS or `{scale.key}` token references; a bare scale
 * key is not resolved. The extractor substitutes refs with the hashed name.
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
