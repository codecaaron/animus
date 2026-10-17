import { fnv1a, type NamedRef, namedEntries, serializeBlock } from './named';

import type { PropertyTypes } from './types/properties';

/**
 * The properties an `@position-try` rule accepts: inset, margin, sizing and
 * self-alignment properties, `position-anchor` and `position-area`.
 */
export const POSITION_TRY_DESCRIPTORS = [
  'positionAnchor',
  'positionArea',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'blockSize',
  'inlineSize',
  'minBlockSize',
  'minInlineSize',
  'maxBlockSize',
  'maxInlineSize',
  'alignSelf',
  'justifySelf',
  'placeSelf',
] as const;

export type PositionTryDescriptor = (typeof POSITION_TRY_DESCRIPTORS)[number];

/** One fallback position: raw CSS values or `{scale.key}` token references. */
export type PositionTryDescriptors = {
  readonly [K in PositionTryDescriptor]?: PropertyTypes[K];
};

export type PositionTryRef<Name extends string> = NamedRef<
  'PositionTryRef',
  Name
>;

export type PositionTries<Map extends Record<string, PositionTryDescriptors>> =
  {
    readonly __brand: 'PositionTries';
    readonly __tries: {
      readonly [K in keyof Map & string]: {
        readonly name: string;
        readonly descriptors: Map[K];
      };
    };
  } & {
    readonly [K in keyof Map & string]: PositionTryRef<K>;
  };

const ACCEPTED: ReadonlySet<string> = new Set(POSITION_TRY_DESCRIPTORS);

/**
 * Each fallback position, named `--animus-pt-{hash}` from its descriptors,
 * with a ref that prints as that name. A property `@position-try` does not
 * accept throws.
 */
export function positionTries<
  Map extends Record<string, PositionTryDescriptors>,
>(map: Map): PositionTries<Map> {
  const { entries, refs } = namedEntries(
    map,
    'PositionTryRef',
    (key, descriptors: PositionTryDescriptors) => {
      const rejected = Object.keys(descriptors).filter(
        (property) => !ACCEPTED.has(property)
      );
      if (rejected.length > 0) {
        throw new TypeError(
          `createPositionTry: "${key}" sets ${rejected.join(', ')}, which ` +
            '@position-try does not accept — only inset, margin, sizing and ' +
            'self-alignment properties, positionAnchor and positionArea.'
        );
      }
      return {
        name: `--animus-pt-${fnv1a(serializeBlock(descriptors))}`,
        descriptors,
      };
    }
  );
  // SAFETY: `entries` and `refs` hold exactly the keys of `map`, each built
  // from that key's descriptors.
  return {
    __brand: 'PositionTries' as const,
    __tries: entries,
    ...refs,
  } as PositionTries<Map>;
}
