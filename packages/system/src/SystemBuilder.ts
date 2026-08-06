import { Animus } from './Animus';
import { type AssetRef } from './asset.js';
import {
  type AtRuleValue,
  BUILT_IN_CONDITIONS,
  type ConditionAliasMap,
  mergeConditions,
  type NarrowedAliases,
  type RegistryBrand,
  type ReservedByConditionRegistry,
  type ReservedBySelectorRegistry,
  serializeConditionMap,
} from './conditions';
import {
  type KeyframeFrameMap,
  type Keyframes,
  keyframes as keyframesImpl,
} from './keyframes';
import {
  BUILT_IN_SELECTORS,
  mergeSelectors,
  type SelectorAliasMap,
  serializeSelectorMap,
} from './selectors';
import {
  areTransformsEqual,
  NamedTransform,
  TransformFn,
} from './transforms/createTransform';
import {
  type BuiltInConditionAlias,
  type BuiltInSelectorAlias,
  Prop,
  ThemedCSSProps,
} from './types/config';
import { AbstractProps } from './types/props';

interface SerializedPropEntry {
  property: string;
  properties?: string[];
  scale?: string | Record<string, string | number> | (string | number)[];
  transform?: string;
  currentVar?: string;
  negative?: boolean;
}

export type GlobalStyleMap = Record<string, Record<string, any>>;

/** One `src` descriptor of a font-face resource. */
export interface FontFaceSrc {
  /**
   * A literal string is emitted byte-exact as authored — asset resolution
   * and rewriting belong to the host bundler's CSS asset pipeline, not to
   * extraction. An `AssetRef` (from `asset(specifier)`) rides through
   * evaluation and emission as its placeholder string; the host plugin
   * substitutes the bundler-resolved URL after extraction.
   */
  url: string | AssetRef;
  /** Format hint (`woff2`, `woff`, …), rendered as `format('…')`. */
  format?: string;
}

/**
 * A typed `@font-face` descriptor (global-styles-system). `family` may use a
 * font-scale token reference (`{fonts.body}`); other descriptors take CSS
 * literals only.
 */
export interface FontFace {
  family: string;
  src: FontFaceSrc[];
  weight?: string;
  style?: string;
  display?: string;
  unicodeRange?: string;
  stretch?: string;
}

export interface GlobalStyleBlock {
  __brand: 'GlobalStyleBlock';
  styles: GlobalStyleMap;
  /** Rendered ahead of the block's selector rules in `@layer anm-global`. */
  fontFaces?: FontFace[];
}

export type GlobalStylesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Map extends Record<string, AbstractProps>>(
  styles: {
    readonly [K in keyof Map]: ThemedCSSProps<Map[K], PropReg>;
  },
  options?: { fontFaces?: readonly FontFace[] }
) => GlobalStyleBlock;

export type CreateKeyframesFactory<
  PropReg extends Record<string, Prop> = Record<string, Prop>,
> = <Frames extends Record<string, Record<string, AbstractProps>>>(frames: {
  readonly [N in keyof Frames]: {
    readonly [S in keyof Frames[N]]: ThemedCSSProps<Frames[N][S], PropReg>;
  };
}) => Keyframes<{
  readonly [N in keyof Frames]: KeyframeFrameMap;
}>;

type IncludableSystem = {
  toConfig(): SerializedConfig;
  /**
   * Present on every system built by this version (attached non-enumerably
   * next to `toConfig` — see `build()`). Optional in the type so systems
   * built by an older @animus-ui/system remain structurally acceptable
   * during the deprecation window; `extend()` fails loud at runtime when it
   * is absent (design D7 — no `SerializedConfig` reconstruction).
   */
  getRegistrySnapshot?(): RegistrySnapshot;
};

/**
 * The frozen registry state captured at `build()` (design D7). `toConfig()`
 * serializes from it and `extend()` merges from it, so post-build mutation of
 * the public `propRegistry`/`groupRegistry` fields affects neither. Containers
 * and per-entry objects are frozen shallow copies. Transforms are immutable,
 * cached forwarding wrappers so later mutation of function metadata cannot
 * alter serialization while anonymous transform behavior is retained.
 */
export interface RegistrySnapshot {
  props: Record<string, Prop>;
  groups: Record<string, readonly string[]>;
  selectors: SelectorAliasMap;
  conditions: ConditionAliasMap;
}

const snapshotTransformBySource = new WeakMap<TransformFn, TransformFn>();

