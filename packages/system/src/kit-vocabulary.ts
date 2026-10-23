/**
 * A kit's vocabulary, read at the type level from the bundle its system
 * `build()` returns. This first slice seals a bundle's registries.
 *
 * Each builder stage carries the prop and group registries, and TypeScript
 * walks them again at every stage it instantiates, since it treats an
 * object-literal or mapped type as possibly holding type variables. A
 * registry behind a mapped type alias declared at the top level of the
 * kit's own module is one it knows holds none, so it stops there: the same
 * vocabulary, checked in a fraction of the time. The alias must be written
 * in that module; a generic helper that wrapped it would carry type
 * arguments and seal nothing.
 *
 * The helpers read a bundle by property and never match the whole bundle
 * type (`B extends SystemBundle<infer …>`): that compares every member of
 * the bundle, a cost each check of the kit's module pays again, and so
 * every completion after an edit.
 */
import type { CONDS_BRAND, RegistryBrand, SELS_BRAND } from './conditions';
import type { SystemBundle, VOCABULARY_BRAND } from './SystemBuilder';
import type { SystemProp } from './types/config';

/** What the helpers read of a `build()` bundle. */
interface BuiltBundle {
  readonly system: RegistryBrand<string, string> & {
    readonly propRegistry: unknown;
    readonly groupRegistry: unknown;
  };
  seal(): { readonly [VOCABULARY_BRAND]?: [string] };
}

/**
 * The prop registry of a `build()` bundle: each styling prop it registers,
 * with its configuration. Seal it with a mapped alias in the kit's module:
 *
 * ```ts
 * const built = createSystem().addGroup('space', space).build();
 * type Props = PropsOf<typeof built>;
 * export type KitProps = { [K in keyof Props]: Props[K] };
 * ```
 */
export type PropsOf<Bundle extends BuiltBundle> =
  Bundle['system']['propRegistry'];

/**
 * The group registry of a `build()` bundle: each group it registers, with
 * the props it holds. Seal it with a mapped alias in the kit's module:
 *
 * ```ts
 * const built = createSystem().addGroup('space', space).build();
 * type Groups = GroupsOf<typeof built>;
 * export type KitGroups = { [K in keyof Groups]: Groups[K] };
 * ```
 */
export type GroupsOf<Bundle extends BuiltBundle> =
  Bundle['system']['groupRegistry'];

/**
 * `Bundle` with its registries sealed: `PropReg` and `GroupReg` in place of
 * its own, its condition, selector and vocabulary axes kept as it carries
 * them (a `string` or generic axis too). The sealed
 * registries are the bundle's own, mapped (`PropsOf`, `GroupsOf`); a
 * bundle assigns to no seal of other registries. It seals a bundle as
 * `build()` and its registrations return it: the vocabulary is read from
 * `seal()`, so a wrapper that overrides `seal()` with overloads is not
 * supported. Seal the bundle with both aliases, and author against it:
 *
 * ```ts
 * export type KitProps = { [K in keyof Props]: Props[K] };
 * export type KitGroups = { [K in keyof Groups]: Groups[K] };
 * export const bundle: SealedBundle<typeof built, KitProps, KitGroups> = built;
 * ```
 */
export type SealedBundle<
  Bundle extends BuiltBundle,
  PropReg extends Record<string, SystemProp>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
> = SystemBundle<
  PropReg,
  GroupReg,
  // Read through the brands, never `ConditionsOf`/`SelectorsOf`/
  // `VocabularyOf`, which normalise an axis for augmentation (`string` to
  // never, `Extract<V, string>` for a generic `V`); and inline, so a kit's
  // declarations print the axes themselves, not an alias it cannot name.
  Bundle['system'][typeof CONDS_BRAND] & string,
  Bundle['system'][typeof SELS_BRAND] & string,
  NonNullable<ReturnType<Bundle['seal']>[typeof VOCABULARY_BRAND]>[0] & string
>;
