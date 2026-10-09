/** `T`'s declared keys, without a string index signature. */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : K]: T[K];
};

/** The variant and state props a component declared. */
export type StylingNames<Variants, States> = Extract<
  KnownKeys<Variants> | KnownKeys<States>,
  string
>;

/** The system props one `.system()` key admits: a group's members, or the prop. */
type PickedProps<GroupRegistry, Key> = Key extends keyof GroupRegistry
  ? GroupRegistry[Key] extends readonly (infer Member)[]
    ? Extract<Member, string>
    : never
  : Extract<Key, string>;

/** The system props a component admitted. */
export type AdmittedNames<GroupRegistry, ActiveGroups> = PickedProps<
  GroupRegistry,
  KnownKeys<ActiveGroups>
>;

/**
 * A `.system()` config. Each key is `true`, unless it admits a prop that a
 * variant or state already names: one value would then drive both.
 */
export type SystemPicks<
  GroupRegistry,
  Picked extends PropertyKey,
  Names extends string,
> = {
  [K in Picked]: [Extract<PickedProps<GroupRegistry, K>, Names>] extends [never]
    ? true
    : K extends keyof GroupRegistry
      ? `"${K & string}" admits "${Extract<PickedProps<GroupRegistry, K>, Names>}", already a variant or state prop`
      : `"${K & string}" is already a variant or state prop`;
};

/** A variant prop name, unless a system prop of that name is admitted. */
export type UnadmittedName<
  Name extends string,
  Admitted,
> = Name extends Admitted
  ? `"${Name}" is already an admitted system prop`
  : Name;

/** Rejects each state named after an admitted system prop. */
export type UnadmittedStates<Props, Admitted> = {
  [
    K in Extract<keyof Props, Admitted>
  ]: `"${K & string}" is already an admitted system prop`;
};