function snapshotTransform(source: TransformFn): TransformFn {
  const cached = snapshotTransformBySource.get(source);
  if (cached) return cached;

  const wrapper: TransformFn = (value, property, props) =>
    source(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: source.name });
  // The wrapper's own source text is byte-identical for EVERY transform, so
  // it must present the wrapped function's text instead: bare-function
  // equality (design D12) and the QuickJS transform capture both go through
  // `toString()`, and the generic forwarder body would make all anonymous
  // transforms compare equal. `source.toString()` (not
  // Function.prototype.toString) so re-snapshotting a wrapper across extend
  // generations keeps yielding the ORIGINAL text.
  const sourceText = source.toString();
  Object.defineProperty(wrapper, 'toString', {
    value: () => sourceText,
  });
  const named = source as Partial<NamedTransform>;
  if (named.transformName !== undefined) {
    Object.defineProperty(wrapper, 'transformName', {
      value: named.transformName,
      enumerable: true,
    });
  }
  if (named.transformSource !== undefined) {
    Object.defineProperty(wrapper, 'transformSource', {
      value: named.transformSource,
      enumerable: true,
    });
  }
  Object.freeze(wrapper);
  snapshotTransformBySource.set(source, wrapper);
  return wrapper;
}

/**
 * A library bundle groups one export for both builders: the system half is
 * consumed by `createSystem().extend()`, the theme half by
 * `createTheme().extend()`; each builder takes its half and ignores the rest.
 * `tokens` is the pre-D9 name for the theme half — both spellings are
 * accepted (design D9; removal horizon is DEF-8).
 */
export interface LibraryBundle {
  system: IncludableSystem;
  theme?: unknown;
  tokens?: unknown;
}

/**
 * The one runtime discriminator for a library bundle: `system.toConfig`
 * being callable. A built system instance also has a `.system()` CHAIN
 * METHOD, so presence of a `system` key alone cannot discriminate the two
 * shapes. Both builders' `from()` use this guard; the QuickJS capture
 * script in the Rust system-loader mirrors it by necessity (it cannot
 * import TS) and points back here.
 */
export function isLibraryBundle(value: unknown): value is LibraryBundle {
  const system = (value as { system?: { toConfig?: unknown } } | null)?.system;
  return Boolean(system) && typeof system?.toConfig === 'function';
}

export interface CreateSystemConfig {
  /**
   * @deprecated Use `createSystem().extend(source)` — the single extension
   * verb on both builders, which actually merges the source's registries.
   * The alias keeps its frozen pre-existing semantics (discovery membership
   * via the same source list, NO registry merge, no type-surface admission)
   * for at least one minor release after `extend()` ships.
   */
  includes?: readonly IncludableSystem[];
}

declare const STAGE_BRAND: unique symbol;

/**
 * Builder type-state for the inherit-first rule: `extend()` (and the
 * deprecated `from()`) is only callable while the builder is in the
 * `'inherit'` stage; every extension call (`addGroup`, `addProps`,
 * `addSelectors`, `addConditions`) advances to `'extend'`, making "inherit
 * first, then extend" a compile error rather than a lint. Phantom — never
 * present at runtime.
 */
export type SystemBuilderStage = 'inherit' | 'extend';

function orderedPropertiesEqual(
  existing: Prop['properties'],
  incoming: Prop['properties']
): boolean {
  if (existing === incoming) {
    return true;
  }

  if (!existing || !incoming || existing.length !== incoming.length) {
    return false;
  }

  return existing.every((property, index) => property === incoming[index]);
}

function scalesEqual(
  existing: Prop['scale'],
  incoming: Prop['scale']
): boolean {
  if (existing === incoming) return true;
  if (!existing || !incoming || typeof existing !== typeof incoming) {
    return false;
  }
  if (typeof existing === 'string' || typeof incoming === 'string') {
    return false;
  }
  if (Array.isArray(existing) || Array.isArray(incoming)) {
    return (
      Array.isArray(existing) &&
      Array.isArray(incoming) &&
      existing.length === incoming.length &&
      existing.every((value, index) => value === incoming[index])
    );
  }
  const existingMap = existing as Record<string, string | number>;
  const incomingMap = incoming as Record<string, string | number>;
  const existingKeys = Object.keys(existingMap).sort();
  const incomingKeys = Object.keys(incomingMap).sort();
  return (
    orderedMembersEqual(existingKeys, incomingKeys) &&
    existingKeys.every((key) => existingMap[key] === incomingMap[key])
  );
}

function arePropDefinitionsEqual(
  existing: Prop,
  incoming: Prop,
  structuralScale = false
): boolean {
  return (
    existing.property === incoming.property &&
    orderedPropertiesEqual(existing.properties, incoming.properties) &&
    (structuralScale
      ? scalesEqual(existing.scale, incoming.scale)
      : existing.scale === incoming.scale) &&
    existing.variable === incoming.variable &&
    existing.negative === incoming.negative &&
    existing.strict === incoming.strict &&
    existing.currentVar === incoming.currentVar &&
    areTransformsEqual(existing.transform, incoming.transform)
  );
}

function orderedMembersEqual(
  existing: readonly string[],
  incoming: readonly string[]
): boolean {
  return (
    existing.length === incoming.length &&
    existing.every((member, index) => member === incoming[index])
  );
}

