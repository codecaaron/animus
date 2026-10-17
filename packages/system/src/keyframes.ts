import { fnv1a, type NamedRef, namedEntries, serializeBlock } from './named';

/**
 * Frame values take raw CSS or `{scale.key}` token references; a bare scale
 * key is not resolved. The extractor substitutes refs with the hashed name.
 */

export type KeyframeFrameMap = Record<string, Record<string, unknown>>;

export type KeyframeRef<Name extends string> = NamedRef<'KeyframeRef', Name>;

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

const serializeFrames = (frames: KeyframeFrameMap): string => {
  const stops = Object.keys(frames).sort();
  return stops
    .map((stop) => `${stop}{${serializeBlock(frames[stop] ?? {})}}`)
    .join('|');
};

const generateName = (frames: KeyframeFrameMap): string =>
  `animus-kf-${fnv1a(serializeFrames(frames))}`;

export function keyframes<Map extends Record<string, KeyframeFrameMap>>(
  map: Map
): Keyframes<Map> {
  const { entries, refs } = namedEntries(
    map,
    'KeyframeRef',
    (_key, frames) => ({
      name: generateName(frames),
      frames,
    })
  );
  // SAFETY: `entries` and `refs` hold exactly the keys of `map`, each built
  // from that key's frames.
  return {
    __brand: 'Keyframes' as const,
    __frames: entries,
    ...refs,
  } as Keyframes<Map>;
}
