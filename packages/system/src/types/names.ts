/**
 * Registered names as an object type whose keys print in the order they were
 * added. A union of names prints in the type checker's order, so a kit's
 * emitted declarations could reorder from one build to the next. Read the
 * names with `keyof`.
 */
export type NameSet = Record<string, true>;

export type NoNames = Record<never, true>;

/** Names as a public generic takes them: an ordered set, or a union of names
 *  as written before sets — one or the other, not a mix of both. */
export type RegisteredNames = NameSet | string;

/** `N` as an ordered set; a union becomes the set of its members. */
export type AsNameSet<N> = [N] extends [string]
  ? Record<N & string, true>
  : Extract<N, NameSet>;

/** `N`'s names as a union. */
export type NamesIn<N> = [N] extends [string] ? N : keyof N & string;

/** `N` as an ordered set where no constraint needs `AsNameSet`'s proof. */
type ToNameSet<N> = [N] extends [string] ? Record<N & string, true> : N;

/** `Base`'s names, then the names `Added` adds, in its order. */
export type WithNames<Base, Added> = {
  [K in keyof (ToNameSet<Base> & ToNameSet<Added>)]: true;
};

/** The string keys of `M`, in its declaration order. */
export type KeyNames<M> = {
  [K in keyof M as K extends string ? K : never]: true;
};

/** An alias map's names; none when its keys are not literal (`_${string}`). */
export type AliasNames<M> = `_${string}` extends keyof M
  ? NoNames
  : KeyNames<M>;