/**
 * Divergent-prop error naming both definitions AND both origins — used by the
 * `extend()` merge (sibling/dual-version conflicts, design D3/G4) and by
 * `addGroup`/`addProps` when the colliding entry arrived through `extend()`
 * (origin labels "extended source #n" / "builder state"). When no extension
 * provenance exists, the pre-existing origin-less messages are kept verbatim.
 */
function divergentPropError(
  key: string,
  existing: Prop,
  incoming: Prop,
  existingOrigin: string,
  incomingOrigin: string
): Error {
  return new Error(
    `Prop "${key}" already registered with a different definition. ` +
      `Existing (${existingOrigin}): property="${existing.property}", scale="${String(existing.scale)}". ` +
      `Incoming (${incomingOrigin}): property="${incoming.property}", scale="${String(incoming.scale)}".`
  );
}

export class SystemBuilder<
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
  Conds extends string = never,
  Sels extends string = never,
  Stage extends SystemBuilderStage = 'inherit',
> {
  // Structural anchor for the phantom Stage parameter — without a member
  // referencing it, 'inherit' and 'extend' builders would be mutually
  // assignable and the `this`-typed `from()` gate would never fire.
  declare readonly [STAGE_BRAND]?: Stage;

  #propRegistry: PropReg;
  #groupRegistry: GroupReg;
  #selectorRegistry: SelectorAliasMap;
  #includesRegistry: readonly IncludableSystem[];
  #conditionRegistry: ConditionAliasMap;
  // Per-name extension provenance (design D3): registry-prefixed name
  // (`prop:gap`, `group:space`, `selector:_hover`, `condition:_cardSm`) →
  // 1-based index of the `extend()` call that introduced it. Sibling and
  // dual-version conflicts name both origins from this map; entries the
  // builder registered itself have no key ("builder state").
  #extendProvenance: ReadonlyMap<string, number>;
  // Number of `extend()` calls made so far — the label index for the next
  // extended source. Distinct from the provenance map's max value: an extend
  // whose entries all coalesce still consumes an index.
  #extendCount: number;

  constructor(
    propRegistry?: PropReg,
    groupRegistry?: GroupReg,
    selectorRegistry?: SelectorAliasMap,
    includesRegistry?: readonly IncludableSystem[],
    conditionRegistry?: ConditionAliasMap,
    extendProvenance?: ReadonlyMap<string, number>,
    extendCount?: number
  ) {
    this.#propRegistry = propRegistry || ({} as PropReg);
    this.#groupRegistry = groupRegistry || ({} as GroupReg);
    this.#selectorRegistry = selectorRegistry || { ...BUILT_IN_SELECTORS };
    this.#includesRegistry = includesRegistry || [];
    this.#conditionRegistry = conditionRegistry || { ...BUILT_IN_CONDITIONS };
    this.#extendProvenance = extendProvenance || new Map();
    this.#extendCount = extendCount || 0;
  }

  // Origin label for divergence errors: where did the existing entry for
  // `provenanceKey` come from?
  #originOf(provenanceKey: string): string {
    const index = this.#extendProvenance.get(provenanceKey);
    return index === undefined ? 'builder state' : `extended source #${index}`;
  }

  /**
   * Declare inheritance from a consumed library: the source's TYPE surface is
   * admitted (prop/component types for compose/extend interop) and the source
   * joins extraction discovery membership. NO registry merge — consumer
   * configuration remains the singular authority, so props, groups,
   * selectors, and conditions the source registered do not enter this
   * builder's runtime registries. Chainable and repeatable, but only before
   * extension calls ("inherit first, then extend" — enforced by the phantom
   * builder stage). Accepts a built system instance or a library bundle
   * (`{ system, tokens }`), taking the system half and ignoring the rest.
   *
   * @deprecated Use `extend(source)` — the single extension verb on both
   * builders, whose type admission is backed by a real registry merge.
   * `from()` keeps these frozen semantics (type admission + discovery
   * membership, no merge) for at least one minor release.
   */
  from<
    SrcProps extends Record<string, Prop>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source:
      | SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>
      | {
          system: SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>;
          theme?: unknown;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit'
  >;
  /**
   * A value annotated as the exported {@link LibraryBundle} interface has
   * already erased its system half's generics (`system: IncludableSystem`),
   * so there is no type surface to admit — discovery and runtime semantics
   * are identical, and the builder's own type state passes through unchanged.
   *
   * @deprecated Use `extend(source)` — the single extension verb on both
   * builders, whose type admission is backed by a real registry merge.
   * `from()` keeps these frozen semantics (type admission + discovery
   * membership, no merge) for at least one minor release.
   */
  from(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source: LibraryBundle
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>;
  from(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source: IncludableSystem | { system?: unknown; tokens?: unknown }
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'> {
    const instance = isLibraryBundle(source)
      ? source.system
      : (source as IncludableSystem);
    return new SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      [...this.#includesRegistry, instance],
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount
    );
  }

  /**
   * Extend this system from a consumed library: the source's prop, group,
   * selector, and condition registries MERGE into the builder (design D1), so
   * the built system's type surface, `toConfig()` output, and extraction
   * reachability describe the same configuration. Identical definitions
   * coalesce; divergent definitions fail loud naming the entry and both
   * origins (design D3), including a post-extend attempt to redefine an
   * inherited prop. Local calls may add new entries and may replace inherited
   * group membership, selectors, or conditions; prop definitions never rebind
   * silently. Chainable and repeatable, but only before extension calls ("inherit first, then
   * extend" — enforced by the phantom builder stage). Accepts a built system
   * instance or a library bundle (`{ system, theme }`), taking the system
   * half and ignoring the rest. The merge consumes the source's registry
   * snapshot captured at its `build()` (design D7), never a serialized
   * round-trip.
   */
  extend<
    SrcProps extends Record<string, Prop>,
    SrcGroups extends Record<string, (keyof SrcProps)[]>,
    SrcConds extends string = never,
    SrcSels extends string = never,
  >(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source:
      | SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>
      | {
          system: SystemInstance<SrcProps, SrcGroups, SrcConds, SrcSels>;
          theme?: unknown;
          tokens?: unknown;
        }
  ): SystemBuilder<
    PropReg & SrcProps,
    GroupReg & SrcGroups,
    Conds | SrcConds,
    Sels | SrcSels,
    'inherit'
  >;
  /**
   * A value annotated as the exported {@link LibraryBundle} interface has
   * already erased its system half's generics (`system: IncludableSystem`),
   * so no source types are admitted — the runtime merge is identical, and
   * the builder's own type state passes through unchanged.
   */
  extend(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source: LibraryBundle
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>;
  extend(
    this: SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>,
    source: IncludableSystem | { system?: unknown; theme?: unknown }
  ): SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'> {
    const instance = isLibraryBundle(source)
      ? source.system
      : (source as IncludableSystem);
    const snapshot = instance.getRegistrySnapshot?.();
    if (!snapshot) {
      throw new Error(
        'extend: source system carries no registry snapshot — it was built ' +
          'by an older @animus-ui/system. Rebuild the source against this ' +
          'version (a lossy toConfig() reconstruction is never substituted).'
      );
    }

    const sourceIndex = this.#extendCount + 1;
    const incomingOrigin = `extended source #${sourceIndex}`;
    const provenance = new Map(this.#extendProvenance);

    // ── Props: absent → add; equal → coalesce; divergent → loud, both
    // origins named (design D3; sibling/dual-version conflicts are G4).
    const nextProps: Record<string, Prop> = { ...this.#propRegistry };
    for (const [name, incoming] of Object.entries(snapshot.props)) {
      if (name in this.#groupRegistry) {
        throw new Error(
          `extend: prop "${name}" (${incomingOrigin}) collides with an ` +
            `existing group name (${this.#originOf(`group:${name}`)}). ` +
            `Group names and prop names must be disjoint.`
        );
      }
      const existing = nextProps[name];
      if (!existing) {
        nextProps[name] = incoming;
        provenance.set(`prop:${name}`, sourceIndex);
      } else if (!arePropDefinitionsEqual(existing, incoming, true)) {
        throw divergentPropError(
          name,
          existing,
          incoming,
          this.#originOf(`prop:${name}`),
          incomingOrigin
        );
      }
      // Equal → coalesce: keep the existing entry and its first provenance.
    }

    // ── Groups: ordered-membership equality → coalesce; divergent → loud;
    // group-name-vs-prop-name cross-collision mirrors addGroup.
    const nextGroups: Record<string, readonly string[]> = {
      ...(this.#groupRegistry as Record<string, readonly string[]>),
    };
    for (const [name, incoming] of Object.entries(snapshot.groups)) {
      const existing = nextGroups[name];
      if (!existing) {
        if (name in nextProps) {
          throw new Error(
            `extend: group name "${name}" (${incomingOrigin}) collides with ` +
              `an existing prop name (${this.#originOf(`prop:${name}`)}). ` +
              `Group names and prop names must be disjoint.`
          );
        }
        nextGroups[name] = [...incoming];
        provenance.set(`group:${name}`, sourceIndex);
      } else if (!orderedMembersEqual(existing, incoming)) {
        throw new Error(
          `extend: group "${name}" already registered with different ` +
            `membership. ` +
            `Existing (${this.#originOf(`group:${name}`)}): [${existing.join(', ')}]. ` +
            `Incoming (${incomingOrigin}): [${incoming.join(', ')}].`
        );
      }
    }

    // ── Selectors: entries identical to the built-in default are inert
    // (every source carries the seeded built-ins — they must coalesce
    // silently). A deliberate registration coalesces on string equality
    // keeping the existing order, overrides a pristine built-in (source
    // seeds the base, design D2), and conflicts loud with a deliberate
    // registration from another extended source.
    const selectorOverrides: SelectorAliasMap = {};
    const newSelectors: Record<string, string> = {};
    for (const [name, incoming] of Object.entries(snapshot.selectors)) {
      const builtIn = BUILT_IN_SELECTORS[name];
      if (builtIn && builtIn.selector === incoming.selector) {
        continue;
      }
      if (name in this.#conditionRegistry) {
        throw new Error(
          `extend: selector alias "${name}" (${incomingOrigin}) is already ` +
            `registered as a condition alias ` +
            `(${this.#originOf(`condition:${name}`)}); a name resolves ` +
            `through exactly one registry. Pick a distinct name.`
        );
      }
      const existing = this.#selectorRegistry[name];
      if (!existing) {
        newSelectors[name] = incoming.selector;
        provenance.set(`selector:${name}`, sourceIndex);
      } else if (existing.selector !== incoming.selector) {
        const existingIndex = provenance.get(`selector:${name}`);
        if (existingIndex === undefined) {
          // Pristine built-in: the source's deliberate override wins,
          // preserving the built-in order (mirrors mergeSelectors).
          selectorOverrides[name] = {
            selector: incoming.selector,
            order: existing.order,
          };
          provenance.set(`selector:${name}`, sourceIndex);
        } else {
          throw new Error(
            `extend: selector alias "${name}" already registered with a ` +
              `different selector. ` +
              `Existing (extended source #${existingIndex}): "${existing.selector}". ` +
              `Incoming (${incomingOrigin}): "${incoming.selector}".`
          );
        }
      }
    }
    const nextSelectors = mergeSelectors(
      { ...this.#selectorRegistry, ...selectorOverrides },
      newSelectors
    );

    // ── Conditions: same policy keyed on `value` (kind derives from it,
    // `order` is a per-registry accident — existing order wins on coalesce);
    // new entries number through mergeConditions.
    const conditionOverrides: ConditionAliasMap = {};
    const newConditions: Record<string, string> = {};
    for (const [name, incoming] of Object.entries(snapshot.conditions)) {
      const builtIn = BUILT_IN_CONDITIONS[name];
      if (builtIn && builtIn.value === incoming.value) {
        continue;
      }
      if (name in nextSelectors) {
        throw new Error(
          `extend: condition alias "${name}" (${incomingOrigin}) is already ` +
            `registered as a selector alias ` +
            `(${this.#originOf(`selector:${name}`)}); a name resolves ` +
            `through exactly one registry. Pick a distinct name.`
        );
      }
      const existing = this.#conditionRegistry[name];
      if (!existing) {
        newConditions[name] = incoming.value;
        provenance.set(`condition:${name}`, sourceIndex);
      } else if (existing.value !== incoming.value) {
        const existingIndex = provenance.get(`condition:${name}`);
        if (existingIndex === undefined) {
          conditionOverrides[name] = {
            value: incoming.value,
            order: existing.order,
            kind: incoming.kind,
          };
          provenance.set(`condition:${name}`, sourceIndex);
        } else {
          throw new Error(
            `extend: condition alias "${name}" already registered with a ` +
              `different condition. ` +
              `Existing (extended source #${existingIndex}): "${existing.value}". ` +
              `Incoming (${incomingOrigin}): "${incoming.value}".`
          );
        }
      }
    }
    const nextConditions = mergeConditions(
      { ...this.#conditionRegistry, ...conditionOverrides },
      newConditions,
      new Set(Object.keys(nextSelectors))
    );

    return new SystemBuilder<PropReg, GroupReg, Conds, Sels, 'inherit'>(
      nextProps as PropReg,
      nextGroups as GroupReg,
      nextSelectors,
      // Runtime parity with from(): the source instance stays discovery- and
      // includes-visible (the tracer's extend() form lands in increment 06).
      [...this.#includesRegistry, instance],
      nextConditions,
      provenance,
      sourceIndex
    );
  }

  /**
   * Register custom selector aliases (`_hoverChild`, …) → `&`-relative selector
   * strings. Overriding a built-in SELECTOR alias is legal; a name owned by the
   * CONDITION registry (built-in or registered earlier in this chain) maps to
   * the branded `ReservedByConditionRegistry` instead of its selector string —
   * the compile-time complement of the cross-registry throw below. The clash is
   * checked in VALUE position so `S` stays a naked inference site; subtracting
   * the reserved names from the KEY position is impossible — `Exclude` is a
   * silent no-op against a template-literal pattern. `NarrowedAliases` keeps a
   * widened `Conds` from swallowing the whole `_` namespace.
   */
  addSelectors<S extends Record<`_${string}`, string>>(
    selectors: S & {
      [K in keyof S]: K extends BuiltInConditionAlias | NarrowedAliases<Conds>
        ? ReservedByConditionRegistry<K & string>
        : S[K];
    }
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds,
    Sels | Extract<keyof S, string>,
    'extend'
  > {
    // Cross-registry clash guard, REVERSE direction (inc-11 full-pass F-1.4):
    // a name already registered as a CONDITION alias must not be re-registered
    // as a selector — Rust dispatch prefers selector aliases, so the condition
    // would silently never resolve. addConditions guards the other direction.
    for (const name of Object.keys(selectors)) {
      if (name in this.#conditionRegistry) {
        throw new Error(
          `addSelectors: "${name}" is already registered as a condition alias; ` +
            'a name resolves through exactly one registry. Pick a distinct name.'
        );
      }
    }
    const merged = mergeSelectors(this.#selectorRegistry, selectors);
    // Conds/Sels/Stage are phantom type-state (no runtime constructor slot);
    // the accumulated union and the 'extend' stage advance are applied via
    // explicit constructor type arguments.
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds,
      Sels | Extract<keyof S, string>,
      'extend'
    >(
      this.#propRegistry,
      this.#groupRegistry,
      merged,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount
    );
  }

  /**
   * Register condition aliases (`_motionReduce`, `_cardSm`, …) → at-rule
   * condition strings (`@media …` / `@container …` / `@supports …`).
   * Recognized as block keys in style objects; user aliases override built-ins
   * of the same name (design D3). Keys are constrained to `_`-prefixed aliases
   * and values to `@`-prefixed at-rule strings — a value that does not begin
   * with an at-rule name is a compile-time type error (design D9; the runtime
   * `inferConditionKind` throw is defense-in-depth). The registered keys are
   * accumulated into the phantom `Conds` union and surfaced on `build()`.
   *
   * A key owned by the SELECTOR registry (built-in or registered earlier in
   * this chain) maps to the branded `ReservedBySelectorRegistry` — see
   * `addSelectors` for why the clash is checked in value position. Overriding a
   * built-in CONDITION alias stays legal (design D3); only the OPPOSITE
   * registry is subtracted.
   */
  addConditions<C extends Record<`_${string}`, AtRuleValue>>(
    conditions: C & {
      [K in keyof C]: K extends BuiltInSelectorAlias | NarrowedAliases<Sels>
        ? ReservedBySelectorRegistry<K & string>
        : C[K];
    }
  ): SystemBuilder<
    PropReg,
    GroupReg,
    Conds | Extract<keyof C, string>,
    Sels,
    'extend'
  > {
    const merged = mergeConditions(
      this.#conditionRegistry,
      conditions,
      new Set(Object.keys(this.#selectorRegistry))
    );
    return new SystemBuilder<
      PropReg,
      GroupReg,
      Conds | Extract<keyof C, string>,
      Sels,
      'extend'
    >(
      this.#propRegistry,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      merged,
      this.#extendProvenance,
      this.#extendCount
    );
  }

  addGroup<Name extends string, Conf extends Record<string, Prop>>(
    name: Name extends keyof PropReg ? never : Name,
    config: Conf
  ): SystemBuilder<
    PropReg & Conf,
    GroupReg & Record<Name, (keyof Conf)[]>,
    Conds,
    Sels,
    'extend'
  > {
    // Collision check: group name must not collide with any registered prop name
    if (name in this.#propRegistry) {
      throw new Error(
        `Group name "${name}" collides with an existing prop name. ` +
          `Group names and prop names must be disjoint.`
      );
    }

    // Overlap tolerance: check existing props for definition match
    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
        const incoming = config[key];
        // structuralScale only for entries that arrived through extend():
        // those carry a frozen COPY of their object/array scale (registry
        // snapshot), so identity comparison would false-conflict a
        // byte-identical re-registration. Direct builder-vs-builder overlap
        // keeps identity semantics — in one file, sharing the reference is
        // the correct authoring.
        const viaExtend = this.#extendProvenance.has(`prop:${key}`);
        if (!arePropDefinitionsEqual(existing, incoming, viaExtend)) {
          // Divergence against an entry that arrived through extend() names
          // both origins (design D3); builder-vs-builder keeps the
          // pre-existing message.
          if (this.#extendProvenance.has(`prop:${key}`)) {
            throw divergentPropError(
              key,
              existing,
              incoming,
              this.#originOf(`prop:${key}`),
              'builder state'
            );
          }
          throw new Error(
            `Prop "${key}" already registered with a different definition. ` +
              `Existing: property="${existing.property}", scale="${String(existing.scale)}". ` +
              `Incoming: property="${incoming.property}", scale="${String(incoming.scale)}".`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    const newGroup = {
      [name]: Object.keys(config),
    } as Record<Name, (keyof Conf)[]>;
    const nextGroups = { ...this.#groupRegistry, ...newGroup };

    return new SystemBuilder<
      PropReg & Conf,
      GroupReg & Record<Name, (keyof Conf)[]>,
      Conds,
      Sels,
      'extend'
    >(
      nextProps,
      nextGroups,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount
    );
  }

  addProps<
    Conf extends Record<string, Prop> &
      Partial<Record<Extract<keyof GroupReg, string>, never>>,
  >(
    config: Conf
  ): SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend'> {
    // Collision check: prop names must not collide with any registered group name
    for (const key of Object.keys(config)) {
      if (key in this.#groupRegistry) {
        throw new Error(
          `Prop name "${key}" collides with an existing group name. ` +
            `Group names and prop names must be disjoint.`
        );
      }
    }

    // Overlap tolerance: same check as addGroup
    for (const key of Object.keys(config)) {
      if (key in this.#propRegistry) {
        const existing = (this.#propRegistry as Record<string, Prop>)[key];
        const incoming = (config as Record<string, Prop>)[key];
        // structuralScale for extended entries — same rationale as addGroup.
        const viaExtend = this.#extendProvenance.has(`prop:${key}`);
        if (!arePropDefinitionsEqual(existing, incoming, viaExtend)) {
          // Divergence against an entry that arrived through extend() names
          // both origins (design D3); builder-vs-builder keeps the
          // pre-existing message.
          if (this.#extendProvenance.has(`prop:${key}`)) {
            throw divergentPropError(
              key,
              existing,
              incoming,
              this.#originOf(`prop:${key}`),
              'builder state'
            );
          }
          throw new Error(
            `Prop "${key}" already registered with a different definition.`
          );
        }
      }
    }

    const nextProps = { ...this.#propRegistry, ...config };
    return new SystemBuilder<PropReg & Conf, GroupReg, Conds, Sels, 'extend'>(
      nextProps,
      this.#groupRegistry,
      this.#selectorRegistry,
      this.#includesRegistry,
      this.#conditionRegistry,
      this.#extendProvenance,
      this.#extendCount
    );
  }

  build(): {
    system: SystemInstance<PropReg, GroupReg, Conds, Sels>;
    createGlobalStyles: GlobalStylesFactory<PropReg>;
    createKeyframes: CreateKeyframesFactory<PropReg>;
  } {
    // Copied containers AND entries (review probe P9, both depths): the
    // instance's public mutable propRegistry/groupRegistry fields must not
    // alias the builder's private state at any level, or mutating a built
    // instance (a key, or a field inside an entry) would bake into a LATER
    // build()'s snapshot on the same builder. The current build's snapshot
    // deep-copies its own view separately below.
    const animus = new Animus<PropReg, GroupReg>(
      Object.fromEntries(
        Object.entries(this.#propRegistry).map(([key, entry]) => [
          key,
          { ...entry },
        ])
      ) as PropReg,
      Object.fromEntries(
        Object.entries(this.#groupRegistry).map(([key, members]) => [
          key,
          [...(members as readonly string[])],
        ])
      ) as GroupReg
    );

    // Immutable registry snapshot (design D7): toConfig() and extend() both
    // read from it, so post-build mutation of the public mutable
    // propRegistry/groupRegistry fields affects neither.
    const snapshot = createRegistrySnapshot(
      this.#propRegistry,
      this.#groupRegistry as Record<string, readonly string[]>,
      this.#selectorRegistry,
      this.#conditionRegistry
    );

    const system = Object.assign(animus, {
      toConfig: (): SerializedConfig => {
        return serializeInstance(
          snapshot.props,
          snapshot.groups,
          snapshot.selectors,
          snapshot.conditions
        );
      },
    }) as SystemInstance<PropReg, GroupReg, Conds, Sels>;

    // Non-enumerable next to toConfig: additive on the built instance, so
    // the QuickJS capture script's bundle discriminator (keyed on
    // `system.toConfig` being callable) is untouched.
    Object.defineProperty(system, 'getRegistrySnapshot', {
      value: (): RegistrySnapshot => snapshot,
      enumerable: false,
    });

    const createGlobalStyles = ((
      styles: GlobalStyleMap,
      options?: { fontFaces?: readonly FontFace[] }
    ): GlobalStyleBlock => ({
      __brand: 'GlobalStyleBlock' as const,
      styles,
      ...(options?.fontFaces?.length
        ? { fontFaces: [...options.fontFaces] }
        : {}),
    })) as GlobalStylesFactory<PropReg>;

    const createKeyframes = ((frames: Record<string, KeyframeFrameMap>) =>
      keyframesImpl(frames)) as CreateKeyframesFactory<PropReg>;

    return { system, createGlobalStyles, createKeyframes };
  }
}

export type SystemInstance<
  PropReg extends Record<string, Prop>,
  GroupReg extends Record<string, (keyof PropReg)[]>,
  Conds extends string = never,
  Sels extends string = never,
> = Animus<PropReg, GroupReg> & {
  toConfig(): SerializedConfig;
  /**
   * Frozen registry state captured at `build()` (design D7) — what
   * `extend()` merges from. Always present on instances built by this
   * version; optional in the type so systems built by an older
   * @animus-ui/system stay structurally acceptable to `from()` during the
   * deprecation window.
   */
  getRegistrySnapshot?(): RegistrySnapshot;
} & RegistryBrand<Conds, Sels>;

export interface SerializedConfig {
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  selectorAliases: string;
  /**
   * Condition alias map JSON (inc 03 — NEW field): `alias → { value, order,
   * kind }`. `"{}"` when the system registers no conditions (built-ins are
   * empty this increment). Distinct from `selectorAliases`, which stays
   * byte-for-byte unchanged.
   */
  conditionAliases: string;
}

/**
 * Freeze the builder's registries into the build-time snapshot (design D7):
 * containers, per-entry objects, and the mutable values nested inside a prop
 * (`properties` arrays, object/array scales) are copies, so neither the
 * builder's onward chaining nor post-build mutation of the instance's public
 * registry fields reaches serialized or merged output. Transform functions
 * are cached immutable forwarding wrappers: behavior survives without keeping
 * mutable serialization metadata live.
 */
function createRegistrySnapshot(
  propRegistry: Record<string, Prop>,
  groupRegistry: Record<string, readonly string[]>,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): RegistrySnapshot {
  const props: Record<string, Prop> = {};
  for (const [name, entry] of Object.entries(propRegistry)) {
    const copy: Prop = { ...entry };
    if (copy.properties) {
      copy.properties = Object.freeze([
        ...copy.properties,
      ]) as unknown as Prop['properties'];
    }
    if (copy.scale && typeof copy.scale === 'object') {
      copy.scale = Object.freeze(
        Array.isArray(copy.scale) ? [...copy.scale] : { ...copy.scale }
      ) as unknown as Prop['scale'];
    }
    if (copy.transform) {
      copy.transform = snapshotTransform(copy.transform);
    }
    props[name] = Object.freeze(copy);
  }
  const groups: Record<string, readonly string[]> = {};
  for (const [name, members] of Object.entries(groupRegistry)) {
    groups[name] = Object.freeze([...members]);
  }
  const selectors: SelectorAliasMap = {};
  for (const [name, entry] of Object.entries(selectorRegistry)) {
    selectors[name] = Object.freeze({ ...entry });
  }
  const conditions: ConditionAliasMap = {};
  for (const [name, entry] of Object.entries(conditionRegistry)) {
    conditions[name] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    props: Object.freeze(props),
    groups: Object.freeze(groups),
    selectors: Object.freeze(selectors),
    conditions: Object.freeze(conditions),
  });
}

function serializeInstance<
  PropReg extends Record<string, any>,
  GroupReg extends Record<string, readonly string[]>,
>(
  propRegistry: PropReg,
  groupRegistry: GroupReg,
  selectorRegistry: SelectorAliasMap,
  conditionRegistry: ConditionAliasMap
): SerializedConfig {
  const serialized: Record<string, SerializedPropEntry> = {};
  const transforms: Record<string, NamedTransform> = {};
  const transformOwners: Record<string, string> = {};

  for (const [propName, entry] of Object.entries(propRegistry)) {
    const s: SerializedPropEntry = { property: (entry as any).property };

    if ((entry as any).properties && (entry as any).properties.length > 0) {
      s.properties = [...(entry as any).properties];
    }

    const scale = (entry as any).scale;
    if (typeof scale === 'string') {
      s.scale = scale;
    } else if (scale && typeof scale === 'object') {
      s.scale = scale;
    }

    if ((entry as any).negative) {
      s.negative = true;
    }

    if ((entry as any).transform) {
      const fn = (entry as any).transform;
      const name = fn.transformName ?? fn.name;
      if (name) {
        const existing = transforms[name];
        if (existing && !areTransformsEqual(existing, fn)) {
          throw new Error(
            `Transform name "${name}" is registered by both props ` +
              `"${transformOwners[name]}" and "${propName}" with different ` +
              `function instances. Share one cached transform instance or ` +
              `give the transforms distinct names.`
          );
        }
        s.transform = name;
        transforms[name] = fn;
        transformOwners[name] = propName;
      }
    }

    if ((entry as any).currentVar) {
      s.currentVar = (entry as any).currentVar;
    }

    serialized[propName] = s;
  }

  const { selectors } = serializeSelectorMap(selectorRegistry);
  const conditions = serializeConditionMap(conditionRegistry);

  return {
    propConfig: JSON.stringify(serialized),
    groupRegistry: JSON.stringify(groupRegistry),
    transforms,
    selectorAliases: JSON.stringify(selectors),
    conditionAliases: JSON.stringify(conditions),
  };
}

export function createSystem(config?: CreateSystemConfig): SystemBuilder {
  return new SystemBuilder(
    undefined,
    undefined,
    undefined,
    config?.includes ?? []
  );
}
