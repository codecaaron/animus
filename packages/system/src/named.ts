/**
 * What registered artifacts (keyframes, position tries, view transitions)
 * share: a name hashed from content, and a ref that stands for that name.
 */

import { fallbackMembersOf } from './firstThatWorks';

import type { AbstractProps } from './types/props';

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

/**
 * A block of styles as a stable string, by key: what an artifact's name is
 * hashed from, the same with the system loader and without. A nested block
 * prints as `key{…}`, a `firstThatWorks` value as every member in order,
 * and any other value as `String()` writes it, so a ref prints as its name.
 */
export const serializeBlock = (block: AbstractProps): string =>
  Object.keys(block)
    .sort()
    .map((key) => {
      const value = block[key];
      if (value === null || value === undefined) return `${key}:${value}`;
      const members = fallbackMembersOf(Object(value));
      if (members) return `${key}:firstThatWorks(${JSON.stringify(members)})`;
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        return `${key}:${String(value)}`;
      }
      // SAFETY: a plain object in a block of styles is a nested block.
      return `${key}{${serializeBlock(value as AbstractProps)}}`;
    })
    .join(';');

/** A registered artifact's ref: prints, and serializes, as its name, so a
 *  registered block the loader reads holds the name a style references. */
export interface NamedRef<Brand extends string, Name extends string> {
  readonly __brand: Brand;
  readonly __name: Name;
  toString(): string;
  valueOf(): string;
  toJSON(): string;
}

/** A class, not a plain object, so `serializeBlock` prints it as its name. */
class ArtifactRef<
  Brand extends string,
  Name extends string,
> implements NamedRef<Brand, Name> {
  readonly #generated: string;

  constructor(
    readonly __brand: Brand,
    readonly __name: Name,
    generated: string
  ) {
    this.#generated = generated;
  }

  toString(): string {
    return this.#generated;
  }

  valueOf(): string {
    return this.#generated;
  }

  toJSON(): string {
    return this.#generated;
  }
}

/** Each key's entry, and a ref to the entry's name. */
export interface NamedEntries<
  Brand extends string,
  Entry extends { readonly name: string },
> {
  entries: Record<string, Entry>;
  refs: Record<string, NamedRef<Brand, string>>;
}

/**
 * Each key's entry, as `entryOf` names it, and a ref of brand `refBrand` to
 * that name.
 */
export function namedEntries<
  Brand extends string,
  Value,
  Entry extends { readonly name: string },
>(
  map: Readonly<Record<string, Value>>,
  refBrand: Brand,
  entryOf: (key: string, value: Value) => Entry
): NamedEntries<Brand, Entry> {
  const entries: Record<string, Entry> = {};
  const refs: Record<string, NamedRef<Brand, string>> = {};
  for (const [key, value] of Object.entries(map)) {
    const entry = entryOf(key, value);
    entries[key] = entry;
    refs[key] = new ArtifactRef(refBrand, key, entry.name);
  }
  return { entries, refs };
}
